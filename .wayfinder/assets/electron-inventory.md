# Electron and Node usage inventory

Input to [Design the host adapter interface](../tickets/007-design-host-adapter.md). Snapshot of `tauri-port` at the start of the port. References are `file:line`.

**Legend:** **[OOS]** = belongs to an out-of-scope feature (spawn, listen, SSH, IME installer, browser mode). **(sync)** = synchronous call whose caller relies on the result before continuing. Under Tauri every host call is async, so each (sync) site needs a reshape.

## How Electron reaches the frontend

| Handle | Set in | What it is |
|---|---|---|
| `nodeRequire` | `index.html:834-859` | Node's `require`, stashed so Monaco's AMD loader and golden-layout can take over `require`/`module`/`exports`; restored after. `amdRequire` is Monaco's. |
| `D.el` | `pre_init.js:37` | `@electron/remote`: renderer proxy to the main process's `electron` module. |
| `D.elm` | `pre_init.js:38` | `@electron/remote/main`; used only for `D.elm.enable(webContents)` on each new window. |
| `D.elw` | `pre_init.js:39` | Main `BrowserWindow` (from `global.elw`). |
| `D.ipc` | `pre_init.js:40` | `node-ipc`: local-socket pub/sub between windows. |
| `D` (merge) | `pre_init.js:42` | Main process `global.D` (`win`, `mac`) merged in. |
| `D.win`, `D.mac` | `pre_init.js:43-45` | From `process.platform` (Electron) or `navigator.platform` (browser). |

`main.js` exposes these globals to renderers via `getGlobal`: `D`, `elw`, `winstate`, `open_file`, `js`.

`D.el` does double duty: an API handle **and** the "running in the desktop shell" flag. Roughly 60 sites test `D.el` (or `!D.el`) only to choose desktop or browser behaviour. The adapter needs a separate `isDesktop`-style flag so those checks don't depend on Electron.

### npm runtime dependencies that are Electron/Node-only

`@electron/remote`, `node-ipc`, `os-locale`, `ssh2` **[OOS]**. Dev: `electron`, `electron-connect` (`DEV_STYLE` live-reload, `main.js:154-168`), `spectron`, `@electron/packager`, `@electron/osx-sign`.

## Main process (`main.js`)

All of it gets replaced by the Tauri shell.

| Line | Use | Area |
|---|---|---|
| 10 | `elm.initialize()` | remote bootstrap |
| 13-14 | `process.platform` → `D.win`/`D.mac` | process/env |
| 16-18 | `spectron_temp_dir` → `app.setPath('userData')` | test harness |
| 20-28 | `RIDE_CONF` names the window-state file `userData/<RIDE_CONF or winstate>.json`; `fs.existsSync/readFileSync` | prefs/storage |
| 30-42, 115 | `winstate` defaults: `theme`, `launchWin{width,expandedWidth,height,expanded}`, `mainWin`, `dx` (frame width) | prefs/storage, windows |
| 44-62 | `svNow`: saves `getContentBounds`, `isMaximized`, `isDevToolsOpened` to `winstate.json` (2 s throttle) | windows, prefs/storage |
| 64-92 | `restoreWinPos`: `screen.getDisplayMatching`, off-screen correction | windows |
| 95-110 | main `BrowserWindow` (`nodeIntegration`, `contextIsolation:false`, `enableRemoteModule`, `enableDeprecatedPaste`, icon on Linux, background colour) | windows |
| 117 | `Menu.setApplicationMenu(null)` | menus |
| 119-133 | `ipcMain.on('save-win', onLaunch)`: switches between the launch-page and main-window layouts, restores bounds, maximises | windows, IPC |
| 135-138, 146-149 | `setMenuBarVisibility`/`setAutoHideMenuBar` on enter/leave full screen | menus, windows |
| 138 | `loadURL(file://…/index.html)` | windows |
| 139-151 | move/resize/maximize/close → save state; `closed` clears `global.elw` | windows |
| 152 | `webContents.openDevTools()` if it was open last time | devtools |
| 171 | `window-all-closed` → `app.quit()` | lifecycle |
| 172-176 | macOS `open-file` → `global.open_file` (a `.dws` from Finder) | lifecycle, file IO |
| 177 | `global.js(id, code)`: `executeJavaScript` in any window (test hook) | test harness |

## Connection (`src/cn.js`)

`cn.js` is loaded as a **Node module** (`nodeRequire(\`${__dirname}/src/cn\`)`, `init.js:189`, `km.js:264`), exports via `module.exports` (`:1151`, `:1222-1224`) and sets `global.go` (`:738`). Under Tauri it has to become a plain script or ES module.

