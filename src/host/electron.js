// Host adapter for the Electron shell (see docs/adr/0001-async-host-adapter.md).
// Every page loads both adapters; each one only acts inside its own shell.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

/* eslint-disable no-underscore-dangle */
(function hostElectron() {
  if (window.__TAURI__ || !/\bElectron\//.test(navigator.userAgent)) return;
  D.desktop = true;
  D.host = { kind: 'electron', ready: Promise.resolve() };

  // Only index.html exposes Node (as nodeRequire); auxiliary pages get the flag alone.
  if (typeof nodeRequire === 'undefined') return;
  D.el = nodeRequire('@electron/remote');
  D.elm = D.el.require('@electron/remote/main');
  D.elw = D.el.getGlobal('elw');
  D.ipc = nodeRequire('node-ipc').default;
  D.ipc.config.logInColor = false;
  D = $.extend(D, D.el.getGlobal('D'));
  const plt = process.platform;
  D.win = /^win/i.test(plt);
  D.mac = plt === 'darwin';

  // conn: whole RIDE messages over a socket. Each frame is a 4-byte big-endian
  // length (counting itself), the magic "RIDE", then the UTF-8 payload.
  const net = nodeRequire('net');
  const tls = nodeRequire('tls');
  const fs = nodeRequire('fs');
  const path = nodeRequire('path');
  const connError = (e) => {
    const many = e.errors && e.errors.length > 1; // e.g. both ::1 and 127.0.0.1 refused
    return {
      name: many ? e.code : e.name,
      code: e.code,
      hostname: e.hostname,
      message: many ? e.errors.map((y) => y.message).join('\n') : e.message,
    };
  };
  const frame = (sock) => {
    const ls = { message: [], error: [], close: [] };
    const early = []; // messages that arrive before onMessage is registered
    const emit = (t, x) => ls[t].forEach((f) => f(x));
    let b = Buffer.alloc(0x100000);
    let ib = 0; // offset of unread data in b
    let nb = 0; // length of unread data in b
    sock.on('data', (x) => {
      if (nb + x.length > b.length) {
        const r = Buffer.alloc(2 ** Math.ceil(Math.log2(nb + x.length)));
        b.copy(r, 0, ib, ib + nb);
        ib = 0;
        b = r;
      } else if (ib + nb + x.length > b.length) {
        b.copy(b, 0, ib, ib + nb);
        ib = 0;
      }
      x.copy(b, ib + nb, 0, x.length);
      nb += x.length;
      let n;
      while (nb >= 4 && (n = b.readInt32BE(ib)) <= nb) {
        if (n <= 8) {
          emit('error', { name: 'Error', code: 'EPROTO', message: 'Bad protocol message' });
          sock.destroy();
          return;
        }
        const m = b.toString('utf8', ib + 8, ib + n);
        ib += n;
        nb -= n;
        ls.message.length ? emit('message', m) : early.push(m);
      }
    });
    sock.on('error', (e) => emit('error', connError(e)));
    sock.on('end', () => emit('close'));
    return {
      send(s) {
        const x = Buffer.from(`xxxxRIDE${s}`);
        x.writeInt32BE(x.length, 0);
        sock.write(x);
        return Promise.resolve();
      },
      onMessage(f) { ls.message.push(f); early.splice(0).forEach(f); },
      onError(f) { ls.error.push(f); },
      onClose(f) { ls.close.push(f); },
      close() { sock.end(); return Promise.resolve(); },
    };
  };
  D.host.conn = {
    // o: {host, port, ssl, cert, key, subj, rootcertsdir}; signal: an AbortSignal
    connect(o, { signal } = {}) {
      return new Promise((resolve, reject) => {
        const opts = { host: o.host, port: o.port };
        if (o.ssl) {
          try {
            if (o.cert) {
              opts.cert = fs.readFileSync(o.cert);
              opts.key = fs.readFileSync(o.key);
            }
            if (o.rootcertsdir) {
              opts.ca = fs.readdirSync(o.rootcertsdir)
                .map((y) => fs.readFileSync(path.join(o.rootcertsdir, y)));
            }
          } catch (e) { reject(connError(e)); return; }
          opts.checkServerIdentity = (_, cert) => {
            if (!o.subj || o.host === cert.subject.CN) return undefined;
            return Object.assign(new Error(`Wrong server certificate name. Expected:${
              JSON.stringify(o.host)}, actual:${JSON.stringify(cert.subject.CN)}`), { code: 'ECERTNAME' });
          };
        }
        const fail = (e) => reject(connError(e));
        const abort = () => {
          sock.destroy(); // eslint-disable-line no-use-before-define
          reject(Object.assign(new Error('Connection cancelled'), { name: 'AbortError', code: 'ABORT' }));
        };
        const sock = (o.ssl ? tls : net).connect(opts, () => {
          sock.off('error', fail);
          signal && signal.removeEventListener('abort', abort);
          resolve(frame(sock));
        });
        sock.on('error', fail);
        if (signal) signal.aborted ? abort() : signal.addEventListener('abort', abort, { once: true });
      });
    },
    // Electron only: frame a socket cn.js obtained itself (spawn, listen, SSH).
    adopt: frame,
  };
}());
