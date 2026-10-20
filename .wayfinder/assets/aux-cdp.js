// CDP check of RIDE's message-fed auxiliary windows. Usage: node aux-cdp.js [cdpPort]
// Needs a connected RIDE (desktop shell) with remote debugging on cdpPort.
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
const pageFor = async (re) => (await pages()).find((p) => re.test(p.url));
const evIn = async (re, expr) => {
  const p = await pageFor(re);
  if (!p) return { missing: String(re) };
  const c = await connect(p.webSocketDebuggerUrl);
  // a page that closes itself never answers, so give up after a while
  const v = await Promise.race([c.ev(expr), sleep(3000).then(() => ({ timeout: true }))]);
  c.ws.close();
  return v;
};
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.error((ok ? 'ok   ' : 'FAIL ') + name);
};

(async () => {
  const main = (await pages()).find((p) => /index\.html(\?label=main)?$|tauri\.localhost\/?(index\.html)?$/.test(p.url));
  const { ws, ev } = await connect(main.webSocketDebuggerUrl);
  // a closed window's CDP target can linger, so ask the shell
  const gone = async (label) => {
    for (let i = 0; i < 20; i += 1) {
      if (!(await ev(`D.host.win.exists('${label}')`))) return true;
      await sleep(250);
    }
    return false;
  };
  check('aux pages loaded', await pageFor(/type=prf/) && await pageFor(/dialog\.html/) && await pageFor(/status\.html/),
    (await pages()).map((p) => p.url));

  // prefs window: shown, synced both ways, closing hides it
  await ev('D.prf_ui()'); await sleep(800);
  check('prefs shows', /^Preferences/.test(await evIn(/type=prf/, 'document.title')), await evIn(/type=prf/, 'document.title'));
  const ln = await ev('D.prf.lineNums()');
  await evIn(/type=prf/, `D.prf.lineNums(${ln ? 0 : 1})`); await sleep(500);
  const ln2 = await ev('D.prf.lineNums()');
  await ev(`D.prf.lineNums(${ln ? 1 : 0})`); await sleep(500);
  const ln3 = await evIn(/type=prf/, 'D.prf.lineNums()');
  check('prefs sync prf→main→prf', !!ln2 !== !!ln && !!ln3 === !!ln, { ln, ln2, ln3 });
  await evIn(/type=prf/, "D.host.win.close('prf').then(() => 'closed', (e) => e.message)"); await sleep(800);
  check('prefs close hides (page kept)', !!(await pageFor(/type=prf/)));

  // dialog window: StringDialog round trip
  await ev("window.__r = 'none'; D.util.stringDialog({ token: 77, title: 'AuxT', text: 'q', initialValue: 'abc' }, (x) => { window.__r = x; })");
  await sleep(800);
  check('dialog shows', (await evIn(/dialog\.html/, 'document.title')) === 'AuxT');
  await evIn(/dialog\.html/, "document.querySelector('#gd_btns button').click()"); await sleep(800);
  check('dialog replies', JSON.stringify(await ev('window.__r')).includes('abc'), await ev('window.__r'));
  // TaskDialog uses the HTML dialog only where the native one can't show it
  const td = "{ token: 78, title: 'AuxTask', text: 'q', subtext: '', buttonText: ['A', 'B', 'C', 'D'], options: [], questionkey: '', questionlabel: '' }";
  if (await ev(`!(D.win && D.host.dlg.fits({ buttons: ${td}.buttonText }))`)) {
    await ev(`window.__r = 'none'; D.util.taskDialog(${td}, (x) => { window.__r = x; })`);
    await sleep(800);
    await evIn(/dialog\.html/, "document.querySelectorAll('#gd_btns button')[1].click()"); await sleep(800);
    check('task dialog (HTML) replies', JSON.stringify(await ev('window.__r')).includes('101'), await ev('window.__r'));
  }
  // status window
  await ev("D.prf.statusWindow(1); D.ide.handlers.StatusOutput({ text: 'aux-status-ok', flags: 2 })"); await sleep(800);
  check('status output', /aux-status-ok/.test(await evIn(/status\.html/, 'document.body.textContent')));
  await evIn(/status\.html/, "D.host.win.close('status')"); await sleep(800);
  check('status close → pref off, page kept', !(await ev('D.prf.statusWindow()')) && !!(await pageFor(/status\.html/)));

  // about
  await ev('D.abt()'); await sleep(1500);
  check('about content', /IDE:/.test(await evIn(/about\.html/, "document.getElementById('abt_ta').value")));
  await evIn(/about\.html/, "document.getElementById('abt_close').click()"); await sleep(1000);
  check('about closes', await gone('about'));

  // protocol log
  await ev('D.commands.LOG()'); await sleep(1500);
  const l1 = await evIn(/log\.html/, 'document.getElementById("log").textContent.length');
  await ev("D.ide.exec(['1+1\\n'], 0)"); await sleep(1000);
  const l2 = await evIn(/log\.html/, 'document.getElementById("log").textContent.length');
  check('log content and feed', l1 > 0 && l2 > l1, { l1, l2 });
  await evIn(/log\.html/, "D.host.win.close('log')"); await sleep(1000);
  check('log closes', await gone('log'));

  // 3500⌶
  await ev("D.ide.exec([\"3500⌶'<p id=x>aux-3500-one</p>'\\n\"], 0)"); await sleep(1500);
  check('3500 window', /aux-3500-one/.test(await evIn(/html3500\.html/, "document.getElementById('content').srcdoc")));
  await ev("D.ide.exec([\"3500⌶'<p id=x>aux-3500-two</p>'\\n\"], 0)"); await sleep(1500);
  check('3500 window reused', /aux-3500-two/.test(await evIn(/html3500\.html/, "document.getElementById('content').srcdoc"))
    && (await pages()).filter((p) => /html3500/.test(p.url)).length === 1);
  check('3500 content sandboxed', await evIn(/html3500\.html/, "document.getElementById('content').getAttribute('sandbox')"));
  await evIn(/html3500\.html/, "D.host.win.close('html3500')"); await sleep(1000);
  check('3500 closes', await gone('html3500'));

  ws.close();
  console.log(JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
