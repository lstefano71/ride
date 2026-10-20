---
title: Inventory Electron and Node usage in the frontend
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Which Electron and Node APIs does RIDE use, where, and for what? Produce a categorised inventory of every `D.el`, `D.elm`, `D.elw`, `D.ipc`, `nodeRequire`/`require`, `process`, `fs`, `path`, `net`, `tls` use across `src/*.js`, `main.js`, and the HTML entry points (`index.html`, `dialog.html`, `status.html`, `about.html`), grouped by area: connection, windows, menus, dialogs, clipboard, prefs/storage, file IO, process/env, IPC between windows, misc. Mark items belonging to out-of-scope features (spawn, listen, SSH). The inventory is the input to the host adapter design; record it as a linked asset (`.wayfinder/assets/electron-inventory.md`).
