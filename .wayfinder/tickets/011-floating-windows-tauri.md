---
title: Port floating windows to Tauri windows
type: wayfinder:task
status: open
assignee:
blocked_by: ["017", "008"]
---

## Question

Finish `D.host.win` in the Tauri shell for floating editors. [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md#resolution) already built `D.host.ipc` over Tauri events, moved every frontend caller (including `ipc.js`) onto `D.host.ipc`/`D.host.win`, and gave Tauri a working `open`/`show`/`hide`/`focus`/`close`/`setTitle`/`setContentSize`/`setMinSize`/`onCloseRequested`. The prefs, dialog, status, About, LOG and 3500⌶ windows already run under Tauri. Still missing:

- `getBounds`/`setBounds`/`displayFor`, which return `ENOTSUP` under Tauri today. `IPC_CreateWindow` and `IPC_LinkEditor` need them to place editor windows, so `floating=1` creates no window yet. Bounds are content bounds, `displayFor` gives the matching monitor's work area, and `x`/`y` `null` means centre.
- The `editor*` labels in `src-tauri/capabilities/default.json`, for ipc, dialogs and menus from editor windows.
- Editor windows close through `onCloseRequested` with the unsaved-changes prompt (`IPC_Client`). Check that the async veto behaves as it does in Electron.

Done when, with `floating=1`, an editor opens in its own window in the Tauri build, edits round-trip to the interpreter, and closing it behaves as in Electron ([smoke-cdp.js](../assets/smoke-cdp.js) 7/7 under Tauri).

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `prf_wins.js:26` (`!D.el` disables floating, so Tauri stays docked until this ticket)
- `ide.js:75`, `78`, `711`, `714`, `961`, `969`, `se.js:597` (`D.elw` focus, `IPC_CreateWindow`/`IPC_LinkEditor`)
- `ed.js:467`, `491` (`ipc.js` itself is already on `D.host`)
