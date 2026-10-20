---
title: Decide where preferences live under Tauri
type: wayfinder:grilling
status: open
assignee:
blocked_by: ["001"]
---

## Question

Tauri's app data folder is named after the bundle identifier, not the app name, so it differs from Electron's. Where does the Tauri shell store prefs: a new folder with one-time migration from the Electron location, the Electron location read in place via a path override, or a fresh start? While both shells coexist, should they share one prefs file? (Sync vs async is settled: [Design the host adapter interface](007-design-host-adapter.md#resolution) preloads the store behind `D.host.ready` and writes behind; this ticket only decides locations, sharing and migration.)

Scope: decide this for every file RIDE keeps in `userData`, not only `prefs.json`. Per the [Electron inventory](../assets/electron-inventory.md#prefs-and-storage), that means `prefs.json` (or `RIDE_PREFS`), `connections.json` (mtime conflict check), `winstate.json` (named by `RIDE_CONF`, written by the main process), and the persistent session history file.
