---
title: Port floating windows to Tauri windows
type: wayfinder:task
status: open
assignee:
blocked_by: ["017", "008"]
---

## Question

Implement `D.host.win` in the Tauri shell: open floating editors, preferences, dialog, status and aux windows as separate `WebviewWindow`s addressed by window label, with `getBounds`/`setBounds`, `displayFor`, and `onCloseRequested` (hide-not-close vetoes, unsaved-changes prompt). The messaging side (`D.host.ipc` over Tauri events) and the frontend callers are done in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md). Done when, with `floating=1`, an editor opens in its own window in the Tauri build, edits round-trip to the interpreter, and closing it behaves as in Electron.