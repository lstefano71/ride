---
title: Port floating windows to Tauri windows
type: wayfinder:task
status: open
assignee:
blocked_by: ["017", "008"]
---

## Question

Implement `D.host.win` in the Tauri shell: open floating editors, preferences, dialog, status and aux windows as separate `WebviewWindow`s addressed by window label, with `getBounds`/`setBounds`, `displayFor`, and `onCloseRequested` (hide-not-close vetoes, unsaved-changes prompt). The messaging side (`D.host.ipc` over Tauri events) and the frontend callers are done in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md). Done when, with `floating=1`, an editor opens in its own window in the Tauri build, edits round-trip to the interpreter, and closing it behaves as in Electron.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `prf_wins.js:26` (`!D.el` disables floating, so Tauri stays docked until this ticket)
- `ide.js:75`, `78`, `711`, `714`, `961`, `969`, `se.js:597` (`D.elw` focus, `IPC_CreateWindow`/`IPC_LinkEditor`)
- `ed.js:467`, `491`, `ipc.js` (all)
