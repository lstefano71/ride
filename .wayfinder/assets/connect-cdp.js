// Repro for ticket 019: N fresh Tauri starts against Dyalog 20, collect exceptions over CDP.
// Usage: node deco-repro.js <exe> <runs> [cdpPort]
const { spawn, execSync } = require('child_process');
const WebSocket = require(process.env.WS_PATH || 'ws');

const exe = process.argv[2];
const runs = +process.argv[3] || 10;
const port = +process.argv[4] || 9223;
const rport = 4612;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (p) => { try { execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' }); } catch (e) { /* gone */ } };

async function pages() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json`);
    return (await r.json()).filter((p) => p.type === 'page');
  } catch (e) { return []; }
}

async function once(n) {
  const dy = spawn('d:\\devel\\dyalog\\20.0\\dyalog.exe', [], {
    env: { ...process.env, RIDE_INIT: `SERVE:*:${rport}` }, detached: false, stdio: 'ignore',
  });
  await sleep(2500);
  const app = spawn(exe, process.env.ARGS ? process.env.ARGS.split(' ') : [], {
    env: {
      ...process.env,
      RIDE_CONNECT: `127.0.0.1:${rport}`,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: 'ignore',
  });
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = (await pages()).find((p) => /tauri\.localhost\/?$|index\.html$/.test(p.url));
    if (!main) await sleep(100);
  }
  const errs = [];
  let connected = false;
  if (main) {
    const ws = new WebSocket(main.webSocketDebuggerUrl);
    let id = 0; const pend = {};
    ws.on('message', (m) => {
      const x = JSON.parse(m);
      if (x.id && pend[x.id]) { pend[x.id](x); delete pend[x.id]; }
      if (x.method === 'Runtime.exceptionThrown') {
        const d = x.params.exceptionDetails;
        errs.push(`${(d.exception && d.exception.description || d.text).split('\n').slice(0, 3).join(' / ')}`);
      }
      if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') {
        errs.push(`console.error: ${x.params.args.map((a) => a.value || a.description).join(' ')}`);
      }
    });
    await new Promise((r) => ws.on('open', r));
    const ev = (expr) => new Promise((r) => {
      id += 1; pend[id] = (x) => r(x.result && x.result.result ? x.result.result.value : x);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
    });
    ws.send(JSON.stringify({ id: 999999, method: 'Runtime.enable' }));
    await sleep(4000);
    connected = await ev('!!(window.D && D.ide && D.ide.connected)');
    if (process.env.PROBE) console.log('  probe:', JSON.stringify(await ev(process.env.PROBE)));
    ws.close();
  }
  kill(app); kill(dy);
  await sleep(1000);
  console.log(`run ${n}: page=${!!main} connected=${connected} errors=${errs.length}${errs.length ? `\n  ${errs.join('\n  ')}` : ''}`);
  return errs.length;
}

(async () => {
  let bad = 0;
  for (let i = 1; i <= runs; i++) bad += (await once(i)) > 0;
  console.log(`${bad}/${runs} runs with errors`);
  process.exit(bad ? 1 : 0);
})();
