---
title: Port window bounds and the launch/main layout switch onto D.host.win
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Port `main.js`'s save and restore of the main window's bounds onto `D.host.win`, for both layouts (the Connect page's launch layout and the connected main layout). Port the launch↔main layout switch too (`save-win`, `toggleConfig`). Tauri's window-state plugin doesn't fit, because RIDE keeps two layouts. `winstate.json` is shared with Electron ([Decide where preferences live under Tauri](010-decide-prefs-location.md#resolution)), so Tauri must write bounds with the same meaning. Read `main.js` for what Electron stores. The content-bounds primitives (`getBounds`/`setBounds`/`displayFor`) now exist in both shells, from [Port floating windows to Tauri windows](011-floating-windows-tauri.md#resolution). Under Tauri, `x`/`y` given to `open` place the content, while in Electron they place the frame.

Today `cn.js` keeps `winstate`/`toggleConfig`/`save-win` behind `D.el`. Under Tauri, the Connect page uses default launch-layout values and is clipped by the 800 px scaffold window. Also decide whether a reload under Tauri should be confirmed: it isn't today, and Electron's was WebView2's "Reload site?" prompt.

Done when, in both shells, the Connect page and the main window each reopen at their last bounds (maximised state included), switching between them resizes as Electron does, and one shell reads the bounds the other wrote. Smoke-check in both shells.
