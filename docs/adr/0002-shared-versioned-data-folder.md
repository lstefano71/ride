# Tauri shares Electron's versioned data folder

Tauri would by default keep app data in a folder named after its bundle identifier (`com.dyalog.ride`). Instead, the Tauri shell resolves Electron's `userData` location itself: `config_dir()/<productName from package.json>`, for example `%APPDATA%\Ride-4.8`. It reads and writes the same files in the same formats (`prefs.json`, `connections.json`, `winstate.json`, `hist.txt`). We chose this over the Tauri default plus a one-time migration because RIDE already starts each version fresh in its own `productName` folder, and because sharing means a user can switch between the Electron and Tauri shells without losing preferences, saved connections or history. The identifier folder is left to hold WebView data only.

## Consequences

- Use Rust's `dirs::config_dir()`, not `data_dir()`, which differs from Electron on Linux (`~/.local/share` vs `~/.config`).
- Both shells must keep the file formats byte-compatible, including the meaning of the window bounds in `winstate.json`.
- Two concurrent writers (either shell) follow the existing last-writer-wins semantics; there is no locking.
