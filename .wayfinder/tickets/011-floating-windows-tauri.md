---
title: Port floating windows to Tauri windows with an event-based message shim
type: wayfinder:task
status: open
assignee:
blocked_by: ["007", "008"]
---

## Question

Following the floating-windows research resolution, replace `node-ipc` with a shim of the same API built on Tauri events addressed by window label, and open floating editors, preferences, dialog and status windows as separate `WebviewWindow`s. Make `getContentBounds`/`getDisplayMatching` callers async. Done when, with `floating=1`, an editor opens in its own window in the Tauri build, edits round-trip to the interpreter, and closing it behaves as in Electron.
