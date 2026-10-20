---
title: Scaffold a Tauri v2 shell that loads the existing frontend
type: wayfinder:task
status: open
assignee:
blocked_by: ["002"]
---

## Question

Add a `src-tauri/` Tauri v2 project that opens the existing `index.html` frontend (built styles included) without Electron, with no Node in the webview. The frontend need not connect yet; success is the UI shell rendering and failing gracefully where `D.el` is absent. Record the dev and build commands, the Windows release exe size, and how the frontend assets are bundled.
