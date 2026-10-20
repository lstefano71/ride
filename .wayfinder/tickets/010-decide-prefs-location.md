---
title: Decide where preferences live under Tauri
type: wayfinder:grilling
status: closed
assignee: stf
blocked_by: ["001"]
---

## Question

Tauri's app data folder is named after the bundle identifier, not the app name, so it differs from Electron's. Where does the Tauri shell store prefs: a new folder with one-time migration from the Electron location, the Electron location read in place via a path override, or a fresh start? While both shells coexist, should they share one prefs file? (Sync vs async is settled: [Design the host adapter interface](007-design-host-adapter.md#resolution) preloads the store behind `D.host.ready` and writes behind; this ticket only decides locations, sharing and migration.)

Scope: decide this for every file RIDE keeps in `userData`, not only `prefs.json`. Per the [Electron inventory](../assets/electron-inventory.md#prefs-and-storage), that means `prefs.json` (or `RIDE_PREFS`), `connections.json` (mtime conflict check), `winstate.json` (named by `RIDE_CONF`, written by the main process), and the persistent session history file.

## Resolution

Both shells share one data folder; nothing is migrated.

- **Folder:** `config_dir()/<productName from package.json>`, so `%APPDATA%\Ride-4.8` on Windows, `~/Library/Application Support/Ride-4.8` on macOS, `~/.config/Ride-4.8` on Linux. That's Electron's `userData` exactly. Use Rust `dirs::config_dir()`, **not** `data_dir()` (wrong on Linux). Tauri's identifier folder (`com.dyalog.ride`) holds only WebView data.
- **No migration:** RIDE already starts each version fresh (the folder is versioned by `productName`, and no migration code exists), so the Tauri shell follows the same convention.
- **Files:** same names and byte-compatible formats as Electron: `prefs.json`, `connections.json`, `<RIDE_CONF or winstate>.json`, `hist.txt`. Either shell reads what the other wrote.
- **Env overrides:** `RIDE_PREFS` (prefs path) and `RIDE_CONF` (winstate name and config auto-select) are honoured.
- **Path ownership:** Rust resolves the paths behind `D.host.store`'s logical names (`prefs`, `connections`, `winstate`, `history`), with `productName` baked in at build time. The frontend never builds `userData` paths.
- **Concurrency:** last writer wins, as with two Electron instances today. `connections.json` keeps its mtime conflict check. No locking.
- **Write-behind:** an ordered async write on every set, with no debounce, so crash behaviour stays close to Electron's sync writes.
- **winstate:** shared. The Tauri shell must write bounds with the same meaning (content bounds in logical px, `dx`, maximized, launch/main layouts). If that proves impractical, the window-bounds work may split the file, and that gets recorded as a decision.