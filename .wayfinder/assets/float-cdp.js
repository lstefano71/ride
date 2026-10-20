// CDP check of floating editor windows. Usage: node float-cdp.js [cdpPort]
// Needs a connected RIDE (desktop shell) with remote debugging on cdpPort.
// Dialogs in the editor window are stubbed (answer "No"), since native ones can't be clicked.
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
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.error(`${ok ? 'ok   ' : 'FAIL '}${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
};

(async () => {
  const main = (await pages()).find((p) => /index\.html(\?label=main)?$|tauri\.localhost\/?(index\.html)?$/.test(p.url));
  const { ws, ev } = await connect(main.webSocketDebuggerUrl);
  const sess = () => ev('D.ide.wins[0].me.getValue()');
  const exec = async (s) => { await ev(`D.ide.exec([${JSON.stringify(s)}],0)`); await sleep(1200); };
  const lastLines = async () => (await sess()).split('\n').slice(-3).join(' | ');
  // whether the editor window is shown, asked of the shell
  const visible = (label) => ev(`D.host.kind === 'tauri'
    ? window.__TAURI__.webviewWindow.WebviewWindow.getByLabel('${label}').then((w) => w && w.isVisible())
    : D.el.BrowserWindow.getAllWindows()
      .some((w) => w.isVisible() && /type=editor/.test(w.webContents.getURL()))`);
  let ed = null;
  const editorPage = async () => {
    for (let i = 0; i < 40; i += 1) {
      const p = (await pages()).find((x) => /type=editor/.test(x.url));
      if (p) return p;
      await sleep(250);
    }
    return null;
  };
  const evEd = async (expr) => {
    if (!ed) {
      const p = await editorPage();
      if (!p) return { missing: 'editor page' };
      ed = await connect(p.webSocketDebuggerUrl);
    }
    return Promise.race([ed.ev(expr), sleep(4000).then(() => ({ timeout: true }))]);
  };
  const edWin = "Object.values(D.ide.wins).find((w) => w.name === 'FloatF')";

  const was = await ev('[D.prf.floating(), D.prf.editWinsRememberPos(), JSON.stringify(D.prf.editWins())]');
  await ev('D.prf.floating(1)'); await sleep(500);
  await exec("⎕FX 'r←FloatF x' 'r←x+1'");

  // open: a window of its own, placed on screen
  await exec(')ed FloatF');
  await sleep(1500);
  const p = await editorPage();
  check('editor opens in its own window', p, p && p.url);
  const label = await evEd('D.host.win.current()');
  check('editor window shown', await visible(label), label);
  check('editor has the source', /r←x\+1/.test(await evEd(`${edWin}.me.getValue()`)));
  const b = await ev(`D.host.win.getBounds('${label}')`);
  const area = await ev(`D.host.win.displayFor(${JSON.stringify(b)})`);
  check('bounds within the display', b && area && b.width > 100 && b.height > 100
    && b.x >= area.x - 20 && b.y >= area.y - 20
    && b.x + b.width <= area.x + area.width + 20, { b, area });

  // setBounds/getBounds round trip (content bounds)
  const want = { x: area.x + 150, y: area.y + 120, width: 640, height: 420 };
  await ev(`D.host.win.setBounds('${label}', ${JSON.stringify(want)})`);
  await sleep(500);
  const got = await ev(`D.host.win.getBounds('${label}')`);
  check('setBounds → getBounds round trip', got && ['x', 'y', 'width', 'height']
    .every((k) => Math.abs(got[k] - want[k]) <= 1), { want, got });

  // edit and save (EP): reaches the interpreter, window hides but stays
  await evEd(`(() => { const w = ${edWin}; w.me.setValue('r←FloatF x\\nr←x+100'); w.EP(w.me); })()`);
  await sleep(1500);
  await exec('FloatF 1');
  check('saved edit reaches the interpreter', /\b101\b/.test(await lastLines()), await lastLines());
  check('window hidden after closing its editor', !(await visible(label)));
  check('window kept for reuse', await ev(`D.host.win.exists('${label}')`));

  // reopen reuses the window; [X] with unsaved changes asks, "No" discards
  await exec(')ed FloatF');
  await sleep(1500);
  check('reopen reuses the window', (await pages()).filter((x) => /type=editor/.test(x.url)).length === 1
    && await visible(label));
  await evEd(`(() => {
    window.asked = [];
    D.host.dlg.message = (o) => { window.asked.push(o.message); return Promise.resolve({ button: 1, checked: false }); };
    ${edWin}.me.setValue('r←FloatF x\\nr←x+999');
  })()`);
  await evEd(`D.host.win.close('${label}')`);
  await sleep(1500);
  const asked = await evEd('window.asked');
  check('[X] with unsaved changes asks to save', Array.isArray(asked) && asked.length === 1 && /FloatF/.test(asked[0]), asked);
  check('[X] is vetoed: window kept, hidden', await ev(`D.host.win.exists('${label}')`) && !(await visible(label)));
  await exec('FloatF 1');
  check('"No" discards the change', /\b101\b/.test(await lastLines()), await lastLines());

  // [X] with no changes closes without asking
  await exec(')ed FloatF');
  await sleep(1500);
  await evEd('window.asked = []');
  await evEd(`D.host.win.close('${label}')`);
  await sleep(1500);
  check('[X] unchanged closes without asking', (await evEd('window.asked.length')) === 0 && !(await visible(label)));
  check('session still works', await ev('D.ide.connected') && (await exec('2+2'), /\b4\b/.test(await lastLines())));

  ed && ed.ws.close();
  await exec(')erase FloatF');
  await ev(`(() => { const [f, r, w] = ${JSON.stringify(was)}; D.prf.floating(f); D.prf.editWinsRememberPos(r); D.prf.editWins(JSON.parse(w)); })()`);
  ws.close();
  console.log(JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
