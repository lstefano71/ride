---
title: Replace node-ipc with D.host.ipc and message-fed aux windows
type: wayfinder:task
status: open
assignee:
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
