---
title: Move native and context menus onto D.host.menu
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["012"]
---

## Question

Implement `D.host.menu.setApp(template) -> {setChecked}` and `D.host.menu.popup(template) -> Promise<id|null>` from plain menu data with roles mapped to native/predefined items. Move `menu.js` (app menu, live `checkBoxPref`), the `init.js` context menus and the Connect-page menu onto it. Hide the menu bar in full screen as `main.js` does. Done when the app menu, accelerators, checkbox/radio items and context menus work in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `menu.js:3` (Tauri gets the HTML menu bar until then)
- `init.js`: `D.createContextMenu` (`if (!D.el) return`, `D.el.Menu`)
- `ide.js:389` (`D.el ? 0 : 23`: offset for the HTML menu bar, so it flips with the native menu)
- `prf_menu.js:55` (`browser: !D.el`)

## Resolution

The app menu, the Connect-page menu and the context menus are native in both shells, all built through `D.host.menu`. Under Tauri, the adapter uses Tauri's JS menu API (`window.__TAURI__.menu`, granted by `core:default`). No new Rust was needed.

**Contract as built** (extends [Design the host adapter interface](007-design-host-adapter.md#resolution)):

- Templates are plain data: `{id, label, accelerator, type, checked, enabled, visible, role, items}`. `type` is `separator`, `checkbox` or `radio`. Submenus use `items`. Only items with an `id` are clickable.
- `setApp(template, onClick) → Promise<{setChecked(id, v)}>`.
  - `onClick(id, checked)` reports the clicked item, and `checked` is its new state.
  - `setChecked` keeps a checkbox in step with a pref changed elsewhere.
  - Each call replaces the previous menu, whose `setChecked` then goes quiet.
- `popup(template) → Promise<id|null>`. It resolves the clicked id, or `null` once the menu is dismissed. The null is held back 100 ms after close so a pending click wins.
- Roles map to native items:
  - Electron passes them straight through.
  - Tauri maps cut/copy/paste/undo/redo/selectall (plus hide/hideothers/unhide on macOS) to predefined items.
  - Tauri implements `togglefullscreen` with `setFullscreen`, which needed `core:window:allow-set-fullscreen` in `capabilities/default.json`.
  - Other roles (window, help, etc.) become plain items.
  - A predefined item can't be disabled, so a disabled role item becomes a plain disabled item.

**Tauri specifics:**

- Accelerators: muda rejects the whole menu over one accelerator it can't parse, so the adapter passes only forms it knows. `NumPad_Divide` is dropped from the menu text. The page keymap still handles the key.
- Menu accelerators never double-fire with `km.js`, because WebView2 takes the keystrokes before muda's accelerator table sees them. A real Ctrl+- zooms once.
- Check and radio state is tracked in JS and set explicitly after each click. muda toggles check items on its own on some platforms only. Radio is emulated over runs between separators. The DSL never produces radio, but the contract supports it.
- `setApp` calls are serialized. The old menu resource is closed after the new one is in place. On macOS it's the app menu, elsewhere the window menu.
- **Full screen keeps the menu bar visible under Tauri.** This is a decided deviation: Electron hides it and reveals it on Alt (`main.js`). Hiding it would need a Rust hook, plus an Alt reveal so the user can still get out of full screen.
- macOS and Linux are untested. Under Tauri, `D.mac` is undefined until [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md). Until then the DSL's `{mac}` items are hidden, and the adapter detects macOS from `navigator.platform`.

**Sites moved:**

- `menu.js`: the native branch tests `D.desktop`. It builds the template with ids `m{gen}.{n}` and subscribes each `checkBoxPref` to `setChecked`. A generation counter silences listeners from replaced menus. The HTML branch is unchanged and serves browser mode only.
- `init.js` `D.createContextMenu` tests `D.desktop`. Items with a click handler get an id, and the action runs when `popup` resolves to that id.
- `prf_menu.js:55` is now `browser: !D.desktop`, so `{!browser}` items (font size, full screen and so on) show under Tauri.
- `ide.js:389`: the HTML menu-bar offset flips on `D.desktop`.
- The Connect page needed no change of its own, since it goes through `menu.js`.

**Now reachable under Tauri, handed over** (their code still calls `D.el`):

- Show Status Window and About → [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md).
- New Session (`CNC` relaunch) → [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md).

**Verification:**

- `npm run tauri:build` passes.
- ESLint reports no new problems in the touched files.
- Tauri, against Dyalog 20, checked over CDP and Win32 menu messages:
  - Connect and IDE menus render with accelerators and check marks.
  - Clicking Show Status Bar toggles the pref and rebuilds the menu.
  - Auto Status follows pref changes made in JS (live `setChecked`).
  - Font-size commands and Toggle Full Screen work.
  - Edit/Copy in the app menu copies the editor selection.
  - Session context menu: Cut/Copy are disabled with no selection. Undo resolves its id and runs once. Dismissing resolves `null`.
  - Editor context menu with a selection: Cut/Copy are enabled, and Copy fills the clipboard.
  - Breakpoint-area menu: Trace/Stop/Monitor show their state, and Stop toggles the stop on and off.
  - Smoke 6/7 (only the floating editor fails, which is pending on 017).
- Electron:
  - The menu rebuilds with the right check states.
  - Menu clicks reach the pref (Show Status Bar) and the command (Increase Font Size fires once).
  - Live `setChecked` works.
  - The session context menu shows the right enabled states, and Undo resolves `c5` and runs once.
  - Smoke 7/7.
- Exe 8.29 MB (was 8.28).
