---
title: Replace node-ipc with D.host.ipc and message-fed aux windows
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["012"]
---

## Question

Implement `D.host.ipc` (`send(label, type, data)`, `broadcast`, `on`): Tauri events addressed by window label, and `node-ipc` or Electron IPC in Electron. Move `ipc.js` and every sender site onto it, using window labels instead of sockets. Move the frontend's window calls onto `D.host.win` (Electron implementation), including `onCloseRequested` for the hide-not-close vetoes and the unsaved-changes prompt. Make About, LOG and 3500⌶ request their content over ipc on load (no `executeJavaScript`, no temp file). The Tauri `D.host.win` side is [Port floating windows to Tauri windows](011-floating-windows-tauri.md). Done when Electron runs with `floating=1` on the new channel, and docked mode (prefs, dialog, status, About, LOG, 3500⌶) works in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `init.js`: the `D.host.kind === 'electron'` main-window branch creating the hidden prefs, dialog and status `BrowserWindow`s. The `?type=prf`/`editor` routes already use `D.desktop` and `URLSearchParams`, but still call `D.ipc`.
- `abt.js:41` (About window), `abt.js:67`, `75` (copy button)
- `km.js:75`, `127`, `153` (floating clients forward `ABT`/`OWS`/`NEW`), `km.js:249` (LOG window)
- `ide.js:420`, `851` (status window), `ide.js:752` (3500⌶)
- `prf_ui.js:38`, `48`, `103`, `113` (prefs as its own window)
- Aux pages (`dialog.html`, `status.html`, `about.html`, `empty.html`) already load both adapters and get `D.host`/`D.desktop` (no `D.el`).

