---
title: Introduce the host adapter skeleton and desktop flag
type: wayfinder:task
status: open
assignee:
blocked_by: ["007"]
---

## Question

Create `src/host/electron.js` and `src/host/tauri.js`, each defining `D.host` (with `kind`) and `D.host.ready`. Load the right one in every page (`index.html`, `dialog.html`, `status.html`, `about.html`, `empty.html`) by `window.__TAURI__` vs `nodeRequire`, and have `init` await `D.host.ready`. Add `D.desktop` and rewrite the ~60 sites that test `D.el` only as a desktop flag (see the [inventory](../assets/electron-inventory.md)). Done when Electron behaves as before and the Tauri build lands on the Connect page instead of browser mode.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.