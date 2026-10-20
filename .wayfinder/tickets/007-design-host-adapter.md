---
title: Design the host adapter interface
type: wayfinder:grilling
status: closed
assignee: stf
blocked_by: ["001", "003", "004"]
---

## Question

What is the host adapter's interface: the single object through which the frontend reaches everything platform-specific, implemented once for Electron and once for Tauri? Decide its areas and calls, sync versus async (Tauri IPC is async; much of the current `D.el` usage is sync), how the `node-ipc` message channel between windows is abstracted (the floating-windows research shows it is already async message passing), and how the frontend detects which host it runs in. Output: the interface written down, and the sequence of tickets that move the frontend onto it.

## Resolution

**`D.host`: one async-only adapter object, implemented by `src/host/electron.js` and `src/host/tauri.js`, which the frontend is written against once.** Decided by grilling with the user. The rationale is in [ADR 0001](../../docs/adr/0001-async-host-adapter.md). The glossary gained **Window label**.

### Contract

- **Async everywhere.** Every call returns a Promise, *including* in the Electron implementation. Sync sites (`$.alert/$.err/$.confirm`, `optionsDialog`, `showOpenDialogSync`, the unsaved-changes `onbeforeunload` prompt) get reshaped to callbacks or `await`.
- **Two exceptions, both preloaded snapshots:** `D.host.sys` facts and the store contents are loaded before `init` runs, behind `D.host.ready`.
- **Desktop flag.** `D.desktop` (true in both shells) replaces the ~60 sites that test `D.el` only as a flag. `D.host.kind` is `'electron' | 'tauri'` for the rare shell-specific branch. Outside `host/electron.js`, nothing touches `D.el`.
- **Boot.** Every page (`index.html`, `dialog.html`, `status.html`, `about.html`, `empty.html`) loads one adapter, chosen by `window.__TAURI__` vs `nodeRequire`. `init` awaits `D.host.ready`. `main.js` stays the only other Electron-specific file.

### Areas

| Area | Calls |
|---|---|
| `conn` | `connect(opts) → {send(str), onMessage, onError, onClose, close}`, working in **whole messages**. Framing sits below the adapter (Rust in Tauri, a Node helper in Electron), and the `nudge` workaround goes away. `cn.js` becomes a plain script that sets `D.cn` (no CommonJS). |
| `win` | Addressed by **window label** (`main`, `prf`, `dialog`, `status`, `editor<N>`, `about`, `log`, `html3500`): `open(label, page, {parent, bounds, hidden, modal, title})`, `show/hide/focus/close`, `getBounds/setBounds`, `setContentSize/setMinSize`, `isFocused`, `displayFor(bounds) → workArea`, `current() → label`, `onCloseRequested(label, fn → Promise<boolean>)` (for the hide-not-close vetoes and the unsaved-changes prompt). |
| `ipc` | `send(label, type, data)`, `broadcast(type, data)`, `on(type, fn)`. Replaces `node-ipc`, with `ipc.js` and the sender sites moved onto it (not a same-API shim). The message vocabulary from the inventory is the contract. Aux windows (About, LOG, 3500⌶) **request their content over ipc on load**: no `executeJavaScript`, and 3500⌶ HTML is sent as a message instead of a temp file. |
| `menu` | Plain data `{id, label, accelerator, type: normal\|checkbox\|radio\|separator, checked, visible, role, items}` plus one `onClick(id)`. `setApp(template) → {setChecked(id, bool)}`, `popup(template) → Promise<id\|null>`. Roles map to native/predefined items. |
| `dlg` | `message({type, title, message, buttons, defaultId, cancelId, checkbox}) → Promise<{button, checked}>`, `open({title, directory, filters, defaultPath}) → Promise<path\|null>`. String/Task dialogs stay the HTML `dialog` window over ipc. `$.alert/$.err/$.confirm` keep their names on top of `dlg.message`. The `cn.js` `save()` bug is fixed in the reshape. |
| `store` | `read(name)` / `write(name, text)` over logical names `prefs`, `connections`, `winstate`, `history`. `D.db` keeps its sync localStorage-shaped facade by preloading and writing behind. Locations: [Decide where preferences live under Tauri](010-decide-prefs-location.md). |
| `sys` | Sync snapshot: `env`, `argv`, `platform`, `arch`, `pid`, `versions`, `locale`, `tempDir`. Async: `relaunch()`, `toggleDevTools(label)`, `print(label)`, `openExternal(url)`, `clipboard.readText/writeText`. |
| `fs` | `readText`, `writeText`, `appendText`, `remove`, for the protocol log, drag-and-drop, `RIDE_JS`/`RIDE_CSS`, and `RIDE_DEMO_SCRIPT`. |

### Scope

Kept: `RIDE_JS`/`RIDE_CSS`, `RIDE_DEMO_SCRIPT`/`DMR`. **Out of scope:** `RIDE_EDITOR` (needs process spawn), `DEV_STYLE` live reload, spectron test hooks (`global.js`, `spectron_temp_dir`, `NODE_ENV==='test'`); CDP smoke replaces them.

### Ticket sequence

Each migration ticket moves one area of the frontend onto `D.host` **and** implements it in both shells, smoke-checked in both (Electron stays alive until it hurts, then a recorded switch to Tauri-only).

1. [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md)
2. [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md), then [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md)
3. [Move prefs and storage onto D.host.store](014-host-store.md)
4. [Make dialogs async on D.host.dlg](015-host-dialogs.md)
5. [Move native and context menus onto D.host.menu](016-host-menus.md)
6. [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md), then [Port floating windows to Tauri windows](011-floating-windows-tauri.md)
7. [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md)

Main-window bounds and the launch↔main layout switch (`save-win`, `toggleConfig`) stay in the "Window bounds and layouts" fog.