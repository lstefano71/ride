const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = process.argv[2] || 9222;
const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((p) => p.type === 'page');
const connect = (url) => new Promise((res) => { const ws = new WebSocket(url); let id = 0; const pend = {};
  ws.on('message', (m) => { const x = JSON.parse(m); if (x.id && pend[x.id]) pend[x.id](x); });
  ws.on('open', () => res({ ws, ev: (e) => new Promise((r) => { id += 1; pend[id] = (x) => r(x.result && x.result.result ? x.result.result.value : x); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true, awaitPromise: true } })); }) })); });
(async () => {
  const main = (await pages()).find((p) => /index\.html$|tauri\.localhost\/?(index\.html)?$/.test(p.url));
  const m = await connect(main.webSocketDebuggerUrl);
  console.log('sqp', await m.ev('D.prf.sqp()'));
  // answer "No" first: the window must stay
  await m.ev("$.confirm = (msg, t, f) => { window.__conf = msg; setTimeout(() => f(0), 300); }; 1");
  m.ev('D.quit()'); await sleep(1500);
  console.log('after No:', await m.ev('window.__conf'), 'connected', await m.ev('D.ide.connected'));
  await m.ev("$.confirm = (msg, t, f) => { window.__conf2 = msg; setTimeout(() => f(1), 300); }; 1");
  m.ev('D.quit()'); await sleep(1500);
  console.log('after Yes: pages', await pages().then((p) => p.length, () => 'cdp gone'));
  process.exit(0);
})().catch((e) => { console.log('err', e.message); process.exit(0); });
