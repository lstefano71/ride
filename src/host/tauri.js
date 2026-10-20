// Host adapter for the Tauri shell (see docs/adr/0001-async-host-adapter.md).
// Every page loads both adapters; each one only acts inside its own shell.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

/* eslint-disable no-underscore-dangle */
(function hostTauri() {
  if (!window.__TAURI__) return;
  D.desktop = true;
  const { invoke, Channel } = window.__TAURI__.core;

  // store: files in the data folder shared with Electron (src-tauri/src/store.rs).
  // prefs is preloaded behind D.host.ready, for D.db's synchronous facade.
  const snap = {};
  const writes = {}; // per-name chain, so writes land in the order they were made
  const storeError = (e) => (e instanceof Error ? e : new Error(String(e)));
  const store = {
    snapshot: (name) => snap[name],
    read: (name) => invoke('store_read', { name }).catch((e) => { throw storeError(e); }),
    write(name, text) {
      const p = (writes[name] || Promise.resolve())
        .then(() => invoke('store_write', { name, text }))
        .catch((e) => { throw storeError(e); });
      writes[name] = p.catch(() => {});
      return p;
    },
    mtime: (name) => invoke('store_mtime', { name }).catch((e) => { throw storeError(e); }),
  };
  const ready = store.read('prefs').then((r) => { snap.prefs = r ? r.text : null; }, (e) => {
    console.error(e); // eslint-disable-line no-console
    snap.prefs = null;
  });
  D.host = { kind: 'tauri', ready, store };

  // dlg: native dialogs (tauri-plugin-dialog, i.e. rfd). They take at most three
  // buttons and no checkbox; fits() tells callers when to use RIDE's HTML dialog.
  const dlgError = (e) => (e instanceof Error ? e : new Error(String(e)));
  const fits = (o) => (o.buttons || []).length <= 3 && !o.checkbox;
  D.host.dlg = {
    fits,
    // o: {type, title, message, buttons, defaultId, cancelId, checkbox (label), checked}
    message(o) {
      if (!fits(o)) {
        return Promise.reject(Object.assign(new Error('Unsupported dialog'), { code: 'ENOTSUP' }));
      }
      const b = o.buttons && o.buttons.length ? o.buttons : ['OK'];
      const buttons = [
        { OkCustom: b[0] }, { OkCancelCustom: b }, { YesNoCancelCustom: b },
      ][b.length - 1];
      const kind = ['warning', 'error'].includes(o.type) ? o.type : 'info';
      return invoke('plugin:dialog|message', {
        title: o.title || '', message: o.message, kind, buttons,
      }).then((r) => {
        // A click returns its button's label, dismissing the dialog returns "Cancel".
        let i = b.indexOf(r);
        if (i < 0) i = { Ok: 0, Yes: 0, No: 1 }[r];
        if (i == null) i = o.cancelId != null ? o.cancelId : Math.max(0, b.findIndex((y) => /^(cancel|no)$/i.test(y)));
        return { button: i, checked: false };
      }, (e) => { throw dlgError(e); });
    },
    // o: {title, directory, filters, defaultPath} → a path, or null if cancelled
    open(o) {
      const options = { title: o.title, directory: !!o.directory, filters: o.filters || [] };
      o.defaultPath && (options.defaultPath = o.defaultPath);
      return invoke('plugin:dialog|open', { options }).catch((e) => { throw dlgError(e); });
    },
  };

  const connError = (e) => (e && typeof e === 'object'
    ? Object.assign(new Error(e.message), e)
    : Object.assign(new Error(String(e)), { code: 'EIO' }));
  const aborted = () => Object.assign(new Error('Connection cancelled'), { name: 'AbortError', code: 'ABORT' });
  // A reload leaves the previous page's sockets open in Rust; free them first.
  const reset = invoke('conn_reset').catch(() => {});

  // conn: whole RIDE messages; Rust (src-tauri/src/conn.rs) owns the socket and framing.
  D.host.conn = {
    // o: {host, port, ssl, cert, key, subj, rootcertsdir}; signal: an AbortSignal
    connect(o, { signal } = {}) {
      // Rust reads the certificate files (src-tauri/src/tls.rs)
      const tls = o.ssl ? {
        cert: o.cert || null,
        key: o.key || null,
        rootcertsdir: o.rootcertsdir || null,
        subj: !!o.subj,
      } : null;
      const id = crypto.getRandomValues(new Uint32Array(1))[0];
      const ls = { message: [], error: [], close: [] };
      const early = []; // messages that arrive before onMessage is registered
      const emit = (t, x) => ls[t].forEach((f) => f(x));
      const events = new Channel();
      const dispatch = ({ t, x }) => {
        if (t === 'message') ls.message.length ? emit('message', x) : early.push(x);
        else if (t === 'error') emit('error', connError(x));
        else emit('close');
      };
      // Events can beat conn_connect's reply; hold them until the caller has had
      // the tick after resolve to register listeners, as with Node sockets.
      let held = [];
      events.onmessage = (ev) => (held ? held.push(ev) : dispatch(ev));
      const release = () => setTimeout(() => { const h = held; held = null; h.forEach(dispatch); });
      // Sends are batched behind the one in flight, so invokes can't reorder them.
      let inflight = Promise.resolve();
      let batch = null;
      const conn = {
        send(s) {
          if (!batch) {
            const b = { msgs: [] };
            b.p = inflight.then(() => {
              batch === b && (batch = null);
              return invoke('conn_send', { id, msgs: b.msgs });
            }).catch((e) => { throw connError(e); });
            inflight = b.p.catch(() => {});
            batch = b;
          }
          batch.msgs.push(s);
          return batch.p;
        },
        onMessage(f) { ls.message.push(f); early.splice(0).forEach(f); },
        onError(f) { ls.error.push(f); },
        onClose(f) { ls.close.push(f); },
        close() { return invoke('conn_close', { id }); },
      };
      const abort = () => invoke('conn_abort', { id });
      if (signal) {
        if (signal.aborted) return Promise.reject(aborted());
        signal.addEventListener('abort', abort, { once: true });
      }
      const done = () => signal && signal.removeEventListener('abort', abort);
      return reset
        .then(() => {
          if (signal && signal.aborted) throw aborted();
          return invoke('conn_connect', {
            id, host: o.host, port: +o.port, tls, events,
          });
        })
        .then(() => {
          done();
          // an abort that raced ahead of conn_connect registering the attempt
          if (signal && signal.aborted) { conn.close(); throw aborted(); }
          release();
          return conn;
        }, (e) => { done(); throw e instanceof Error ? e : connError(e); });
    },
  };
}());
