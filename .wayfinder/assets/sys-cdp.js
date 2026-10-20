// CDP check for D.host.sys and D.host.fs. Usage: node sys-cdp.js [cdpPort]
// Expects RIDE started with RIDE_CONNECT, RIDE_LOG, RIDE_JS (a script that increments
// window.__rideJs), RIDE_CSS (a sheet containing "ride_css_marker") and RIDE_DEMO_SCRIPT
// (first line "⍳3").
const WebSocket = require(process.env.WS_PATH || 'ws');

const port = process.argv[2] || 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pages() {
  const r = await fetch(`http://127.0.0.1:${port}/json`);
  return (await r.json()).filter((p) => p.type === 'page');
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let id = 0; const pend = {};
    ws.on('message', (m) => {
      const x = JSON.parse(m);
      if (x.id && pend[x.id]) { pend[x.id](x); delete pend[x.id]; }
    });
    ws.on('open', () => res({
      ws,
      ev: (expr) => new Promise((r) => {
        id += 1; pend[id] = (x) => r(x.result && x.result.result ? x.result.result.value : x);
        ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
      }),
    }));
    ws.on('error', rej);
  });
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };

(async () => {
  const main = (await pages()).find((p) => /index\.html$|tauri\.localhost\/?$/.test(p.url));
  const { ws, ev } = await connect(main.webSocketDebuggerUrl);
  const s = await ev(`(() => { const s = D.host.sys; return {
    kind: D.host.kind, platform: s.platform, arch: s.arch, pid: s.pid, locale: s.locale,
    tempDir: s.tempDir, versions: s.versions, argv: s.argv, conn: s.env.RIDE_CONNECT,
    connLower: s.env.ride_connect, log: s.env.RIDE_LOG, win: D.win, mac: D.mac }; })()`);
  check('sys snapshot', s.platform && s.arch && s.pid > 0 && s.locale && s.tempDir
    && Object.keys(s.versions).length && Array.isArray(s.argv) && s.conn, JSON.stringify(s));
  check('env case-insensitive', s.platform !== 'win32' || s.connLower === s.conn, s.connLower);
  check('D.win/D.mac', s.win === (s.platform === 'win32') && s.mac === (s.platform === 'darwin'));

  check('connected', await ev('!!D.ide && !!D.ide.connected'));
  const lg = await ev(`D.host.fs.readText(${JSON.stringify(s.log)}).then((t) => t.split('\\n').length + ' ' + /Identify/.test(t), (e) => 'ERR ' + e.message)`);
  check('protocol log (RIDE_LOG)', /^\d+ true$/.test(lg) && +lg.split(' ')[0] > 3, lg);

  check('RIDE_JS', await ev('window.__rideJs') === 1, await ev('window.__rideJs'));
  check('RIDE_CSS', await ev("[...document.querySelectorAll('style')].some((x) => /ride_css_marker/.test(x.textContent))"));

  const about = await ev('D.aboutDetails()');
  check('About versions', new RegExp(`Platform: ${s.platform}-${s.arch}`).test(about)
    && /\n {2}(Tauri|Electron): \d/.test(about), about.split('\n').slice(0, 7).join(' | '));

  // fs round trip
  const f = `${s.tempDir}${s.platform === 'win32' ? '\\' : '/'}ride-sys-cdp-${s.pid}.txt`;
  const fsr = await ev(`(async () => { const fs = D.host.fs, f = ${JSON.stringify(f)};
    await fs.writeText(f, 'a⍳'); await fs.appendText(f, 'b'); await fs.appendText(f, 'c');
    const t = await fs.readText(f); await fs.remove(f); await fs.remove(f);
    const gone = await fs.readText(f).then(() => false, () => true);
    return t + ' ' + gone; })()`);
  check('fs write/append/read/remove', fsr === 'a⍳bc true', fsr);

  // clipboard and paste (PT) into the session
  const cb = await ev("D.host.sys.clipboard.writeText('⍴⍳4').then(() => D.host.sys.clipboard.readText())");
  check('clipboard', cb === '⍴⍳4', cb);
  const se = 'D.ide.wins[0].me';
  await ev(`(() => { const m = ${se}; const n = m.getModel().getLineCount(); m.setPosition({ lineNumber: n, column: m.getModel().getLineMaxColumn(n) }); })()`);
  await ev(`D.commands.PT(${se})`);
  await sleep(500);
  const last = await ev(`(() => { const m = ${se}.getModel(); return m.getLineContent(m.getLineCount()); })()`);
  check('paste (PT)', /⍴⍳4$/.test(last), last);
  await ev(`(() => { const m = ${se}; const n = m.getModel().getLineCount(); m.executeEdits('t', [{ range: new monaco.Range(n, 1, n, m.getModel().getLineMaxColumn(n)), text: '      ' }]); })()`);

  // demo script (RIDE_DEMO_SCRIPT)
  await ev('D.commands.DMN()');
  await sleep(300);
  const dl = await ev(`(() => { const m = ${se}.getModel(); return m.getLineContent(m.getLineCount()); })()`);
  check('demo script (DMN)', /⍳3/.test(dl), dl);

  // {RIDE_PID} in the window caption template
  const cap = await ev("D.ide.caption && 0, (() => { const p = D.prf.title(); D.prf.title('{RIDE_PID}'); const t = document.title; D.prf.title(p); return t; })()");
  check('{RIDE_PID}', String(cap).includes(String(s.pid)), cap);

  // devtools toggle (opens, then closes)
  const dt = await ev('D.host.sys.toggleDevTools(D.host.win.current()).then(() => new Promise((r) => setTimeout(r, 1500))).then(() => D.host.sys.toggleDevTools(D.host.win.current())).then(() => "ok", (e) => "ERR " + e.message)');
  check('toggleDevTools', dt === 'ok', dt);

  // drag and drop: simulate a drop through the adapter's own path
  const dd = await ev(`(async () => { let msg = null; const c = $.confirm; $.confirm = (m) => { msg = m; };
    try {
      if (D.host.kind === 'tauri') {
        await window.__TAURI__.event.emitTo({ kind: 'Webview', label: 'main' }, 'tauri://drag-drop', { paths: ['C:\\\\x\\\\demo.dws'], position: { x: 10, y: 10 } });
        await new Promise((r) => setTimeout(r, 500));
      } else return 'skip';
    } finally { $.confirm = c; }
    return msg; })()`);
  check('drag and drop', dd === 'skip' || /\)load demo\.dws\?/.test(dd), dd);

  ws.close();
  results.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail != null ? ` — ${r.detail}` : ''}`));
  console.log(`${results.filter((r) => r.ok).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
