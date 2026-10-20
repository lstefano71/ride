---
title: Move prefs and storage onto D.host.store
type: wayfinder:task
status: open
assignee:
blocked_by: ["012", "010"]
---

## Question

Implement `D.host.store.read/write` over the logical names `prefs`, `connections`, `winstate`, `history`, at the locations chosen in [Decide where preferences live under Tauri](010-decide-prefs-location.md). Preload them behind `D.host.ready` so `D.db` keeps its sync localStorage-shaped facade and writes behind. Move `prf.js`, `cn.js` (`connections.json` with its mtime check), `se.js` history, and `prf_col.js` theme onto it. Done when prefs, saved connections and history survive a restart in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.