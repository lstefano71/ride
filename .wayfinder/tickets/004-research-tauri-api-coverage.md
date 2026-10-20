---
title: Research Tauri v2 coverage of RIDE's Electron features
type: wayfinder:research
status: open
assignee:
blocked_by: []
---

## Question

For the Electron features RIDE uses outside the connection layer, what is the Tauri v2 equivalent (core API or official plugin) and are there gaps? Cover at least: application and context menus built from templates (`Menu.buildFromTemplate`), native dialogs, clipboard, `shell.openExternal`, zoom, devtools toggle, window bounds save/restore, persisted app data location, single-instance, command-line args, and loading local HTML/JS/CSS (including `nodeRequire`-free module loading). Also report realistic release exe size for a minimal Tauri v2 app on Windows, and the known WebKitGTK/WKWebView issues that matter for a Monaco-based app. Cite sources.
