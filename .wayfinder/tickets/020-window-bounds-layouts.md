---
title: Port window bounds and the launch/main layout switch onto D.host.win
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

Port `main.js`'s save and restore of the main window's bounds onto `D.host.win`, for both layouts (the Connect page's launch layout and the connected main layout). Port the launch↔main layout switch too (`save-win`, `toggleConfig`). Tauri's window-state plugin doesn't fit, because RIDE keeps two layouts. `winstate.json` is shared with Electron ([Decide where preferences live under Tauri](010-decide-prefs-location.md#resolution)), so Tauri must write bounds with the same meaning. Read `main.js` for what Electron stores. The content-bounds primitives (`getBounds`/`setBounds`/`displayFor`) now exist in both shells, from [Port floating windows to Tauri windows](011-floating-windows-tauri.md#resolution). Under Tauri, `x`/`y` given to `open` place the content, while in Electron they place the frame.

Today `cn.js` keeps `winstate`/`toggleConfig`/`save-win` behind `D.el`. Under Tauri, the Connect page uses default launch-layout values and is clipped by the 800 px scaffold window. Also decide whether a reload under Tauri should be confirmed: it isn't today, and Electron's was WebView2's "Reload site?" prompt.

Done when, in both shells, the Connect page and the main window each reopen at their last bounds (maximised state included), switching between them resizes as Electron does, and one shell reads the bounds the other wrote. Smoke-check in both shells.

## Resolution

Both layouts' bounds and the layout switch now live in one shared frontend module, [`src/winstate.js`](../../src/winstate.js) (`D.winstate`), on `D.host.win`/`store`/`sys`. Both shells run it, so `winstate.json` has a single writer with one meaning. `main.js` lost all of its winstate code. Electron's store now treats `winstate` as a plain file, the same as the others.

- **File semantics are unchanged** (ADR 0002): logical content bounds per layout (`launchWin`, `mainWin`), `launchWin.expandedWidth` while the config pane is open, `maximized`, `devTools`, `dx`, `theme`. Each shell reads what the other wrote.
- **Startup.** The main window starts hidden in both shells (`show: 0` in `main.js`, `"visible": false` in `tauri.conf.json`). `winstate.js` waits for the first app menu (with a 3 s fallback), restores the bounds, reopens devtools when they were open, and then shows the window. Waiting for the menu fixes a creep on `master`: bounds were restored before the menu bar existed, so each start lost its height (26 px in Electron, 20 px in Tauri). The 106 px `mainWin` height in this machine's own file looks like that creep at work. With `RIDE_CONNECT`, the window first appears in the main layout.
- **Switch.** `initInterpreterConn` calls `D.winstate.layout('mainWin')`, and `toggleConfig` calls `layout('launchWin')` after resizing. The `save-win` IPC is gone. Saves are throttled to 2 s on move/resize/maximize (`D.host.win.onBoundsChanged`) and flushed when the main window closes, through the `onCloseRequested` veto in `init.js`.
- **New `D.host.win` calls** in both adapters: `frame`, `center`, `isMaximized`, `isMinimized`, `maximize`, `unmaximize`, `onBoundsChanged`, plus `sys.isDevToolsOpen` (a new Rust command, `sys_is_devtools_open`). In Electron, `setMinSize` now takes a content size, as it does in Tauri.
- **Electron close fix.** A `cur.close()` issued in the same turn as the vetoed `beforeunload` was ignored, so an async veto that agreed never closed the window. It is now deferred by one tick.
- **Reload:** not confirmed. WebView2's browser accelerators reloaded the Tauri page on F5, Ctrl-R and Ctrl-F5, which silently dropped the session. Electron has no user reload, so `host/tauri.js` blocks those keys with `preventDefault` in the capture phase. RIDE's own handlers still receive them, so F5 is still PF5. Tauri doesn't expose wry's `browser_accelerator_keys`.

Deviations from `main.js`, all deliberate:
- The off-screen check uses the monitor's work area, not its full bounds.
- A layout with no saved position is centred.
- The minimum size is reset to 400×400 when switching to the main layout.
- Launch bounds are flushed before a switch.
- The final save happens in the close veto, not in Electron's `close` event.
- Devtools persistence moved to the frontend.
- The Connect page is never reopened maximised, as before.

Verification:
- [bounds-cdp.js](../assets/bounds-cdp.js) `tauri electron tauri`: **48/48**. Each shell reopens both layouts at their last bounds, including the maximised state. The config toggle resizes. Closing flushes the bounds. Each shell restores what the other wrote. The script runs its own Dyalog 20 and restores the real file afterwards.
- Regression runs in both shells against Dyalog 20 with `RIDE_CONNECT`: smoke 7/7, [sys-cdp.js](../assets/sys-cdp.js) 15/15, [float-cdp.js](../assets/float-cdp.js), aux-cdp and quit-cdp all pass.
- F5, Ctrl-R and Ctrl-F5 no longer reload the Tauri page (checked over CDP).
- `npx eslint`: no new problems in the touched files; `winstate.js` is clean.
- `tauri build` passes. Exe 8.77 MB.
