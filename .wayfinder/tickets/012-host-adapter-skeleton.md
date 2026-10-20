---
title: Introduce the host adapter skeleton and desktop flag
type: wayfinder:task
status: closed
assignee: stf
blocked_by: ["007"]
---

## Question

Create `src/host/electron.js` and `src/host/tauri.js`, each defining `D.host` (with `kind`) and `D.host.ready`. Load the right one in every page (`index.html`, `dialog.html`, `status.html`, `about.html`, `empty.html`) by `window.__TAURI__` vs `nodeRequire`, and have `init` await `D.host.ready`. Add `D.desktop` and rewrite the ~60 sites that test `D.el` only as a desktop flag (see the [inventory](../assets/electron-inventory.md)). Done when Electron behaves as before and the Tauri build lands on the Connect page instead of browser mode.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

## Resolution

**Done, with one scope change agreed with the user: Tauri now leaves browser mode and boots the desktop path, but shows a placeholder ("Connect page not yet ported to Tauri.") instead of the Connect page.** The Connect page is `cn.js`, which calls `nodeRequire` and `D.el.app` as soon as it loads. Rendering it under Tauri moved to [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md), whose done-criterion now includes it.

### What changed

- **`src/host/electron.js`, `src/host/tauri.js`.** Every page loads both files. Each one acts only in its own shell and sets `D.desktop = true` and `D.host = {kind, ready}` (`ready` resolves immediately for now; the sys and store snapshots will hang off it). Tauri is detected by `window.__TAURI__`. Electron is detected by the `Electron/` user-agent token rather than `nodeRequire`, because `dialog.html`/`status.html` have `require` but no `nodeRequire`, and `about.html`/`empty.html` have no Node at all.
- **The Electron bootstrap moved out of `pre_init.js`** into `electron.js` (index.html only, where `nodeRequire` exists): `D.el`, `D.elm`, `D.elw`, `D.ipc`, the merge of main's global `D`, and `D.win`/`D.mac`. `pre_init.js` keeps the `navigator.platform` fallback when the adapter hasn't set the platform.
- **Pages:** `index.html` loads the adapters after `_/version.js` and before `pre_init.js`. `dialog.html`, `status.html`, `about.html` and `empty.html` load them in `<head>`.
- **`init.js`** waits for `Promise.all([D.mop, D.host.ready])`. Shell-neutral sites flipped to `D.desktop`: Ctrl+wheel zoom, the platform CSS class, and page routing (`?type=` parsed with `URLSearchParams` instead of Node's `querystring`). The main-window branch creating the hidden `BrowserWindow`s and loading `cn` is now behind `D.host.kind === 'electron'`. The Tauri branch hides the splash and shows the `#host_pending` placeholder.

### The "~60 flag sites" were mostly not flag-only

The inventory's count was right, but almost every `if (D.el)` block calls Electron inside it. Flipping those to `D.desktop` would make Tauri throw, so (with the user's agreement) **only the three shell-neutral sites above were flipped**. The rest keep testing `D.el` until their area moves onto `D.host`. Under Tauri they quietly take the browser fallback (HTML menu bar, `alert`, `localStorage` prefs, floating disabled). Each remaining site is now listed on the ticket that owns it: [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md), [Move prefs and storage onto D.host.store](014-host-store.md), [Make dialogs async on D.host.dlg](015-host-dialogs.md), [Move native and context menus onto D.host.menu](016-host-menus.md), [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md), [Port floating windows to Tauri windows](011-floating-windows-tauri.md), [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md). Out-of-scope sites (`NODE_ENV==='test'`, `RIDE_EDITOR`, `NEW` respawn, SSH `user`, Windows IME) are left as they are.

### Verification

- `npm run tauri:build` (`cargo build --release`) passes. `ride.exe` is still 7.02 MB.
- ESLint: `src/host/*` clean. `init.js` 1 problem and `pre_init.js` 4, the same counts as before the change.
- **Electron** against Dyalog 20 (`RIDE_CONNECT=127.0.0.1:4502`): [smoke-cdp.js](../assets/smoke-cdp.js) passes all 7 checks (connect, `⍳5`, `+/⍳10`, docked editor, tracer + continue to `8`, floating editor window). A CDP probe of all 5 pages (main, prefs, floating editor, `status.html`, `dialog.html`) reports `D.host.kind === 'electron'` and `D.desktop === true`, with `D.el` present only in the `index.html` pages.
- **Tauri** release exe over CDP: `D.host.kind === 'tauri'`, `D.desktop`, no `D.el`, no `D.ide`, no WebSocket (`D.send` undefined), splash hidden, placeholder visible (checked by screenshot), and no exceptions or console errors on reload.
- No dependency upgrades.

Note for later sessions: launching `electron.exe` from PowerShell returns as soon as the app starts, so a "completed" launcher shell doesn't mean RIDE has exited.