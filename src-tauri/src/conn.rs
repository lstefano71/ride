// D.host.conn for the Tauri shell: sockets and RIDE message framing only.
// Each frame is a 4-byte big-endian length (counting itself), the magic "RIDE",
// then the UTF-8 payload. The protocol itself stays in cn.js.

use std::collections::HashMap;
use std::io;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, Runtime, State, Webview};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpStream, lookup_host};
use tokio::sync::{mpsc, oneshot};

#[derive(Clone, Serialize)]
pub struct ConnError {
    name: String,
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
}

impl ConnError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { name: "Error".into(), code: code.into(), message: message.into(), hostname: None }
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "t", content = "x", rename_all = "lowercase")]
pub enum Event {
    Message(String),
    Error(ConnError),
    Close,
}

enum Cmd {
    Send(Vec<u8>),
    End,
}

enum Entry {
    Pending { label: String, abort: oneshot::Sender<()> },
    Open { label: String, tx: mpsc::UnboundedSender<Cmd> },
}

impl Entry {
    fn label(&self) -> &str {
        match self {
            Entry::Pending { label, .. } | Entry::Open { label, .. } => label,
        }
    }
}

#[derive(Default)]
pub struct Conns(Mutex<HashMap<u32, Entry>>);

fn io_code(e: &io::Error) -> &'static str {
    use io::ErrorKind::*;
    match e.kind() {
        ConnectionRefused => "ECONNREFUSED",
        ConnectionReset => "ECONNRESET",
        ConnectionAborted => "ECONNABORTED",
        TimedOut => "ETIMEDOUT",
        AddrNotAvailable => "EADDRNOTAVAIL",
        HostUnreachable => "EHOSTUNREACH",
        NetworkUnreachable => "ENETUNREACH",
        BrokenPipe => "EPIPE",
        _ => "EIO",
    }
}

fn io_error(e: &io::Error, what: &str) -> ConnError {
    let code = io_code(e);
    ConnError::new(code, format!("{what} {code}: {e}"))
}

// Mirrors Node's net.connect: resolve, then try each address in turn; when
// several fail, the messages are joined and the code becomes the name.
async fn open(host: &str, port: u16) -> Result<TcpStream, ConnError> {
    let addrs: Vec<_> = match lookup_host((host, port)).await {
        Ok(a) => a.collect(),
        Err(_) => Vec::new(),
    };
    if addrs.is_empty() {
        return Err(ConnError {
            hostname: Some(host.into()),
            ..ConnError::new("ENOTFOUND", format!("getaddrinfo ENOTFOUND {host}"))
        });
    }
    let mut errs = Vec::new();
    for a in addrs {
        match TcpStream::connect(a).await {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                return Ok(s);
            }
            Err(e) => {
                let code = io_code(&e);
                errs.push(ConnError::new(code, format!("connect {code} {a}")));
            }
        }
    }
    let mut e = errs.pop().unwrap();
    if !errs.is_empty() {
        errs.push(e.clone());
        e.name = e.code.clone();
        e.message = errs.iter().map(|x| x.message.as_str()).collect::<Vec<_>>().join("\n");
    }
    Err(e)
}

async fn read_loop(mut rd: tokio::net::tcp::OwnedReadHalf, ch: &Channel<Event>) -> Option<Event> {
    let mut b: Vec<u8> = Vec::with_capacity(0x100000);
    let mut chunk = vec![0u8; 0x10000];
    loop {
        let k = match rd.read(&mut chunk).await {
            Ok(0) => return Some(Event::Close),
            Ok(k) => k,
            Err(e) => return Some(Event::Error(io_error(&e, "read"))),
        };
        b.extend_from_slice(&chunk[..k]);
        let mut i = 0;
        while b.len() - i >= 4 {
            let n = i32::from_be_bytes(b[i..i + 4].try_into().unwrap());
            if n <= 8 {
                return Some(Event::Error(ConnError::new("EPROTO", "Bad protocol message")));
            }
            let n = n as usize;
            if b.len() - i < n {
                break;
            }
            let m = String::from_utf8_lossy(&b[i + 8..i + n]).into_owned();
            i += n;
            if ch.send(Event::Message(m)).is_err() {
                return None; // the page is gone
            }
        }
        b.drain(..i);
    }
}