| Line | Use | Notes |
|---|---|---|
| 12-20 | `rq('fs')`, `child_process`, `os.homedir()`, `os.networkInterfaces()`, `net`, `path` | |
| 15-17 | `localhosts` from `os.networkInterfaces()` | decides `D.isLocalInterpreter` (`:439`), which gates Open/drag-and-drop of workspaces |
| 20 | `untildify` (home dir) | used by spawn cwd **[OOS]** and validation `:311` **[OOS: start only]** |
| 22 | `process.env.USER/USERNAME` | SSH default user **[OOS]** |
| 37-47 | `Buffer` framing (`toBuf`, `sendEach`, `clt.write`) | **wire framing**: moves to Rust under "Thin Rust" |
| 324-389 | `initInterpreterConn`: `Buffer` receive buffer, 4-byte length + `RIDE` magic parsing, `clt.on('data'/'error'/'end')`, handshake | **wire framing → Rust**; message dispatch (`D.recv`) and handshake logic stay in JS |
| 326, 987 | `ipcRenderer.send('save-win', bool)` | windows (launch↔main layout switch) |
| 422 | `process.env.RIDE_CONNECT_TIMEOUT` | process/env |
| 435-478 | `connect`: `net.connect` or `tls.connect`; TLS reads `cert`/`key`/`rootcertsdir` with `fs`, `checkServerIdentity` CN check | **connection**; TLS currently dead (see [TLS research](../tickets/005-research-tls-connect.md)) |
| 477, 581 | `D.ipc.server.broadcast('nudge')`: "net module needs a nudge" workaround (issue #387) | IPC; probably obsolete under Rust |
| 1215 | `fs.appendFileSync(protocolLogFile)` | file IO (protocol log) |
| 31-34 | default protocol log path: `app.getPath('temp')`, `process.pid` | process/env, file IO |
| 29, 222-231, 786-789 | `connections.json` in `userData`: `existsSync`, `readFileSync`, `writeFileSync`, `statSync().mtime` conflict check | **prefs/storage** |
| 223-225 | `save()` uses `$.confirm(...)` **return value**, but `$.confirm` returns `undefined` → always aborts on mtime conflict | pre-existing bug, (sync) |
| 780 | `getGlobal('winstate')`: mutated live (`launchWin.width/expanded`) and saved by main | windows, prefs |
| 797-799 | F12 → `elw.webContents.toggleDevTools()` | devtools |
| 950-962 | `dialog.showOpenDialogSync` (log, cert, key, ssh key, root-certs dir) | dialogs (sync) |
| 978-988 | `toggleConfig`: `elw.getContentBounds`, `setMinimumSize`, `setContentSize` | windows |
| 1117 | `process.env.RIDE_CONF` → auto-select a saved config | process/env |
| 1129 | `process.env.RIDE_AUTO_START` | process/env |
| 1157-1199 | `process.argv` (`-c/-l/-s/-log`), `RIDE_CONNECT`, `RIDE_LISTEN`, `RIDE_SPAWN`, `RIDE_LOG`, `DYALOG_SPAWN`, `app.getAppPath()`, `getGlobal('open_file')` | process/env; `-c`/`RIDE_CONNECT` in scope, `-l`/`-s`/`DYALOG_SPAWN`/`open_file` **[OOS]** |
| 49-52 | `dyalogArgs`: `process.argv` after `--` | **[OOS]** spawn |
| 113-188 | `getLocalInterpreters`: `reg query` via `cp.execSync`, `fs.readdirSync` of `/Applications`, `/opt/mdyalog` | **[OOS]** spawn (presets) |
| 390-421, 486-528, 878-935 | `ssh2` client, `fs.readFileSync(key)`, port forward, remote `ls` | **[OOS]** SSH |
| 538-582 | `net.createServer` listen, `cp.spawn` respawn | **[OOS]** listen |
| 583-731 | `net.createServer` on `127.0.0.1:0`, `cp.spawn(exe)`, `process.cwd/execPath`, `untildify` | **[OOS]** spawn |

## Windows

| Site | Use |
|---|---|
| `init.js:110-191` | Startup router on `?type=`: `prf` window → `D.IPC_Prf()`, `editor` → `D.IPC_Client(winId)`, else main: `D.IPC_Server()` plus three hidden child `BrowserWindow`s (prefs `index.html?type=prf`, `dialog.html`, `status.html`), `elm.enable`, `elw.focus`, then loads `cn` |
| `ipc.js:92-133` | `IPC_CreateWindow`: floating editor `BrowserWindow` (`parent: elw`), position from `prf.editWins` + per-window offset, `screen.getDisplayMatching` off-screen check |
| `ipc.js:236-252` | `IPC_LinkEditor`: `BrowserWindow.fromId(bwId)`, `show`, `setContentSize`/`setContentBounds` |
| `ipc.js:267-272` | window proxy `close()`: `getContentBounds` → `prf.editWins` |
| `ipc.js:158`, `176` | hide prefs/dialog windows by id |
| `ide.js:420` | status window show/hide by id |
| `ide.js:75`, `714`, `961`, `969`, `se.js:597` | `elw.focus()`, `elw.isFocused()` |
| `ed.js:467`, `491` | floating editor: `getCurrentWindow().focus()` / `.hide()` |
| `ide.js:750-772` | `ShowHTML` (3500⌶): new `BrowserWindow`, `isDestroyed`, writes HTML to `app.getPath('temp')/ib3500.html` with `fs`, `loadURL`, `setTitle` |
| `abt.js:41-60` | About: modal `BrowserWindow` loading `about.html`, `executeJavaScript` to inject text and theme |
| `km.js:249-276` | `LOG` command: protocol-log `BrowserWindow` loading `empty.html`, streams text via `executeJavaScript`; uses `cn.getLog/addLogListener` |
| `init.js:210`, `236-238` | `D.quit = window.close`; `onbeforeunload` stops the IPC server and writes history |
| `ide.js:389` | layout offset `D.el ? 0 : 23` (browser has an HTML menu bar) |
| `dialog.html:29-30`, `:131` | `getCurrentWindow().getContentSize/setContentSize` (auto-height) |
| `status.html:12-13` | `getCurrentWindow().getContentSize` |

## Menus

| Site | Use |
|---|---|
| `menu.js:3-50` | Native menu from the menu DSL: `Menu`, `MenuItem`, `type: radio/checkbox`, `accelerator` from prefs keys, `role`s (`cut`, `copy`, `paste`, `togglefullscreen`, `window`, `help`, `hide`, `hideothers`, `unhide`); `Menu.setApplicationMenu` on mac, `elw.setMenu` elsewhere. `x.checkBoxPref(cb)` live-updates `mi.checked` |
| `menu.js:51+` | HTML menu fallback (browser) |
| `init.js:15-86` | Context menus: `Menu.buildFromTemplate(...).popup()`. Roles `cut/copy/paste/redo/undo`, checkbox items (Trace/Stop/Monitor), `visible` |
| `cn.js:742-776` | Connect-page menu (through `D.installMenu`) |
| `main.js:117`, `135-137` | see main process |

## Dialogs

| Site | Use |
|---|---|
| `util.js:303` `$.alert` | `showMessageBoxSync(elw)` (sync); browser: `alert` |
| `util.js:305-313` `$.err` | `showMessageBoxSync(getCurrentWindow(), {type:'error'})` (sync) |
| `util.js:314-318` `$.confirm` | `showMessageBoxSync` Yes/No, **calls back synchronously** (sync) |
| `util.js:103-118` `optionsDialog` | `showMessageBoxSync(bw)`, picks parent by `focusedWin.bwId` (sync) |
| `util.js:146-152`, `237-243` `stringDialog`/`taskDialog` | show `dialog.html` window via IPC `show` and wait for `dialogClose` |
| `util.js:218-235` `taskDialog` (Windows only) | async `showMessageBox` with `checkboxLabel` |
| `ide.js:1063` | unsaved-changes prompt in floating editor `onbeforeunload` (sync) |
| `km.js:132` `OWS` | `showOpenDialogSync(elw)` (sync); Open is gated on `D.isLocalInterpreter` |
| `cn.js:952` | `showOpenDialogSync` file/dir pickers (sync) |
| `demo.js:46-57` `DMR` | `<input type=file>` and reads `files[0].path` (Electron-only `File.path`) |
| `dialog.html` | whole page is the String/Task dialog window: `node-ipc`, `@electron/remote`, `querystring`, `process.platform` |

## Clipboard

| Site | Use |
|---|---|
| `km.js:53-64` | `CT`/`CP`: `document.execCommand`. `PT`: Electron uses `execCommand('Paste')` (needs `enableDeprecatedPaste`); browser uses `navigator.clipboard.readText` into Monaco |
| `abt.js:67-69` | `clipboard.writeText` (only reachable in the browser branch, so effectively dead) |
| `init.js:52-54` | context-menu `role: cut/copy/paste` |

## Prefs and storage

| Site | Use |
|---|---|
| `prf.js:214-262` | `D.db`: localStorage-shaped (sync `getItem/setItem/removeItem/key/length`) store backed by `RIDE_PREFS` or `userData/prefs.json`; `fs.readFileSync` at load, `fs.writeFileSync` on **every** `setItem`. Browser: `localStorage` |
| `prf.js:203-206` | every pref change broadcast over `node-ipc` (`prf`) server→clients and client→master |
| `prf_col.js:202-217` | theme: writes `getGlobal('winstate').theme` (so main can colour the next launch) and broadcasts `setTheme` |
| `cn.js` | `connections.json` (see Connection) |
| `main.js` | `winstate.json` (see Main process) |
| `se.js:210-228` | persistent session history: `userData/<file>` via `fs` read/write |
| `abt.js:10-16` | About dumps `D.db` contents |

## File IO (other)

| Site | Use |
|---|---|
| `ide.js:673-697` | `RIDE_EDITOR` external editor: `os.tmpdir`, `fs.mkdirSync/writeFileSync/readFileSync/unlinkSync`, `cp.spawn(RIDE_EDITOR)` |
| `ide.js:766-771` | 3500⌶ temp HTML file |
| `demo.js:24`, `41` | `fs.readFile(RIDE_DEMO_SCRIPT)` |
| `init.js:282-306` | drag-and-drop `.dws`: reads `File.path` (Electron-only), then `)load` |
| `init.js:314-326` | `RIDE_JS` / `RIDE_CSS`: `path.delimiter`, `path.resolve(process.cwd())`, `$.getScript(file://…)` |

## Process and env

| Site | Use |
|---|---|
| `abt.js:18-24` | `process.versions.electron/chrome/node`, `platform`, `arch` in About |
| `ide.js:949` | `{RIDE_PID}` caption token: `process.pid` |
| `km.js:14` | `os-locale` `.sync()` → keyboard layout default; browser `navigator.language` |
| `init.js:216` | `process.env.NODE_ENV === 'test'` |
| env vars read | `RIDE_CONF`, `RIDE_PREFS`, `RIDE_CONNECT`, `RIDE_LOG`, `RIDE_CONNECT_TIMEOUT`, `RIDE_AUTO_START`, `RIDE_EDITOR`, `RIDE_DEMO_SCRIPT`, `RIDE_JS`, `RIDE_CSS`, `NODE_ENV`, `spectron_temp_dir`; **[OOS]** `RIDE_LISTEN`, `RIDE_SPAWN`/`ride_spawn`, `DYALOG_SPAWN`, `USER`/`USERNAME` |
| `km.js:83-97` `CNC` | "New Session": `cp.spawn(process.argv)` relaunches RIDE itself with a cleared env. **In scope**: it's how you get back to the Connect page; Tauri needs a relaunch or new-instance equivalent |
| `km.js:151-167` `NEW` | relaunch with `RIDE_SPAWN=lastSpawnedExe` **[OOS]** |
| `prf.js:266-271` | Windows IME: `spawn(windows-ime/set-ime.exe, [pid])` **[OOS]** |

## IPC between windows (`node-ipc`)

The main window is `ride_master` (server, `ipc.js:136-229`), namespaced by `appspace = ride_<timestamp>` and handed to children in the URL (`?appid=`). Clients: `editor<winId>` (`ipc.js:4-63`), `prf` (`ipc.js:65-88`), `dialog` (`dialog.html`), `statusWin` (`status.html`). Messages:

- **master → client:** `caption`, `close`, `getUnsaved`, `prf`, `ED`, `pendingEditor`, `syntax`, `show`, `setTheme`, `add` (status line), `nudge`, plus every name in `pm` (`ipc.js:2-3`: `die execCommand focus insert open processAutocompleteReply prompt saved setTC stateChanged update zoom ReplyFormatCode SetHighlightLine ValueTip`), routed to `D.ide.wins[id][k]`.
- **client → master:** `browserCreated`, `prfCreated`, `prfShow`, `prfClose`, `statCreated`, `statClose`, `dialogCreated`, `dialogClose`, `Edit`, `focusedWin`, `pfKey`, `getStats`, `getSyntax`, `getUnsavedReply`, `getValueTip`, `prf`, `switchWin`, `updPW`, `unblock`, `mounted`, `zoom`, `ABT`, `LOG`, `NEW`, `OWS`, `RIDE` (forward a protocol message to the interpreter), `nudge`.
- **Other senders:** `prf.js:203-206`, `prf_col.js:215`, `ide.js:632`, `956`, `990`, `1023-1024`, `ide.js:852`, `km.js:75`, `128`, `154`, `251`, `prf_ui.js:39`, `47`, `53`, `util.js:149`, `240`, `cn.js:477`, `581`.
- **Lifecycle coupling:** `disconnect` makes clients `window.close()`; `onbeforeunload` handlers in `dialog.html`/`status.html`/prefs veto close and emit `*Close` instead (hide, not destroy).
- **Main↔renderer Electron IPC:** only `save-win` (`cn.js:326`, `987` → `main.js:119`).

## Devtools and printing

| Site | Use |
|---|---|
| `km.js:245-247` `JSC` | `BrowserWindow.getFocusedWindow().webContents.toggleDevTools()` |
| `cn.js:797`, `prf_ui.js:69-71` | F12 toggles devtools |
| `main.js:58`, `152` | devtools-open state persisted and restored |
| `prf_lyt.js:43`, `prf_shc.js:149`, `prf_wins.js:127` | `getCurrentWindow().webContents.print({printBackground:true})` (print keyboard layout / shortcuts / prefs) |

## Misc

| Site | Use |
|---|---|
| `init.js:7-12` | Ctrl+wheel zoom only in Electron (zoom itself is CSS classes, `ide.js:983-996`, not `webFrame`) |
| `init.js:100-107`, `about.html:26-33` | `shell.openExternal`; `window.open` is overridden to open externally. `about.html`'s handler never runs (`nodeIntegration:false`, so `require` is undefined) |
| `init.js:248` | platform CSS class only in Electron |
| `prf_menu.js:55`, `prf_wins.js:26` | prefs UI differs when `!D.el` |
| `index.html:834-868` | `require`/`module`/`exports` juggling around Monaco's AMD loader and golden-layout; `__dirname` as the Monaco `baseUrl`; `self.process.browser = true` |
| `__dirname` | `init.js:163`, `184`, `189`; `abt.js:56`; `km.js:264`, `267`; `prf.js:267`; `index.html:862` (resolves app-relative URLs and files) |
| `dialog.html:5` | CSP `script-src 'self' 'unsafe-inline'` |

## Build tooling (not runtime)

`gruntfile.js` and `generate-licenses.js` use Node (`fs`, `path`, `child_process`) at build time only. They are relevant to the "Build integration" fog item, not to the adapter.

## Takeaways for the adapter design

1. **The interface is large but shallow.** Most sites are window, dialog, and menu plumbing. Only `cn.js` holds real Node logic (sockets and framing), and "Thin Rust" puts that behind a small `connect/send/onData/close` seam.
2. **Sync-to-async is the main reshaping cost.** `$.alert`, `$.err`, `$.confirm`, `optionsDialog`, `showOpenDialogSync` ×2, the `onbeforeunload` save prompt, the `D.db` load at startup, and `getGlobal('winstate')` are all synchronous. `D.db` can stay sync if the adapter preloads it and writes behind; the dialogs need callback or promise call sites (most `$.confirm` callers already pass callbacks).
3. **`D.el` is a capability flag as well as an API.** Split it into a flag and an adapter object so the ~60 behaviour checks survive unchanged.
4. **`node-ipc` maps one-to-one onto label-addressed events** (per [Research how Tauri v2 can support floating editor windows](../tickets/003-research-tauri-floating-windows.md)). The message vocabulary above is the whole contract; `socket` handles become window labels.
5. **Three files live in `userData`** (`prefs.json`, `connections.json`, `winstate.json`) plus session history. [Decide where preferences live under Tauri](../tickets/010-decide-prefs-location.md) has to cover all of them, not only prefs.
6. **`cn.js` is a CommonJS module** loaded through `nodeRequire`, so it must change shape regardless of shell.
7. **Electron-only DOM extensions** (`File.path` in drag-and-drop and `DMR`, `execCommand('Paste')` with `enableDeprecatedPaste`) need Tauri replacements: the drag-drop event payload, and the clipboard plugin or `navigator.clipboard`.
8. **"New Session" (`CNC`) relaunches the process.** It's in scope, so the adapter needs a relaunch or new-instance primitive.
9. **Pre-existing bugs found:** `cn.js` `save()` uses `$.confirm`'s return value, which is always `undefined`; the `abt.js` clipboard branch and the `about.html` `openExternal` handler are unreachable.
