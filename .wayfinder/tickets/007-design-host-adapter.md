---
title: Design the host adapter interface
type: wayfinder:grilling
status: open
assignee:
blocked_by: ["001", "003", "004"]
---

## Question

What is the host adapter's interface: the single object through which the frontend reaches everything platform-specific, implemented once for Electron and once for Tauri? Decide its areas and calls, sync versus async (Tauri IPC is async; much of the current `D.el` usage is sync), how the `node-ipc` message channel between windows is abstracted (the floating-windows research shows it is already async message passing), and how the frontend detects which host it runs in. Output: the interface written down, and the sequence of tickets that move the frontend onto it.
