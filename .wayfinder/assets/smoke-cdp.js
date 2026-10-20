// CDP smoke check for RIDE. Usage: node smoke.js [cdpPort]
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
  const sess = () => ev('D.ide.wins[0].me.getValue()');
  const exec = async (s, tc = 0) => { await ev(`D.ide.exec([${JSON.stringify(s)}],${tc})`); await sleep(1500); };

  check('connected', await ev('!!D.ide && !!D.ide.connected'), await ev('document.title'));

  await exec('⍳5');
  check('execute ⍳5', /\n?\s*1 2 3 4 5/.test(await sess()), (await sess()).split('\n').slice(-4).join(' | '));

  await exec('⎕IO←0 ⋄ +/⍳10');
  check('execute +/⍳10', /\b45\b/.test(await sess()));

  await exec("⎕FX 'r←SmokeF x' 'r←x+1' 'r←r×2'");
  await exec(')ed SmokeF');
  const edWins = await ev("Object.values(D.ide.wins).filter(w=>w.id&&!w.tc).map(w=>w.name||w.id)");
  check('editor opens (docked)', edWins && edWins.length, edWins);
  await ev("Object.values(D.ide.wins).filter(w=>w.id&&!w.tc).forEach(w=>D.send('CloseWindow',{win:w.id}))");
  await sleep(1000);

  await exec('SmokeF 3', 1);
  const tcWins = await ev("Object.values(D.ide.wins).filter(w=>w.tc).map(w=>w.name||w.id)");
  check('tracer opens', tcWins && tcWins.length, tcWins);
  await ev("Object.values(D.ide.wins).filter(w=>w.tc).forEach(w=>D.send('StepInto',{win:w.id}))");
  await sleep(800);
  await ev("Object.values(D.ide.wins).filter(w=>w.tc).forEach(w=>D.send('Continue',{win:w.id}))");
  await sleep(1500);
  check('trace continues to result 8', /\b8\b/.test((await sess()).split('\n').slice(-3).join(' ')), (await sess()).split('\n').slice(-3).join(' | '));

  const wasFloating = await ev('D.prf.floating()');
  await ev('D.prf.floating(1)'); await sleep(800);
  await exec(')ed SmokeF');
  await sleep(1500);
  const floatPages = (await pages()).filter((p) => /SmokeF/.test(p.title));
  check('floating editor window', floatPages.length, floatPages.map((p) => `${p.title} ${p.url}`));
  await ev("Object.values(D.ide.wins).filter(w=>w.id&&!w.tc).forEach(w=>D.send('CloseWindow',{win:w.id}))");
  await sleep(1000);
  await ev(`D.prf.floating(${JSON.stringify(wasFloating)})`);

  await exec(")erase SmokeF");
  ws.close();
  console.log(JSON.stringify(results, null, 1));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
