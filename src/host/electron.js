// Host adapter for the Electron shell (see docs/adr/0001-async-host-adapter.md).
// Every page loads both adapters; each one only acts inside its own shell.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

/* eslint-disable no-underscore-dangle */
(function hostElectron() {
  if (window.__TAURI__ || !/\bElectron\//.test(navigator.userAgent)) return;
  D.desktop = true;
  D.host = { kind: 'electron', ready: Promise.resolve() };

  // Every app page has Node; index.html moves require aside as nodeRequire for Monaco.
  const rq = typeof nodeRequire !== 'undefined' ? nodeRequire
    : typeof require === 'function' && require; // eslint-disable-line no-nested-ternary
  if (!rq) return;
  const { ipcRenderer } = rq('electron');
  const remote = rq('@electron/remote');
  const label = new URLSearchParams(window.location.search).get('label') || 'main';
  ipcRenderer.sendSync('host-register', label, 0);

  // ipc: messages between windows, addressed by window label and relayed by main.js.
  // Payloads travel as JSON, as they do under Tauri.
  const handlers = {}; // type → [fn(data, fromLabel)]
  ipcRenderer.on('host-ipc', (_, from, type, s) => {
    const data = s === undefined ? undefined : JSON.parse(s);
    (handlers[type] || []).slice().forEach((f) => f(data, from));
  });
  const post = (to, type, data) => {
    ipcRenderer.send('host-ipc', to, type, data === undefined ? undefined : JSON.stringify(data));
    return Promise.resolve();
  };
  D.host.ipc = {
    send: (to, type, data) => post(to, type, data),
    broadcast: (type, data) => post(null, type, data),
    on(type, f) {
      (handlers[type] = handlers[type] || []).push(f);
      return () => { handlers[type] = handlers[type].filter((g) => g !== f); };
    },
  };

  // win: app windows, addressed by window label. Bounds are content bounds.
  const cur = remote.getCurrentWindow();
  const bwOf = (l) => {
    if (l === label) return cur;
    const id = ipcRenderer.sendSync('host-lookup', l);
    const w = id && remote.BrowserWindow.fromId(id);
    return w && !w.isDestroyed() ? w : null;
  };
  const noWin = (l) => Object.assign(new Error(`No window: ${l}`), { code: 'ENOENT' });
  const onWin = (f) => (l, ...a) => new Promise((resolve) => {
    const w = bwOf(l);
    if (!w) throw noWin(l);
    resolve(f(w, ...a));
  });
  D.host.win = {
    current: () => label,
    // o: {parent, bounds, hidden, modal, title, minWidth, minHeight, resizable, minimizable,
    // maximizable}. Resolves true for a new window, false if the label was already open
    // (then shown and focused unless hidden).
    open(l, page, o = {}) {
      const w0 = bwOf(l);
      if (w0) {
        if (!o.hidden) { w0.show(); w0.focus(); }
        return Promise.resolve(false);
      }
      const b = o.bounds || {};
      const opts = {
        show: false,
        useContentSize: true,
        width: b.width || 800,
        height: b.height || 600,
        fullscreenable: false,
        modal: !!o.modal,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: true,
          enableDeprecatedPaste: true,
        },
      };
      if (b.x != null && b.y != null) Object.assign(opts, { x: b.x, y: b.y });
      o.parent && (opts.parent = bwOf(o.parent));
      ['title', 'minWidth', 'minHeight', 'resizable', 'minimizable', 'maximizable']
        .forEach((k) => { o[k] != null && (opts[k] = o[k]); });
      const bw = new remote.BrowserWindow(opts);
      remote.require('@electron/remote/main').enable(bw.webContents);
      ipcRenderer.sendSync('host-register', l, bw.webContents.id);
      const u = new URL(page, window.location.href);
      u.searchParams.set('label', l);
      bw.loadURL(u.href);
      o.hidden || bw.once('ready-to-show', () => bw.show());
      return Promise.resolve(true);
    },
    exists: (l) => Promise.resolve(!!bwOf(l)),
    show: onWin((w) => w.show()),
    hide: onWin((w) => w.hide()),
    focus: onWin((w) => w.focus()),
    close: onWin((w) => w.close()),
    isFocused: onWin((w) => w.isFocused()),
    setTitle: onWin((w, t) => w.setTitle(t)),
    setContentSize: onWin((w, width, height) => w.setContentSize(
      Math.round(width),
      Math.round(height),
    )),
    setMinSize: onWin((w, width, height) => w.setMinimumSize(width, height)),
    getBounds: onWin((w) => w.getContentBounds()),
    setBounds: onWin((w, b) => w.setContentBounds(b)),
    displayFor: (b) => Promise.resolve(remote.screen.getDisplayMatching(b).workArea),
    // fn() → boolean or Promise<boolean>: whether the window may close. Electron offers
    // no async veto, so this always vetoes and closes again once fn agrees. Current
    // window only.
    onCloseRequested(l, fn) {
      if (l !== label) {
        return Promise.reject(Object.assign(new Error('Current window only'), { code: 'ENOTSUP' }));
      }
      let allowed = false;
      window.onbeforeunload = (e) => {
        if (allowed) return undefined;
        const r = fn();
        if (r === true) return undefined;
        e.returnValue = false;
        Promise.resolve(r).then((ok) => {
          if (!ok) return;
          allowed = true;
          cur.close();
        }, (x) => console.error(x)); // eslint-disable-line no-console
        return false;
      };
      return Promise.resolve();
    },
    // fn(paths): files dropped onto the current window
    onFileDrop(fn) {
      const { webUtils } = rq('electron');
      window.addEventListener('dragover', (e) => { e.preventDefault(); });
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        fn([...e.dataTransfer.files].map((f) => webUtils.getPathForFile(f)).filter((x) => x));
      });
      return Promise.resolve();
    },
  };

  // sys: process facts (of the main process, which RIDE was started as) and calls that
  // act on the app or a window.
  const rp = remote.process;
  const promise = (f) => (...a) => new Promise((resolve) => { resolve(f(...a)); });
  let locale;
  D.host.sys = {
    env: process.env,
    argv: rp.argv,
    platform: process.platform,
    arch: process.arch,
    pid: rp.pid,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    get locale() {
      locale = locale || rq('os-locale').sync();
      return locale;
    },
    tempDir: remote.app.getPath('temp'),
    // env: variables to override in the new instance
    relaunch: promise((e = {}) => {
      const p = rp.argv;
      rq('child_process').spawn(p[0], p.slice(1), {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, ...e },
      });
    }),
    toggleDevTools: onWin((w) => w.webContents.toggleDevTools()),
    print: onWin((w) => w.webContents.print({ printBackground: true })),
    openExternal: (url) => remote.shell.openExternal(url),
    clipboard: {
      readText: promise(() => remote.clipboard.readText()),
      writeText: promise((t) => remote.clipboard.writeText(t)),
    },
  };

  // fs: text files by path. Synchronous underneath, so calls land in order.
  const nfs = rq('fs');
  D.host.fs = {
    readText: promise((f) => nfs.readFileSync(f, 'utf8')),
    writeText: promise((f, t) => nfs.writeFileSync(f, t)),
    appendText: promise((f, t) => nfs.appendFileSync(f, t)),
    remove: promise((f) => nfs.rmSync(f, { force: true })),
  };

  // The rest is for index.html pages only.
  if (typeof nodeRequire === 'undefined') return;
  D.el = remote;
  D.elm = D.el.require('@electron/remote/main');
  D.elw = D.el.getGlobal('elw');
  D = $.extend(D, D.el.getGlobal('D'));
  const plt = process.platform;
  D.win = /^win/i.test(plt);
  D.mac = plt === 'darwin';

  const fs = nodeRequire('fs');
  const path = nodeRequire('path');

  // store: files in userData. Calls are synchronous underneath, so writes keep their
  // order and land before the page can unload. winstate belongs to main.js, which
  // writes it out: here it reads and updates main's live copy.
  const ud = D.el.app.getPath('userData');
  const files = {
    prefs: D.el.process.env.RIDE_PREFS || `${ud}/prefs.json`,
    connections: `${ud}/connections.json`,
    history: `${ud}/hist.txt`,
  };
  const file = (name) => {
    if (!files[name]) throw new Error(`Unknown store: ${name}`);
    return files[name];
  };
  const mtime = (f) => (fs.existsSync(f) ? +fs.statSync(f).mtime : null);
  const read = (name) => {
    if (name === 'winstate') return { text: JSON.stringify(D.el.getGlobal('winstate')), mtime: null };
    const f = file(name);
    return fs.existsSync(f) ? { text: fs.readFileSync(f, 'utf8'), mtime: mtime(f) } : null;
  };
  const write = (name, text) => {
    if (name === 'winstate') {
      const w = D.el.getGlobal('winstate');
      const x = JSON.parse(text);
      Object.keys(x).forEach((k) => {
        JSON.stringify(x[k]) !== JSON.stringify(w[k]) && (w[k] = x[k]);
      });
      return null;
    }
    const f = file(name);
    fs.writeFileSync(f, text);
    return mtime(f);
  };
  let prefs = null;
  try {
    const r = read('prefs');
    prefs = r && r.text;
  } catch (e) { console.error(e); } // eslint-disable-line no-console
  D.host.store = {
    snapshot: (name) => (name === 'prefs' ? prefs : undefined),
    read: promise(read),
    write: promise(write),
    mtime: promise((name) => (name === 'winstate' ? null : mtime(file(name)))),
  };

  // dlg: native dialogs, modal to the app's focused window.
  const dlgParent = () => D.el.BrowserWindow.getFocusedWindow() || D.el.getCurrentWindow();
  D.host.dlg = {
    fits: () => true,
    // o: {type, title, message, buttons, defaultId, cancelId, checkbox (label), checked}
    message(o) {
      const opts = {
        type: o.type || 'none',
        title: o.title || '',
        message: o.message,
        buttons: o.buttons && o.buttons.length ? o.buttons : ['OK'],
      };
      o.defaultId != null && (opts.defaultId = o.defaultId);
      o.cancelId != null && (opts.cancelId = o.cancelId);
      if (o.checkbox) {
        opts.checkboxLabel = o.checkbox;
        opts.checkboxChecked = !!o.checked;
      }
      return D.el.dialog.showMessageBox(dlgParent(), opts)
        .then((r) => ({ button: r.response, checked: !!r.checkboxChecked }));
    },
    // o: {title, directory, filters, defaultPath} → a path, or null if cancelled
    open(o) {
      const opts = {
        title: o.title,
        filters: o.filters || [],
        properties: [o.directory ? 'openDirectory' : 'openFile'],
      };
      o.defaultPath && (opts.defaultPath = o.defaultPath);
      return D.el.dialog.showOpenDialog(dlgParent(), opts)
        .then((r) => (r.canceled || !r.filePaths.length ? null : r.filePaths[0]));
    },
  };

  // menu: native menus built from plain templates
  // ({id, label, accelerator, type, checked, enabled, visible, role, items}).
  const menuOf = (template, onClick) => D.el.Menu.buildFromTemplate(template.map(function conv(x) {
    const { items, ...h } = x;
    h.accelerator || delete h.accelerator;
    if (items) h.submenu = items.map(conv);
    else if (x.id && x.type !== 'separator') h.click = (mi) => onClick(x.id, !!mi.checked);
    return h;
  }));
  // A click resolves its id; closing the menu without one resolves null once any
  // pending click has had the chance to arrive.
  const clickOrNull = (show) => new Promise((resolve) => {
    show((id) => resolve(id), () => setTimeout(() => resolve(null), 100));
  });
  D.host.menu = {
    // onClick(id, checked): checked is the item's new state
    setApp(template, onClick) {
      const m = menuOf(template, onClick);
      if (D.mac) D.el.Menu.setApplicationMenu(m);
      else D.elw.setMenu(m);
      return Promise.resolve({
        setChecked(id, v) {
          const mi = m.getMenuItemById(id);
          mi && (mi.checked = !!v);
          return Promise.resolve();
        },
      });
    },
    popup(template) {
      return clickOrNull((click, closed) => {
        menuOf(template, click).popup({ callback: closed });
      });
    },
  };

  // conn: whole RIDE messages over a socket. Each frame is a 4-byte big-endian
  // length (counting itself), the magic "RIDE", then the UTF-8 payload.
  const net = nodeRequire('net');
  const tls = nodeRequire('tls');
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
