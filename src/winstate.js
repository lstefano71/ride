// The main window's bounds in its two layouts, the Connect page's (launchWin) and the
// connected IDE's (mainWin), kept in winstate.json. Both shells share the file (see
// docs/adr/0002-shared-versioned-data-folder.md), so its keys keep the meaning main.js
// gave them: content bounds in logical px, expandedWidth for the Connect page with its
// config pane open, maximized, devTools, and dx (the frame's width).
// The main window starts hidden; this shows it once its launch bounds are in place.
var D = typeof D === 'undefined' ? {} : D; // eslint-disable-line no-var, no-use-before-define

(function winstate() {
  if (!D.desktop || !D.host || !D.host.store || D.host.win.current() !== 'main') return;
  const { win, store, sys } = D.host;
  const L = 'main';
  const log = (e) => console.error(e); // eslint-disable-line no-console
  const db = {};
  let page = 'launchWin'; // the layout in use
  let tid = 0;

  let started = false;
  const svNow = () => {
    clearTimeout(tid);
    tid = 0;
    if (!started) return Promise.resolve(null); // the window isn't at its bounds yet
    return Promise.all([
      win.getBounds(L), win.isMaximized(L), win.isMinimized(L), win.frame(L), sys.isDevToolsOpen(L),
    ]).then(([b, maximized, minimized, f, devTools]) => {
      if (minimized) return null; // its bounds are off screen
      const w = db[page] || (db[page] = {});
      w.x = b.x;
      w.y = b.y;
      if (page !== 'launchWin' || !db.launchWin.expanded) w.width = b.width;
      else w.expandedWidth = b.width;
      w.height = b.height;
      w.maximized = maximized;
      db.devTools = devTools;
      db.dx = f.width;
      return store.write('winstate', JSON.stringify(db));
    });
  };
  const save = () => { tid || (tid = setTimeout(() => svNow().catch(log), 2000)); };

  // Put the window at p's saved bounds, or centre it if they are mostly off screen.
  // The Connect page isn't reopened maximised, as in Electron before.
  const restore = (p) => {
    const s = db[p] || {};
    let { x } = s;
    const { y } = s;
    let width = p === 'launchWin' && db.launchWin.expanded ? db.launchWin.expandedWidth : s.width;
    let { height } = s;
    return win.displayFor({
      x: x || 0, y: y || 0, width, height,
    }).then((b) => {
      const vw = Math.max(0, Math.min(x + width, b.x + b.width) - Math.max(x, b.x));
      const vh = Math.max(0, Math.min(y + height, b.y + b.height) - Math.max(y, b.y));
      if (x == null || y == null || width * height > 2 * vw * vh) {
        x = null;
        width = Math.min(width, b.width);
        height = Math.min(height, b.height);
      }
      return win.isMaximized(L);
    }).then((m) => (m ? win.unmaximize(L) : null))
      .then(() => (x == null
        ? win.setContentSize(L, width, height).then(() => win.center(L))
        : win.setBounds(L, {
          x, y, width, height,
        })))
      .then(() => (p === 'mainWin' && s.maximized ? win.maximize(L) : null));
  };

  const ready = store.read('winstate').then((r) => {
    try {
      r && Object.assign(db, JSON.parse(r.text));
    } catch (e) { log(e); }
  }, log).then(() => {
    db.theme || (db.theme = 'light');
    db.launchWin || (db.launchWin = {
      expandedWidth: 900, width: 400, height: 400, expanded: false,
    });
    db.mainWin || (db.mainWin = { width: 800, height: 600 });
  });
  // A menu bar installed after the bounds are restored would eat into the content and
  // the saved height would creep down by its height each run, so wait for the first.
  let menuSet;
  const menu = new Promise((r) => { menuSet = r; setTimeout(r, 3000); });
  let shownAs;
  const start = ready.then(() => menu).then(() => { shownAs = page; return restore(page); })
    .catch(log)
    .then(() => db.devTools && sys.isDevToolsOpen(L).then((o) => o || sys.toggleDevTools(L)))
    .catch(log)
    .then(() => win.show(L))
    .catch(log)
    .then(() => { started = true; return win.onBoundsChanged(L, save); })
    .catch(log);

  D.winstate = {
    db, // valid once ready resolves
    ready,
    started: start, // the window is shown at its saved bounds
    save,
    // The app menu is in place (src/menu.js).
    menuSet: () => menuSet(),
    // Save now, e.g. before the window closes.
    flush: () => ready.then(svNow),
    // Switch to layout p ('launchWin' or 'mainWin') and its saved bounds. Before the
    // window is first shown, just pick the layout it will be shown in.
    layout: (p) => ready.then(() => {
      if (!started) {
        page = p;
        return start.then(() => {
          if (shownAs === page) return null;
          shownAs = page;
          return restore(page);
        });
      }
      if (p === page) { save(); return null; }
      return svNow().catch(log).then(() => {
        page = p;
        return win.setMinSize(L, 400, 400).then(() => restore(p));
      });
    }),
    set(k, v) {
      ready.then(() => {
        if (db[k] === v) return;
        db[k] = v;
        save();
      });
    },
  };
}());
