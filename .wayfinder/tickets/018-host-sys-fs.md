---
title: Move process, env, file and misc calls onto D.host.sys and D.host.fs
type: wayfinder:task
status: closed
assignee: copilot
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

## Resolution

Done. Every site listed above now goes through `D.host.sys` / `D.host.fs` and works in both shells. [sys-cdp.js](../assets/sys-cdp.js) passes 15/15 in both shells (Electron skips drag and drop). Under Tauri, smoke passes 7/7, [float-cdp.js](../assets/float-cdp.js) 14/14 and [aux-cdp.js](../assets/aux-cdp.js) 17/17. New Session, print and openExternal were checked by hand. Release exe: **8.77 MB** (was 8.40).

**Rust side**
- `src-tauri/src/sys.rs`: the snapshot is injected synchronously into every webview as `window.__RIDE_SYS__` through an inline plugin's `js_init_script`. It has to be synchronous because `km.js` reads `locale` at script load, before `D.host.ready`. Commands: `sys_relaunch(env)` (respawns `current_exe` with the same args and env overrides), `sys_toggle_devtools(label)`, `sys_print(label)`.
- `src-tauri/src/fs.rs`: async `fs_read_text`/`fs_write_text`/`fs_append_text`/`fs_remove`.
- New dependencies: `tauri-plugin-opener` (openExternal; default scope is http(s)/mailto/tel, so `file:` URLs are refused), `tauri-plugin-clipboard-manager`, `sys-locale`, and tauri's `devtools` feature. `devtools` uses private APIs on macOS, which would matter for App Store distribution.

**Interface, as built (additions to [the design](007-design-host-adapter.md#resolution))**
- `sys.versions` is shell-specific (`{electron, chrome, node}` / `{tauri, webview}`). About maps the keys to display names and adds a Platform line.
- `sys.env` is case-insensitive on Windows under Tauri (a Proxy), matching Node. `relaunch(env)` values are strings; `''` clears a variable.
- `fs` calls are chained per path under Tauri, so appends keep their order. `fs.remove` treats a missing file as success.
- New `win.onFileDrop(fn(paths))`: the Tauri drag-drop payload, and in Electron `webUtils.getPathForFile`. Electron 35 removed `File.path`, so **drag-and-drop of `.dws` was silently broken on `master`**; this fixes it.
- `D.win`/`D.mac` are set from `sys.platform` under Tauri, and the menu's `navigator.platform` check is gone.

**Behaviour changes**
- `RIDE_JS` is read and `$.globalEval`'d, and `RIDE_CSS` is injected as `<style>` text. Before, they were loaded through `file://` URLs, which Tauri can't load. Relative `url()`s inside a `RIDE_CSS` file therefore no longer resolve. Both accept a path list (`;` on Windows, `:` elsewhere).
- Paste (PT) reads the clipboard and inserts the text, through Monaco `trigger('keyboard','paste')` or `execCommand('insertText')` outside an editor. This replaces `execCommand('Paste')`.
- New Session is `D.newSession()`: relaunch with `RIDE_CONNECT`/`RIDE_SPAWN`/`DYALOG_SPAWN` cleared and `RIDE_AUTO_START=0`. `mayClose` with `connectOnQuit` now awaits it rather than calling `CNC` (an async relaunch from inside close could re-enter close). History is written before.
- `RIDE_LISTEN`/`RIDE_SPAWN`/`DYALOG_SPAWN` under Tauri show a warning toast and are ignored (spawn and listen are out of scope). `localhosts` under Tauri is loopback only, as allowed.
- DMR uses `D.host.dlg.open` instead of a hidden `<input type=file>`.
- `window.open` and `D.openExternal` go to `sys.openExternal` whenever `D.desktop` is set, and `window.electronOpen` is gone.
- Print: Tauri opens WebView2's print preview. The page's JS is blocked while it is open, and the promise resolves once it closes. In Electron, printing to "Microsoft Print to PDF" logs "content size is empty" and shows nothing. This happens on `master` too with the same call, so it is not a regression.

**Still on `D.el`, deliberately**: `cn.js` spawn/listen/SSH (out of scope), `prf.js` IME `set-ime.exe` (IME installer, out of scope), `ide.js` `RIDE_EDITOR`, the `global.go`/`NODE_ENV==='test'` hooks (out of scope), and `winstate`/`toggleConfig` (window bounds/layouts ticket).

**Seen while testing, not changed**: `prefs.json` is shared by both shells and every window. Once, a `title` pref set by a test (`{RIDE_PID}`) survived its restore while two instances were running. It did not reproduce in either shell on a single instance. This is the decided "last writer wins" of [Decide where preferences live under Tauri](010-decide-prefs-location.md#resolution).
