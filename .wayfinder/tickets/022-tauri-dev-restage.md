---
title: Restage the frontend automatically during tauri dev
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

`npm run tauri:stage` copies the frontend (Grunt/LESS output, `src/`, `node_modules` renamed to `vendor/`) into `_/tauri-frontend`, and Tauri serves that copy. `beforeDevCommand` and `beforeBuildCommand` stage once at start, so an edit made while `tauri dev` runs doesn't show until a manual restage. Make `tauri:dev` restage on change, through a watcher in `beforeDevCommand` or by serving the source tree in dev.

Done when editing a file in `src/` (and a `.less` file) while `tauri:dev` runs shows the change after a reload, with no manual step, and `tauri:build` still produces a working exe.

## Resolution

**Done. Editing a file in `src/`, `lib/`, `style/` or a root HTML page while `npm run tauri:dev` runs shows the change on the next reload. Editing a `.less` file recompiles it first. There's no manual step. `tauri:build` still gives a working exe: 8.77 MB, smoke 7/7 against Dyalog 20.**

- **Approach: a watcher, not serving the source tree.** Tauri's built-in dev server (`http://127.0.0.1:1430`) already serves `_/tauri-frontend` from disk on each request, so keeping that copy current is enough. Dev still sees the same `vendor/` layout and rewritten `index.html` as the release build. A source-tree server would need its own path mapping.
- [`src-tauri/stage-frontend.js`](../../src-tauri/stage-frontend.js) `--watch` (now `beforeDevCommand`) keeps running and watches the repo root (HTML and icons), `src/`, `lib/` and `style/` with `fs.watch` (recursive, 100 ms debounce):
  - a staged file that changes is copied again (`index.html` gets the `vendor/` rewrite), and a deleted one is removed;
  - a `.less` change runs `grunt less`, the same as `npm run css`, and the `style/*.css` it writes are then restaged.
  - `node_modules` isn't watched. After `npm install`, restart `tauri:dev`.
- **Startup race fixed.** Tauri doesn't wait for `beforeDevCommand`. With nothing for cargo to rebuild, `ride.exe` started (~1 s) before the old one-shot stage had finished deleting and recopying. [`src-tauri/tauri-cli.js`](../../src-tauri/tauri-cli.js) `dev` now runs `npm run tauri:stage` synchronously before starting Tauri, and the watcher only stages if `_/tauri-frontend` is missing (plain `npx tauri dev`). `beforeBuildCommand` is unchanged.
- **No live reload.** The dev server doesn't reload the page by itself, which is good, since a reload drops the session. Reload from devtools (F12, then Ctrl-R or F5 in devtools). F5/Ctrl-R in the RIDE window stay blocked ([Port window bounds and the launch/main layout switch onto D.host.win](020-window-bounds-layouts.md)).
- **Verified** over CDP against a running `tauri:dev`. A marker added to `src/init.js` and a `.devmark` rule added to `style/light-theme.less` were both served within 8 s with no reload. After `Page.reload`, `D.__devmark === 42` and the computed colour matched. Reverting both removed them after the next reload. A touched `index.html` restaged with its `vendor/` paths. Killing `ride.exe` ends `tauri dev` and the watcher, with no orphan `node` process.
- `npx eslint` is clean on both scripts. The release exe is 8.77 MB, and smoke passes 7/7 against Dyalog 20 (`RIDE_CONNECT`).
