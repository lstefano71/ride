---
title: Make dialogs async on D.host.dlg
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["012"]
---

## Question

Implement `D.host.dlg.message` and `D.host.dlg.open`, and reshape every sync dialog site onto them: `$.alert`, `$.err`, `$.confirm`, `optionsDialog`, `taskDialog`'s native branch, `showOpenDialogSync` in `km.js` (OWS) and `cn.js`. (`cn.js` `save()` already uses `$.confirm`'s callback form since [Move prefs and storage onto D.host.store](014-host-store.md#resolution).) The unsaved-changes `onbeforeunload` prompt in floating editors moves with `D.host.win.onCloseRequested` in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md). Done when every dialog works in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `util.js:105`, `218`, `303`, `309`, `316` (in Tauri these currently fall back to `alert`/browser branches)
- `km.js:131` (OWS)
- `ide.js:1063` (unsaved-changes prompt, with `onCloseRequested`)
- `cn.js` `browse()` (handed over by [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)): returns early under Tauri, so the log/cert/key/root-certs `...` buttons do nothing there.

## Resolution

Every sync dialog site is now async on `D.host.dlg`, in both shells. Under Tauri, the native dialogs are `tauri-plugin-dialog` 2.8.3, which uses rfd.

**Contract as built** (extends [Design the host adapter interface](007-design-host-adapter.md#resolution)):

- `message(o) → Promise<{button, checked}>`, where `o` is `{type, title, message, buttons, defaultId, cancelId, checkbox, checked}`. `checkbox` is the label of a "don't ask again" box.
- `open(o) → Promise<path|null>`, where `o` is `{title, directory, filters, defaultPath}`.
- `fits(o)` tells you whether `message` can show `o` natively. Electron always returns true. Tauri returns true only for 3 buttons or fewer and no checkbox, because rfd has no checkbox, no `defaultId` and a 3-button limit. When Tauri's `message` is given a dialog that doesn't fit, it rejects with `ENOTSUP`.
- Tauri maps the result back to an index in this order:
  1. the label of the clicked custom button
  2. otherwise Ok/Yes→0 and No→1
  3. otherwise dismissal → `cancelId`, falling back to the first button labelled Cancel/No, else 0
  
  A button literally labelled "Cancel" can't be told apart from a dismissal, which is fine.
- Dialog parent: Electron uses the focused app window, else the current window. This replaces `D.elw` / `focusedWin.bwId`. The Tauri plugin parents the dialog to the calling window. A `parent` window-label option waits for labels, in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md).
- Tauri wiring:
  - `.plugin(tauri_plugin_dialog::init())` in `lib.rs`.
  - Only `dialog:allow-message` and `dialog:allow-open` are granted in `capabilities/default.json`.
  - The capability lists only the `main` window. The aux-window tickets must add their windows.

**Sites reshaped:**

- `$.alert`, `$.err` and `$.confirm` sit on one `msgBox` helper.
  - Callbacks run after the dialog closes.
  - Without `D.host.dlg` (browser mode) they fall back to `alert`/`confirm`.
  - `$.confirm` gives 1 for Yes and 0 for No or a dismissal.
- `optionsDialog` is native when `fits` returns true. Otherwise it uses the HTML `I.gd` dialog, so under Tauri anything with more than 3 options gets HTML.
- `taskDialog`'s native branch now requires `D.win && D.host.dlg.fits(o)`. It stays native in Electron on Windows (command links and checkbox). Tauri always uses the HTML dialog until `D.win` arrives with [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md), and even then rfd can't show the checkbox.
- OWS (`km.js`) and `cn.js` `browse()` now test `D.desktop` and use `D.host.dlg.open`. Under Tauri, the log/cert/key/root-certs `…` buttons work. OWS's floating-editor IPC branch is left for 017.
- Fixed two places that depended on dialogs blocking:
  - The quit/disconnect confirm in `init.js` `onbeforeunload` read its answer synchronously. It now quits from the `$.confirm` callback.
  - `SysError` ran `ide.die()` before the user had seen the error. It now runs it in the `$.err` callback.
- The unsaved-changes prompt for floating editors (`ide.js`) now calls `D.host.dlg.message`. The veto mechanics (`onCloseRequested`) stay with 017.
- Dialogs no longer block the renderer, so concurrent ones stack instead of queueing. No other site depended on the blocking.

**Verification:**

- `npm run tauri:build` passes.
- ESLint reports no new problems in the touched files.
- Electron, against Dyalog 20 over CDP plus Win32 TaskDialog messages:
  - alert, err, confirm (Yes, No and Esc)
  - options with 1, 3 and 4 buttons
  - `open` for a file, a folder and a cancel
  - `taskDialog`: the command link gives 100, the checkbox stores the confirmation, and a stored answer skips the dialog
  - OWS opens a `.aplf` in an editor
  - quit confirm: No keeps the connection, Yes disconnects and quits
  - smoke 7/7
- Tauri:
  - the same message cases pass natively
  - 4 options go to the HTML dialog and return 3
  - `taskDialog` uses the HTML dialog
  - `open` file and cancel, and the Connect-page log and root-certs (folder) browse buttons
  - smoke 6/7 (only the floating editor fails, which is pending on 017)
- Exe 8.28 MB (was 8.13; the plugin adds 0.15).
- The Tauri quit confirm couldn't be exercised, because WebView2's "Reload site?" prompt still runs first (window-bounds fog).
