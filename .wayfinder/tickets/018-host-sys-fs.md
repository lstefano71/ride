---
title: Move process, env, file and misc calls onto D.host.sys and D.host.fs
type: wayfinder:task
status: open
assignee:
blocked_by: ["012"]
---

## Question

Implement the `D.host.sys` snapshot (`env`, `argv`, `platform`, `arch`, `pid`, `versions`, `locale`, `tempDir`) and the async `relaunch`, `toggleDevTools`, `print`, `openExternal`, `clipboard`, plus `D.host.fs` (`readText`, `writeText`, `appendText`, `remove`). Move onto them: `process.env`/`argv` reads (`-c`, `RIDE_CONNECT`, `RIDE_CONF`, `RIDE_LOG`, …), "New Session" relaunch, F12/JSC devtools, printing, `window.open`/openExternal, paste (`execCommand('Paste')` replacement), the protocol log, drag-and-drop `.dws` (Tauri drag-drop payload instead of `File.path`), `RIDE_JS`/`RIDE_CSS`, `RIDE_DEMO_SCRIPT`/`DMR`, and the About versions. Done when each works in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `abt.js:18` (versions), `km.js:14` (locale), `km.js:57` (paste), `km.js:84` (CNC relaunch), `km.js:246` (JSC devtools), `prf_ui.js:70` (F12)
- `ide.js:949` (`{RIDE_PID}`)
- `init.js`: `D.openExternal`/`window.open` override, drag-and-drop, `RIDE_JS`/`RIDE_CSS`
- `demo.js:41`, `47` (`RIDE_DEMO_SCRIPT`, `DMR`)
- `prf_lyt.js:43`, `prf_shc.js:149`, `prf_wins.js:127` (print)