**Handed over by [Make dialogs async on D.host.dlg](015-host-dialogs.md#resolution):**

- The unsaved-changes prompt in `ide.js` `onbeforeunload` already calls `D.host.dlg.message`. Only the veto mechanics move to `onCloseRequested`.
- `src-tauri/capabilities/default.json` grants `dialog:allow-message`/`allow-open` (and `core:default`) to the `main` window only. Add each new window label, or dialogs and IPC from those windows will be denied.
- Electron dialogs are parented to the focused app window. If you need a specific window, add a `parent` label option to `D.host.dlg`.

**Handed over by [Move native and context menus onto D.host.menu](016-host-menus.md#resolution):**

- The native menu now shows under Tauri, so View > Show Status Window (`ide.js:420`, `D.el.BrowserWindow`) and Help > About are reachable there and still hit `D.el` code.
- Context menus pop up without a parent window: Electron uses the focused window, and Tauri uses the calling window. Floating editors get them for free once they load the adapters.

## Resolution

**Done. `node-ipc` is gone, including from `package.json`. Every window talks through `D.host.ipc`, addressed by window label. The frontend's window calls go through `D.host.win`. About, LOG and 3500⌶ ask the main window for their content when they load. Electron passes the smoke check 7/7 with `floating=1`. Docked mode works in both shells: prefs, dialog, status, About, LOG and 3500⌶. Quit confirmation now works under Tauri too.** One boundary moved: docked mode in both shells needed a basic Tauri `D.host.win` here, to open the aux windows. Floating editors, plus `getBounds`/`setBounds`/`displayFor`, stay in [Port floating windows to Tauri windows](011-floating-windows-tauri.md). Under Tauri those three return `ENOTSUP`.

**Contract as built** (both adapters):

- `D.host.ipc.send(label, type, data)`, `broadcast(type, data)` (every other window), `on(type, fn(data, fromLabel)) → unsubscribe`. Payloads travel as JSON in both shells. A sender never receives its own message.
  - Electron: `main.js` relays the messages, because `ipcRenderer.sendTo` is gone in Electron 35. Pages register their label synchronously (`host-register`). `host-ipc` delivers the message to one label, or to all except the sender. `host-lookup` maps a label to a `BrowserWindow` id. The label comes from the page URL's `?label=` (default `main`).
  - Tauri: the `ride-ipc` event goes through `emitTo(label)` / `emit`. Each window listens on its own `WebviewWindow` and drops messages addressed to other windows. `D.host.ready` waits for the listener, because events sent before it exists are lost. So aux pages announce themselves (`xCreated`/`xGet`) only after `D.host.ready`.
- `D.host.win`: `current()` (sync label), `open(label, page, {parent, bounds, hidden, modal, title, minWidth, minHeight, resizable, minimizable, maximizable}) → true` if the window is new. If the label is already open, it resolves `false` and the window is shown and focused unless `hidden`. Also `exists`, `show`, `hide`, `focus`, `close`, `isFocused`, `setTitle`, `setContentSize`, `setMinSize`, `getBounds`/`setBounds` (content bounds), `displayFor(bounds) → workArea`, and `onCloseRequested(label, fn → bool|Promise<bool>)`.
  - Electron: `onCloseRequested` works on the current window only (`@electron/remote` callbacks can't `preventDefault`). It runs on `onbeforeunload`. A sync `true` lets the window close. Anything else vetoes, then closes again once the promise resolves `true`.
  - Tauri: `onCloseRequested` calls `preventDefault` unless `fn` resolves `true`. `modal` is ignored, because Tauri has no modal windows.
- Rust (`lib.rs`): destroying `main` exits the app, so the hidden aux windows can't keep it alive. Capabilities now cover `main, prf, dialog, status, about, log, html3500`. Window show/hide/focus/close/destroy/title/size/min-size and `create-webview-window` are granted.

**Sites moved:**

- `ipc.js` is rewritten on `D.host`. `IPC_Server` (main) is the hub. Floating clients use `ide.ipc = {emit → send('main', …)}`. `IPC_WindowProxy(seq, label)` replies by label. Editor windows are labelled `editor<N>`. `WindowRect` and `IPC_LinkEditor` are async through `displayFor`/`setBounds`. New server requests: `abtGet`, `logGet`/`logClose` (a live feed through `cn.addLogListener`) and `html3500Get`.
- `init.js`: there is one desktop main-window branch for both shells. It opens hidden `prf`, `dialog` and `status` windows and waits for their `xCreated` before `D.cn.start()`. The main window's close/quit confirmation runs through `onCloseRequested('main', …)`, and `D.quit` closes the current window through the shell. **This also removes WebView2's renderer-blocking "Reload site?" prompt on close** (see the window-bounds fog). Browser mode keeps `window.onbeforeunload`.
- `prf.js` (main broadcasts, the others send to main), `prf_col.js` (main broadcasts `setTheme`), `prf_ui.js:38`, `48`, `103`, `113`, `util.js` (`stringDialog`/`taskDialog` HTML path), `ide.js:420`, `549`, `632`, `752` (3500⌶), `851`, `956`, `990`, `1023` (line numbers before the change), `abt.js` (window, plus the dead `D.el` clipboard branch), and `km.js` `ABT`/`OWS`/`NEW`/`LOG`.
- `dialog.html` and `status.html` run on `D.host` with no `require`. Closing them hides them instead (main gets the veto messages). `about.html` asks for `abt`. New `log.html` asks for `log` and gets a `logAdd` feed. New `html3500.html` renders the interpreter's HTML in an `<iframe sandbox srcdoc>`, so that HTML can't reach the adapters (Electron used a sandboxed window and a temp file before). `stage-frontend.js` stages the new pages, and `mk` already packages `*.html`.
- Page scripts must not declare top-level `ipc`/`win`. Under Tauri `const { ipc } = …` throws "Identifier 'ipc' has already been declared", so the pages use `hostIpc`/`hostWin`.

**Left in place / handed over:**

- [Port floating windows to Tauri windows](011-floating-windows-tauri.md): Tauri `getBounds`/`setBounds`/`displayFor`, the `editor*` capability, `prf_wins.js:26`, `ide.js:75`, `78`, `711`, `714`, `961`, `969`, `se.js`, and `ed.js:467`, `491`. These are the `D.elw`/`getCurrentWindow` focus and hide calls.
- [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md): `abt.js:18` (versions), `prf_ui.js:70` (F12 devtools), `ide.js:949` (`RIDE_PID`), `km.js` `CNC`/`JSC`/`NEW` spawn. `about.html` still opens links with `require('electron').shell` in Electron. Under Tauri its links do nothing until `D.host.sys` gets `openExternal`.
- Electron saved editor bounds were outer bounds before, and are content bounds now. Existing `editWins` prefs are off by one frame at most.

- `npm uninstall node-ipc` also had npm 12 normalise `package-lock.json` (`dev` flags and integrity fields on unrelated entries). It also pruned stale entries that no manifest lists, such as `copyfiles` and `yargs`. No remaining package changed version.

**Verification:**

- `npm run tauri:build` passes. Exe 8.38 MB (was 8.29).
- `npx eslint` on the touched files: no new problems. The ones left (`ipc.js:2` operator-linebreak, `init.js:296` arrow-parens, and the others in untouched lines) were there before.
- Electron against Dyalog 20 (`RIDE_CONNECT`): [smoke-cdp.js](../assets/smoke-cdp.js) 7/7, and the floating editor opens as `index.html?type=editor&winId=1&label=editor1`. [aux-cdp.js](../assets/aux-cdp.js) 15/15:
  - prefs show, sync in both directions, and close-hides
  - StringDialog round trip
  - status output, and closing it turns the pref off
  - About content and close
  - LOG content, live feed and close
  - 3500⌶ opens, the window is reused, the content is sandboxed, and it closes
  - TaskDialog is native in Electron on Windows, so its HTML path is skipped there.

  [quit-cdp.js](../assets/quit-cdp.js) (with `$.confirm` stubbed): answering "No" keeps the window and the connection. "Yes" disconnects, and the app exits with its hidden windows. The interpreter keeps running.
- Tauri release exe, connected from the Connect page over CDP: smoke 6/7 (floating is pending 011, and the session still works afterwards). aux-cdp 16/16, including the TaskDialog HTML path with 4 buttons. quit-cdp: same as Electron, and no "Reload site?" prompt.