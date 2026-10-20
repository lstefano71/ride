---
title: Move prefs and storage onto D.host.store
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["012", "010"]
---

## Question

Implement `D.host.store.read/write` over the logical names `prefs`, `connections`, `winstate`, `history`, at the locations chosen in [Decide where preferences live under Tauri](010-decide-prefs-location.md). Preload them behind `D.host.ready` so `D.db` keeps its sync localStorage-shaped facade and writes behind. Move `prf.js`, `cn.js` (`connections.json` with its mtime check), `se.js` history, and `prf_col.js` theme onto it. Done when prefs, saved connections and history survive a restart in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `prf.js:214` (`D.db` chooses `localStorage` when `nodeRequire` is absent, so Tauri prefs live in WebView `localStorage` until then)
- `se.js:211`, `223` (history)
- `prf_col.js:202` (winstate theme)
- `init.js` `onbeforeunload`: `D.el` guard on `histWrite`
- `cn.js` (handed over by [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)): `cnFile`, the load in `showPage`, and `save()` are guarded by `fs` (Node). Under Tauri the page starts from one default `connect` entry and saves nothing.

## Resolution

**Done. Prefs, saved connections and session history survive a restart in both shells, and both read what the other wrote.** `D.host.store` is implemented in `src/host/electron.js` and in Rust (`src-tauri/src/store.rs`). `D.db`, `cn.js`, `se.js` and `prf_col.js` use it, and every site handed over above now tests `D.desktop` or `D.host.store`.

### The `store` contract as built

The interface in [Design the host adapter interface](007-design-host-adapter.md#resolution) gained a sync `snapshot` for the preload and an `mtime` for the connections conflict check:

- `read(name) → Promise<{text, mtime} | null>`: `null` when the file doesn't exist. `mtime` is in whole milliseconds, as `+fs.statSync(f).mtime` was.
- `write(name, text) → Promise<mtime>`: writes for one name land in the order they were made.
- `mtime(name) → Promise<number | null>`.
- `snapshot(name)`: sync. It returns the text preloaded behind `D.host.ready` (only `prefs`), `null` when there's no file, and `undefined` before the preload has finished.

**Tauri:** Rust resolves the paths: `dirs::config_dir()/<productName>`. `build.rs` reads `productName` (`Ride-4.8`) from `package.json` and bakes it in. `RIDE_PREFS` and `RIDE_CONF` are honoured. `store_write` creates the folder if needed. The JS adapter chains writes per name, because separate invokes can reorder. `D.host.ready` is the `prefs` preload.

**Electron:** plain `fs` calls under the Promise API. Writes stay synchronous underneath, so they keep their order and land before an unload, as before. `winstate` belongs to `main.js`: `read` returns main's live copy, `write` assigns the changed top-level keys into it, and main writes the file as before. The store exists only in `index.html` pages, the only ones that load `prf.js`.

### Changes

- **`D.db`** (`prf.js`) is the same localStorage-shaped facade over a lazily parsed `snapshot('prefs')`, with the same sorted file format. It writes behind on every set with no debounce (per [ADR 0002](../../docs/adr/0002-shared-versioned-data-folder.md)). Use before `D.host.ready` throws `D.db used before D.host.ready`. It never fired in testing. **One pre-ready read was found and fixed:** `prf_shc.js` loaded the custom keymap with `setTimeout(…, 1)`, which could beat the Tauri preload and silently drop custom shortcuts. It now waits for `D.host.ready`. Browser mode still uses `localStorage`.
- **Connections** (`cn.js`): `readConns()` fills `D.conns` before `showPage` runs. A parse or read error now shows a toast instead of throwing, and leaves `conns_modified` unset, so the next save asks before it overwrites the file. `save()` checks `mtime` and writes asynchronously. **The `$.confirm` bug is fixed here:** `save()` called `$.confirm(msg)` with no callback, which throws. The conflict path never worked. It now uses the callback form. [Make dialogs async on D.host.dlg](015-host-dialogs.md) only has to make `$.confirm` itself async.
- **History** (`se.js`): `histRead` is async and appends the stored lines after anything typed while the read was in flight. **Decision: history is written behind after every executed line, in both shells,** as well as at unload as before. A Tauri window can close before an unload-time invoke lands. In Electron it's one small synchronous write per execution. The file format is unchanged.
- **Theme** (`prf_col.js`): read-modify-write of `winstate`'s `theme`. Other keys are kept in both shells.

### Verification

- `cargo build` and `npm run tauri:build` pass; `ride.exe` is 8.13 MB (was 8.12).
- ESLint on the touched files: errors 186 → 186; warnings 5 → 5. The three new `no-console` warnings are suppressed inline, as in the adapters.
- Against Dyalog 20, with a CDP check (in the session folder, not committed) and the real `%APPDATA%\Ride-4.8` backed up and restored afterwards:
  - **Tauri**, run twice:
    - First run: `prefs.json` is read (`kbdLocale`). `D.prf.wrap(1)` reaches the file. A new connection `store-smoke` is saved to `connections.json`. Connecting to it and running `⍳3` writes `hist.txt`.
    - After a restart: `wrap` is still 1, `store-smoke` is in the list, and the history entry is in `D.ide.wins[0].hist`.
  - **Cross-shell:** Electron, started on the files Tauri wrote, passes the same restart checks.
  - **Electron**, from the original files: both runs pass.
  - **Theme:** switching to Dracula and back sets `theme` dark → light in main's winstate (Electron) and in `winstate.json` (Tauri), with the other keys intact.
  - Every Electron `index.html` page (main, prefs, floating editor) gets a working `D.db`.
- [smoke-cdp.js](../assets/smoke-cdp.js): Electron 7/7; Tauri 6/7, still missing only the floating window. The smoke's page filter now also matches the Tauri main page (`tauri.localhost`), so it runs unmodified in both shells.
- No dependency upgrades. `dirs` 7 (already in the tree via Tauri) is a new direct dependency, and `serde_json` is a new build dependency.

**Found, not caused here:** under Tauri, connecting sometimes throws `TypeError: Cannot read properties of undefined (reading 'type')` in `Se.setGroupDecorations` (`se.js:456`). It happens about half the time on a fresh start, with persistent history on or off (3/3 failures with it off), and never in Electron. Ticketed as [Fix the session decoration error on connect under Tauri](019-tauri-session-decoration-error.md).