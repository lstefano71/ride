// Electron's entry point (web-based Ride doesn't load it)
const rq = require;
const ps = process;
const el = rq('electron');
const elm = rq('@electron/remote/main');
const D = {};
global.D = D;

elm.initialize();
// Detect platform: https://nodejs.org/api/process.html#process_process_platform
// https://stackoverflow.com/questions/19877924/what-is-the-list-of-possible-values-for-navigator-platform-as-of-today
D.win = /^win/i.test(ps.platform);
D.mac = ps.platform === 'darwin';

if (ps.env.spectron_temp_dir) {
  el.app.setPath('userData', ps.env.spectron_temp_dir);
}

// D.host.ipc relay (src/host/electron.js): renderers address each other by window label.
const labels = new Map(); // label → webContents
const labelOf = (wc) => ([...labels].find(([, x]) => x === wc) || [null])[0];
el.ipcMain.on('host-register', (e, label, wcId) => {
  const wc = wcId ? el.webContents.fromId(wcId) : e.sender;
  if (wc) {
    labels.set(label, wc);
    wc.once('destroyed', () => { labels.get(label) === wc && labels.delete(label); });
  }
  e.returnValue = null;
});
el.ipcMain.on('host-lookup', (e, label) => {
  const wc = labels.get(label);
  const bw = wc && !wc.isDestroyed() && el.BrowserWindow.fromWebContents(wc);
  e.returnValue = bw ? bw.id : 0;
});
el.ipcMain.on('host-ipc', (e, to, type, data) => {
  const from = labelOf(e.sender);
  const deliver = (wc) => { wc.isDestroyed() || wc.send('host-ipc', from, type, data); };
  if (to != null) labels.has(to) && deliver(labels.get(to));
  else labels.forEach((wc) => { wc !== e.sender && deliver(wc); });
});

el.app.on('ready', () => {
  // create an electron renderer; src/winstate.js sizes and shows it
  let w = new el.BrowserWindow({
    show: 0,
    ...(!D.win && !D.mac && { icon: `${__dirname}/D.png` }),
    backgroundColor: '#7688d9',
    webPreferences: {
      contextIsolation: false,
      enableRemoteModule: true,
      nodeIntegration: true,
      enableDeprecatedPaste: true,
    },
  });
  global.elw = w;
  elm.enable(w.webContents);
  el.Menu.setApplicationMenu(null);

  const showMB = (f) => {
    w.setMenuBarVisibility(!!f);
    w.setAutoHideMenuBar(!f);
  };
  w.loadURL(`file://${__dirname}/index.html`);
  w.on('enter-full-screen', () => showMB(0))
    .on('leave-full-screen', () => showMB(1))
    .on('closed', () => {
      global.elw = 0;
      w = 0;
    });

  if (process.argv.constructor === Array && process.argv.includes('DEV_STYLE')) {
    const { client } = rq('electron-connect');
    const c = client.create(w, { sendBounds: false });
    c.on('reboot', () => {
      w.close();
      el.app.relaunch();
    });
    c.on('css_update', () => {
      // define the reload function that hacks in the new styles
      const reloadFn = `() => {
        [...document.getElementsByClassName('theme')].forEach(t => t.replaceWith(t));
      }`;
      w.webContents.executeJavaScript(`(${reloadFn})()`);
    });
  }
});

el.app.on('window-all-closed', () => { el.app.quit(); });
el.app.on('will-finish-launching', () => {
  el.app.on('open-file', (event, path) => {
    global.open_file = path;
  });
});
global.js = (i, x) => el.BrowserWindow.fromId(i).webContents.executeJavaScript(x);
