// CDP check for window bounds and the launch/main layout switch (src/winstate.js).
// Usage: node bounds-cdp.js <shell> [<shell> ...], where shell is "tauri" or "electron".
// Runs the scenario once per shell, in order. Each shell starts from the winstate.json the
// previous one left, so "tauri electron" also checks that Electron reads what Tauri wrote.
// Starts its own Dyalog 20. Backs up and restores the real winstate.json.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require(process.env.WS_PATH || 'ws');

const root = path.resolve(__dirname, '..', '..');
const shells = {
  tauri: { cmd: path.join(root, 'src-tauri', 'target', 'release', 'ride.exe'), args: [] },
  electron: { cmd: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: ['.'] },
};
const port = 9231;
const rport = 4631;
const wsf = path.join(process.env.APPDATA, 'Ride-4.8', 'winstate.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (p) => { try { execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* gone */ } };
const readWs = () => JSON.parse(fs.readFileSync(wsf, 'utf8'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};
const near = (a, b, keys) => keys.every((k) => Math.abs(a[k] - b[k]) <= 1);

async function pages() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json`);
    return (await r.json()).filter((p) => p.type === 'page');
  } catch (e) { return []; }
}

async function start(shell, env = {}) {
  const s = shells[shell];
  const args = shell === 'electron' ? [...s.args, `--remote-debugging-port=${port}`] : s.args;
  const app = spawn(s.cmd, args, {
    cwd: root,
    env: { ...process.env, ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore',
  });
  const exited = new Promise((r) => app.on('exit', r));
  let main;
  for (let i = 0; i < 100 && !main; i++) {
    main = (await pages()).find((p) => /tauri\.localhost\/?$|index\.html$/.test(p.url));
    if (!main) await sleep(100);
  }
  if (!main) throw new Error('no main page');
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  ws.on('message', (m) => {
    const x = JSON.parse(m);
    if (x.id && pend[x.id]) { pend[x.id](x); delete pend[x.id]; }
  });
  ws.on('error', () => {});
  await new Promise((r) => ws.on('open', r));
  const ev = (expr) => new Promise((r) => {
    id += 1; pend[id] = (x) => r(x.result && x.result.result ? x.result.result.value : x);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  for (let i = 0; i < 100 && !(await ev('!!(window.D && D.winstate && D.cn)')); i++) await sleep(100);
  await ev('D.winstate.started');
  return { app, ws, ev, exited };
}

const state = (ev) => ev(`(async () => { const w = D.host.win; await new Promise((r) => setTimeout(r, 300));
  return { b: await w.getBounds('main'), max: await w.isMaximized('main'), vis: document.visibilityState,
    shown: ${'await'} (window.__TAURI__ ? window.__TAURI__.window.getCurrentWindow().isVisible() : D.el.getCurrentWindow().isVisible()) }; })()`);

async function scenario(shell, dy) {
  console.log(`--- ${shell}`);
  const before = readWs();
  const L = before.launchWin;
  const M = before.mainWin;

  // 1. Connect page reopens at its saved bounds (expanded config pane)
  let r = await start(shell);
  let s = await state(r.ev);
  check(`${shell}: shown`, s.shown, s);
  check(`${shell}: launch bounds restored`, near(s.b, { x: L.x, y: L.y, width: L.expanded ? L.expandedWidth : L.width, height: L.height }, ['x', 'y', 'width', 'height']), { got: s.b, want: L });
  check(`${shell}: launch not maximised`, !s.max);

  // 2. collapse and expand the config pane: width follows width/expandedWidth. A click
  // on .cog first selects the entry, which can leave the pane as it was.
  const flip = async () => {
    const e0 = await r.ev('D.winstate.db.launchWin.expanded');
    for (let i = 0; i < 3 && (await r.ev('D.winstate.db.launchWin.expanded')) === e0; i++) {
      await r.ev("$(J.cn.favs).find('.cog').first().click()");
      await sleep(200);
    }
    const st = await state(r.ev);
    const e = await r.ev('D.winstate.db.launchWin.expanded');
    const lw = await r.ev('D.winstate.db.launchWin');
    return { flipped: e !== e0, ok: Math.abs(st.b.width - (e ? lw.expandedWidth : lw.width)) <= 1, width: st.b.width, e };
  };
  let f = await flip();
  check(`${shell}: toggle config resizes`, f.flipped && f.ok, f);
  f = await flip();
  check(`${shell}: toggle back`, f.flipped && f.ok && f.e === L.expanded, f);
  s = await state(r.ev);

  // 3. move/resize, then close straight away: the close flushes the bounds
  const nb = { x: L.x + 30, y: L.y + 20, width: (L.expanded ? L.expandedWidth : L.width) + 40, height: L.height + 30 };
  await r.ev(`D.host.win.setBounds('main', ${JSON.stringify(nb)})`);
  await sleep(300);
  r.ev("D.host.win.close('main')");
  const code = await Promise.race([r.exited, sleep(8000).then(() => 'timeout')]);
  r.ws.close();
  check(`${shell}: closes`, code !== 'timeout', code);
  if (code === 'timeout') kill(r.app);
  let w = readWs();
  const savedL = { ...w.launchWin, width: w.launchWin.expanded ? w.launchWin.expandedWidth : w.launchWin.width };
  check(`${shell}: launch bounds flushed on close`, near(savedL, nb, ['x', 'y', 'width', 'height']), { saved: w.launchWin, want: nb });
  check(`${shell}: dx and theme kept`, w.dx > 0 && !!w.theme, { dx: w.dx, theme: w.theme });

  // 4. connect: switches to the main layout at its saved bounds
  r = await start(shell, { RIDE_CONNECT: `127.0.0.1:${rport}` });
  for (let i = 0; i < 50 && !(await r.ev('!!(D.ide && D.ide.connected)')); i++) await sleep(200);
  check(`${shell}: connected`, await r.ev('!!(D.ide && D.ide.connected)'));
  await sleep(500);
  s = await state(r.ev);
  check(`${shell}: main bounds restored`, near(s.b, M, ['x', 'y', 'width', 'height']), { got: s.b, want: M });
  check(`${shell}: main maximised state restored`, s.max === !!M.maximized, s.max);
  // launch bounds untouched by the switch
  w = readWs();
  check(`${shell}: switch keeps launch bounds`, near({ ...w.launchWin, width: w.launchWin.expanded ? w.launchWin.expandedWidth : w.launchWin.width }, nb, ['x', 'y', 'width', 'height']), w.launchWin);

  // 5. maximise, wait out the 2 s throttle, kill: next start comes back maximised
  if (s.max) await r.ev("D.host.win.unmaximize('main')");
  const nm = { x: M.x + 25, y: M.y + 15, width: M.width - 30, height: M.height - 20 };
  await r.ev(`D.host.win.setBounds('main', ${JSON.stringify(nm)})`);
  await sleep(2600);
  w = readWs();
  check(`${shell}: main bounds saved (throttled)`, near(w.mainWin, nm, ['x', 'y', 'width', 'height']) && !w.mainWin.maximized, w.mainWin);
  await r.ev("D.host.win.maximize('main')");
  await sleep(2600);
  w = readWs();
  check(`${shell}: maximised saved`, w.mainWin.maximized === true, w.mainWin);
  r.ws.close(); kill(r.app); await r.exited;

  r = await start(shell, { RIDE_CONNECT: `127.0.0.1:${rport}` });
  for (let i = 0; i < 50 && !(await r.ev('!!(D.ide && D.ide.connected)')); i++) await sleep(200);
  await sleep(800);
  s = await state(r.ev);
  check(`${shell}: reopens maximised`, s.max, s);
  // leave it unmaximised at nm for the next shell
  await r.ev("D.host.win.unmaximize('main')");
  await sleep(300);
  await r.ev(`D.host.win.setBounds('main', ${JSON.stringify(nm)})`);
  await sleep(2600);
  w = readWs();
  check(`${shell}: unmaximised saved`, !w.mainWin.maximized && near(w.mainWin, nm, ['x', 'y', 'width', 'height']), w.mainWin);
  r.ws.close(); kill(r.app); await r.exited;
  return dy;
}

(async () => {
  const order = process.argv.slice(2);
  const backup = fs.existsSync(wsf) ? fs.readFileSync(wsf) : null;
  fs.writeFileSync(wsf, JSON.stringify({
    theme: 'light',
    launchWin: {
      expandedWidth: 950, width: 420, height: 450, expanded: true, x: 100, y: 120,
    },
    mainWin: {
      width: 900, height: 650, x: 300, y: 200, maximized: false,
    },
    dx: 16,
    devTools: false,
  }));
  const dy = spawn('d:\\devel\\dyalog\\20.0\\dyalog.exe', [], { env: { ...process.env, RIDE_INIT: `SERVE:*:${rport}` }, stdio: 'ignore' });
  await sleep(2500);
  try {
    for (const sh of order) await scenario(sh, dy); // eslint-disable-line no-await-in-loop
    console.log('final winstate:', fs.readFileSync(wsf, 'utf8'));
  } catch (e) {
    console.log('ERROR', e);
    results.push({ ok: false });
  } finally {
    kill(dy);
    if (backup) fs.writeFileSync(wsf, backup);
  }
  const bad = results.filter((x) => !x.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
