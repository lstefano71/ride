---
title: Restage the frontend automatically during tauri dev
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

`npm run tauri:stage` copies the frontend (Grunt/LESS output, `src/`, `node_modules` renamed to `vendor/`) into `_/tauri-frontend`, and Tauri serves that copy. `beforeDevCommand` and `beforeBuildCommand` stage once at start, so an edit made while `tauri dev` runs doesn't show until a manual restage. Make `tauri:dev` restage on change, through a watcher in `beforeDevCommand` or by serving the source tree in dev.

Done when editing a file in `src/` (and a `.less` file) while `tauri:dev` runs shows the change after a reload, with no manual step, and `tauri:build` still produces a working exe.
