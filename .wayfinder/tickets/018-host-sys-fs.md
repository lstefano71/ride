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
- `cn.js` (handed over by [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)), each guarded by `D.el` and empty under Tauri: `start()`'s argv/env (`-c`, `RIDE_CONNECT`, `RIDE_LISTEN`, `RIDE_SPAWN`, `RIDE_LOG`, `RIDE_CONF`, `DYALOG_SPAWN`, `open_file`), `penv` (`RIDE_CONNECT_TIMEOUT`, `RIDE_AUTO_START`, `USER`), `defaultProtocolLogFile` (temp dir + pid), the protocol log `appendFileSync` in `log`, F12 devtools in `I.cn.onkeyup`, and `localhosts` (`os.networkInterfaces`, which feeds `D.isLocalInterpreter`; Tauri falls back to `localhost`/`127.0.0.1`/`::1`).

**Handed over by [Move native and context menus onto D.host.menu](016-host-menus.md#resolution):**

- File > New Session (`CNC`) is now in Tauri's native menu and still relaunches through `D.el`.
- `D.mac`/`D.win` are undefined under Tauri, so the menu DSL's `{mac}` items are hidden. `src/host/tauri.js` detects macOS on its own from `navigator.platform`. Once `D.host.sys.platform` exists, set the flags from it and drop that check.
