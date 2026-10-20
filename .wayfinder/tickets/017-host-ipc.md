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