async fn write_loop(mut wr: tokio::net::tcp::OwnedWriteHalf, mut rx: mpsc::UnboundedReceiver<Cmd>) {
    while let Some(c) = rx.recv().await {
        match c {
            Cmd::Send(x) => {
                if wr.write_all(&x).await.is_err() {
                    break; // the reader reports the failure
                }
            }
            Cmd::End => break,
        }
    }
    let _ = wr.shutdown().await;
}

#[tauri::command]
pub async fn conn_connect<R: Runtime>(
    webview: Webview<R>,
    conns: State<'_, Conns>,
    id: u32,
    host: String,
    port: u16,
    events: Channel<Event>,
) -> Result<(), ConnError> {
    let label = webview.label().to_string();
    let (abort, aborted) = oneshot::channel();
    conns.0.lock().unwrap().insert(id, Entry::Pending { label: label.clone(), abort });
    let sock = tokio::select! {
        r = open(&host, port) => r,
        _ = aborted => Err(ConnError { name: "AbortError".into(), ..ConnError::new("ABORT", "Connection cancelled") }),
    };
    let sock = match sock {
        Ok(s) => s,
        Err(e) => {
            conns.0.lock().unwrap().remove(&id);
            return Err(e);
        }
    };
    let (rd, wr) = sock.into_split();
    let (tx, rx) = mpsc::unbounded_channel();
    {
        let mut m = conns.0.lock().unwrap();
        // conn_abort or conn_reset may have dropped the pending entry while the connect completed
        if !matches!(m.get(&id), Some(Entry::Pending { .. })) {
            return Err(ConnError { name: "AbortError".into(), ..ConnError::new("ABORT", "Connection cancelled") });
        }
        m.insert(id, Entry::Open { label, tx: tx.clone() });
    }
    tauri::async_runtime::spawn(write_loop(wr, rx));
    let app = webview.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Some(ev) = read_loop(rd, &events).await {
            let _ = events.send(ev);
        }
        // Dropping every sender ends write_loop, which closes the socket. The id may
        // already belong to a newer connection after a reload, so check it's ours.
        let conns = app.state::<Conns>();
        let mut m = conns.0.lock().unwrap();
        if let Some(Entry::Open { tx: t, .. }) = m.get(&id)
            && t.same_channel(&tx)
        {
            m.remove(&id);
        }
    });
    Ok(())
}

// Sync, so it runs on the main thread in arrival order; tx only queues.
#[tauri::command]
pub fn conn_send(conns: State<'_, Conns>, id: u32, msgs: Vec<String>) -> Result<(), ConnError> {
    let m = conns.0.lock().unwrap();
    let Some(Entry::Open { tx, .. }) = m.get(&id) else {
        return Err(ConnError::new("EPIPE", "Connection is closed"));
    };
    for s in msgs {
        let n = 8 + s.len();
        let mut x = Vec::with_capacity(n);
        x.extend_from_slice(&(n as i32).to_be_bytes());
        x.extend_from_slice(b"RIDE");
        x.extend_from_slice(s.as_bytes());
        let _ = tx.send(Cmd::Send(x));
    }
    Ok(())
}

// Half-closes like Node's socket.end(); onClose fires when the peer closes too.
#[tauri::command]
pub fn conn_close(conns: State<'_, Conns>, id: u32) {
    if let Some(Entry::Open { tx, .. }) = conns.0.lock().unwrap().get(&id) {
        let _ = tx.send(Cmd::End);
    }
}

#[tauri::command]
pub fn conn_abort(conns: State<'_, Conns>, id: u32) {
    let mut m = conns.0.lock().unwrap();
    if matches!(m.get(&id), Some(Entry::Pending { .. }))
        && let Some(Entry::Pending { abort, .. }) = m.remove(&id)
    {
        let _ = abort.send(());
    }
}

// Drops every connection the calling page owns, so a reload frees the interpreter.
#[tauri::command]
pub fn conn_reset<R: Runtime>(webview: Webview<R>, conns: State<'_, Conns>) {
    let label = webview.label();
    let mut m = conns.0.lock().unwrap();
    let ids: Vec<u32> = m.iter().filter(|(_, e)| e.label() == label).map(|(k, _)| *k).collect();
    for id in ids {
        match m.remove(&id) {
            Some(Entry::Pending { abort, .. }) => {
                let _ = abort.send(());
            }
            Some(Entry::Open { tx, .. }) => {
                let _ = tx.send(Cmd::End);
            }
            None => {}
        }
    }
}
