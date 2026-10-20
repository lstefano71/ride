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

  // ipc: messages between windows, addressed by window label, as Tauri events.
  const wv = window.__TAURI__.webviewWindow;
  const me = wv.getCurrentWebviewWindow();
  const { label } = me;
  const handlers = {}; // type → [fn(data, fromLabel)]
  const IPC = 'ride-ipc';
  // Events emitted before a window's listener is in place are lost, so pages wait for
  // D.host.ready before announcing themselves.
  const listening = me.listen(IPC, ({
    payload: {
      from, to, type, data,
    },
  }) => {
    if (from === label || (to != null && to !== label)) return;
    (handlers[type] || []).slice().forEach((f) => f(data, from));
  });
  const tev = window.__TAURI__.event;
  D.host.ipc = {
    send: (to, type, data) => tev.emitTo(to, IPC, {
      from: label, to, type, data,
    }),
    broadcast: (type, data) => tev.emit(IPC, {
      from: label, to: null, type, data,
    }),
    on(type, f) {
      (handlers[type] = handlers[type] || []).push(f);
      return () => { handlers[type] = handlers[type].filter((g) => g !== f); };
    },
  };
  D.host.ready = Promise.all([ready, listening]).then(() => {});

  // win: app windows (WebviewWindow), addressed by window label. Bounds are content bounds.
  const winError = (e) => (e instanceof Error ? e : new Error(String(e)));
  const winOf = (l) => (l === label ? Promise.resolve(me) : wv.WebviewWindow.getByLabel(l))
    .then((w) => {
      if (!w) throw Object.assign(new Error(`No window: ${l}`), { code: 'ENOENT' });
      return w;
    });
  const onWin = (f) => (l, ...a) => winOf(l).then((w) => f(w, ...a))
    .catch((e) => { throw winError(e); });
  const { LogicalSize } = window.__TAURI__.dpi;
  const notYet = () => Promise.reject(Object.assign(new Error('Not supported yet'), { code: 'ENOTSUP' }));
  D.host.win = {
    current: () => label,
    // o: {parent, bounds, hidden, modal, title, minWidth, minHeight, resizable, minimizable,
    // maximizable}. Resolves true for a new window, false if the label was already open
    // (then shown and focused unless hidden). Tauri has no modal windows: modal is ignored.
    open(l, page, o = {}) {
      return wv.WebviewWindow.getByLabel(l).then((w0) => {
        if (w0) return o.hidden ? false : w0.show().then(() => w0.setFocus()).then(() => false);
        const b = o.bounds || {};
        const opts = {
          url: page,
          width: b.width || 800,
          height: b.height || 600,
          visible: !o.hidden,
          focus: !o.hidden,
        };
        if (b.x != null && b.y != null) Object.assign(opts, { x: b.x, y: b.y });
        ['parent', 'title', 'minWidth', 'minHeight', 'resizable', 'minimizable', 'maximizable']
          .forEach((k) => { o[k] != null && (opts[k] = o[k]); });
        return new Promise((resolve, reject) => {
          const w = new wv.WebviewWindow(l, opts);
          w.once('tauri://created', () => resolve(true));
          w.once('tauri://error', (e) => reject(winError(e.payload)));
        });
      }).catch((e) => { throw winError(e); });
    },
    exists: (l) => wv.WebviewWindow.getByLabel(l).then((w) => !!w),
    show: onWin((w) => w.show()),
    hide: onWin((w) => w.hide()),
    focus: onWin((w) => w.setFocus()),
    close: onWin((w) => w.close()),
    isFocused: onWin((w) => w.isFocused()),
    setTitle: onWin((w, t) => w.setTitle(t)),
    setContentSize: onWin((w, width, height) => w.setSize(new LogicalSize(width, height))),
    setMinSize: onWin((w, width, height) => w.setMinSize(new LogicalSize(width, height))),
    // Floating editors need these: Port floating windows to Tauri windows.
    getBounds: notYet,
    setBounds: notYet,
    displayFor: notYet,
    // fn() → boolean or Promise<boolean>: whether the window may close.
    onCloseRequested: (l, fn) => winOf(l).then((w) => w.onCloseRequested((e) => Promise.resolve()
      .then(fn)
      .catch((x) => { console.error(x); return false; }) // eslint-disable-line no-console
      .then((ok) => { ok || e.preventDefault(); }))),
  };

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

  // menu: native menus through Tauri's menu API, from plain templates
  // ({id, label, accelerator, type, checked, enabled, visible, role, items}).
  const tm = window.__TAURI__.menu;
  const mac = /Mac/.test(navigator.platform);
  const predefined = {
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    undo: 'Undo',
    redo: 'Redo',
    selectall: 'SelectAll',
    ...mac && { hide: 'Hide', hideothers: 'HideOthers', unhide: 'ShowAll' },
  };
  // Tauri rejects a whole menu over one accelerator it can't parse, so pass only
  // the forms it knows (see muda's accelerator parser).
  const accelKey = /^([a-z0-9`\\[\],=\-.';/]|f([1-9]|1[0-9]|2[0-4])|enter|esc(ape)?|tab|space|backspace|delete|insert|home|end|page(up|down)|(arrow)?(up|down|left|right)|pause(break)?)$/i;
  const accelerator = (a) => {
    if (!a) return undefined;
    const s = a.replace(/-(.)/g, '+$1');
    const m = /^((?:(?:ctrl|control|shift|alt|option|cmd|command|super|meta)\+)*)(.+)$/i.exec(s);
    return m && accelKey.test(m[2]) ? s : undefined;
  };
  const toggleFullscreen = () => {
    const w = window.__TAURI__.window.getCurrentWindow();
    return w.isFullscreen().then((f) => w.setFullscreen(!f));
  };
  // A built menu: checks maps the ids of check/radio items to {item, group, checked}.
  const buildMenu = (template, onClick) => {
    const checks = {};
    const setChecked = (id, v) => {
      const c = checks[id];
      if (!c) return Promise.resolve();
      c.checked = !!v;
      return c.item.setChecked(c.checked);
    };
    const click = (id) => {
      const c = checks[id];
      if (c && c.group) {
        Object.keys(checks).forEach((k) => checks[k].group === c.group && setChecked(k, k === id));
      } else if (c) {
        setChecked(id, !c.checked); // muda toggles on its own on some platforms only
      }
      onClick(id, c ? c.checked : false);
    };
    let groups = 0;
    const conv = (xs) => {
      let group = null; // radio items between separators form a group
      return Promise.all(xs.filter((x) => x.visible !== false).map((x) => {
        if (x.type !== 'radio') group = null;
        else if (!group) { groups += 1; group = `g${groups}`; }
        if (x.type === 'separator') return { item: 'Separator' };
        const enabled = x.enabled !== false;
        if (x.items) {
          return conv(x.items).then((items) => ({
            id: x.id, text: x.label, enabled, items,
          }));
        }
        const p = predefined[x.role];
        if (p && enabled) return { item: p, text: x.label };
        const h = {
          id: x.id, text: x.label, enabled, accelerator: accelerator(x.accelerator),
        };
        h.accelerator || delete h.accelerator;
        if (x.role === 'togglefullscreen') {
          h.action = () => { toggleFullscreen(); onClick(x.id, false); };
          return h;
        }
        if (!x.id) return h;
        h.action = () => click(x.id);
        if (x.type !== 'checkbox' && x.type !== 'radio') return h;
        h.checked = !!x.checked;
        const g = x.type === 'radio' ? group : null;
        return tm.CheckMenuItem.new(h).then((item) => {
          checks[x.id] = { item, group: g, checked: h.checked };
          return item;
        });
      }));
    };
    return conv(template)
      .then((items) => tm.Menu.new({ items }))
      .then((menu) => ({ menu, setChecked }));
  };
  const menuError = (e) => (e instanceof Error ? e : new Error(String(e)));
  let appMenu = null; // the menu in place
  let appNext = Promise.resolve(); // setApp calls apply in order
  D.host.menu = {
    // onClick(id, checked): checked is the item's new state
    setApp(template, onClick) {
      const p = appNext.then(() => buildMenu(template, onClick)).then((m) => {
        const set = mac ? m.menu.setAsAppMenu() : m.menu.setAsWindowMenu();
        return set.then(() => {
          appMenu && appMenu.menu.close().catch(() => {});
          appMenu = m;
          const setChecked = (id, v) => (appMenu === m ? m.setChecked(id, v) : Promise.resolve());
          return { setChecked };
        });
      }).catch((e) => { throw menuError(e); });
      appNext = p.catch(() => {});
      return p;
    },
    // A click resolves its id; closing the menu without one resolves null once any
    // pending click has had the chance to arrive.
    popup(template) {
      return new Promise((resolve, reject) => {
        buildMenu(template, (id) => resolve(id)).then((m) => m.menu.popup().then(() => {
          setTimeout(() => { resolve(null); m.menu.close().catch(() => {}); }, 100);
        })).catch((e) => reject(menuError(e)));
      });
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
