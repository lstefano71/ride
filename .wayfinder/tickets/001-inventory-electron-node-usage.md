---
title: Inventory Electron and Node usage in the frontend
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

Which Electron and Node APIs does RIDE use, where, and for what? Produce a categorised inventory of every `D.el`, `D.elm`, `D.elw`, `D.ipc`, `nodeRequire`/`require`, `process`, `fs`, `path`, `net`, `tls` use across `src/*.js`, `main.js`, and the HTML entry points (`index.html`, `dialog.html`, `status.html`, `about.html`), grouped by area: connection, windows, menus, dialogs, clipboard, prefs/storage, file IO, process/env, IPC between windows, misc. Mark items belonging to out-of-scope features (spawn, listen, SSH). The inventory is the input to the host adapter design; record it as a linked asset (`.wayfinder/assets/electron-inventory.md`).

## Resolution

Done. Inventory recorded as an asset: [Electron and Node usage inventory](../assets/electron-inventory.md), grouped by connection, windows, menus, dialogs, clipboard, prefs/storage, file IO, process/env, inter-window IPC, devtools/printing, and misc. Out-of-scope items are marked **[OOS]**.

Facts later tickets depend on:

- **Main reshaping cost is sync to async.** Synchronous sites: `$.alert`, `$.err`, `$.confirm`, `optionsDialog`, two `showOpenDialogSync` callers, the floating editor's unsaved-changes prompt, the `D.db` load, and `getGlobal('winstate')`.
- **`D.el` is two things.** It's the Electron API and also the desktop-mode flag (about 60 behaviour checks). The adapter should split these.
- **Inter-window messages are a closed vocabulary.** The `node-ipc` messages are fully listed in the asset, which is the contract for the Tauri event shim.
- **Four files live in `userData`:** `prefs.json`, `connections.json`, `winstate.json`, and session history. [Decide where preferences live under Tauri](010-decide-prefs-location.md) was widened to cover all four.
- **`cn.js` must change shape.** It's a CommonJS module loaded via `nodeRequire`. Its `Buffer` framing is the part that moves to Rust.
- **In-scope pieces that need adapter primitives:** "New Session" (`CNC`) relaunches the process. Drag-and-drop and the demo loader rely on Electron's `File.path`. Paste relies on `enableDeprecatedPaste`. Printing uses `webContents.print`.
- **Pre-existing bugs, not fixed here:** `cn.js` `save()` tests `$.confirm`'s return value, which is always undefined. The About window's clipboard and `openExternal` handlers are unreachable.
