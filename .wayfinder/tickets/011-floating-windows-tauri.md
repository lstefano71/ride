---
title: Port floating windows to Tauri windows
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["017", "008"]
---

## Question

Finish `D.host.win` in the Tauri shell for floating editors. [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md#resolution) already built `D.host.ipc` over Tauri events, moved every frontend caller (including `ipc.js`) onto `D.host.ipc`/`D.host.win`, and gave Tauri a working `open`/`show`/`hide`/`focus`/`close`/`setTitle`/`setContentSize`/`setMinSize`/`onCloseRequested`. The prefs, dialog, status, About, LOG and 3500⌶ windows already run under Tauri. Still missing:

- `getBounds`/`setBounds`/`displayFor`, which return `ENOTSUP` under Tauri today. `IPC_CreateWindow` and `IPC_LinkEditor` need them to place editor windows, so `floating=1` creates no window yet. Bounds are content bounds, `displayFor` gives the matching monitor's work area, and `x`/`y` `null` means centre.
- The `editor*` labels in `src-tauri/capabilities/default.json`, for ipc, dialogs and menus from editor windows.
- Editor windows close through `onCloseRequested` with the unsaved-changes prompt (`IPC_Client`). Check that the async veto behaves as it does in Electron.

Done when, with `floating=1`, an editor opens in its own window in the Tauri build, edits round-trip to the interpreter, and closing it behaves as in Electron ([smoke-cdp.js](../assets/smoke-cdp.js) 7/7 under Tauri).

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `prf_wins.js:26` (`!D.el` disables floating, so Tauri stays docked until this ticket)
- `ide.js:75`, `78`, `711`, `714`, `961`, `969`, `se.js:597` (`D.elw` focus, `IPC_CreateWindow`/`IPC_LinkEditor`)
- `ed.js:467`, `491` (`ipc.js` itself is already on `D.host`)

## Resolution

**Done. With `floating=1`, editors and tracers open in their own window in the Tauri build. Edits round-trip to the interpreter, and closing the window behaves as in Electron.** [smoke-cdp.js](../assets/smoke-cdp.js) passes 7/7 in both shells. The new [float-cdp.js](../assets/float-cdp.js) passes 14/14 in both shells.

**Built** (`src/host/tauri.js`):

- `getBounds` returns content bounds: `innerPosition`/`innerSize` divided by the window's own `scaleFactor`, so they are logical (DIP) like Electron's.
- `setBounds` sets the inner size, then positions the outer corner offset by the frame (`innerPosition − outerPosition`), because Tauri positions windows by their outer corner.
- `displayFor(b)` gives the work area of the monitor that overlaps `b` most, else the primary monitor, as `getDisplayMatching` does. It uses `availableMonitors()`/`workArea`, each scaled by its own monitor's factor.
- `open` with no `x`/`y` now centres the window (`center: true`), as Electron does by default. This also applies to the prefs, dialog and status windows.
- **Window titles.** Electron shows `document.title` as the OS window title, and Tauri doesn't. The adapter now mirrors `document.title` to the window title through a `MutationObserver` on `<head>`. This fixes every window, including the main one, which showed "RIDE" before, and floating editors, which showed "Tauri App".
- Capabilities: `editor*` added to the window list, and `core:window:allow-set-position` granted.

**Desktop-flag sites moved:** `prf_wins.js:26` (`!D.desktop`), `ide.js` `switchWin`, the floating `IPC_CreateWindow(1)` on connect, `OpenWindow`, `focusWin` and `focusMRUWin`, `se.js` `focus`, and `ed.js` `focus`/`close`. The `D.elw` calls became `D.host.win.focus('main')`, and `D.el.getCurrentWindow()` became `D.host.win.focus|hide(D.host.win.current())`. In `OpenWindow`, the `!isFocused()` guard was dropped, because focusing an already focused window does nothing. The `D.el` sites left in these files are `RIDE_EDITOR` (out of scope), `{RIDE_PID}` and print, which belong to [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md).

**Fixed along the way: a race that created a second editor window (also on `master`).** With `floating=1`, connecting pre-creates `editor1`. An `)ed` that arrived before `editor1` registered (`browserCreated`) created `editor2`. The pending editor then went to `editor1`, and `editor2` was left empty. Tauri's slower window start made this easy to hit. `ipc.js` now counts windows that are still starting, and `IPC_LinkEditor` creates a new window only when there are more pending editors than starting windows. A window that fails to open is uncounted.

**Close behaviour verified** (both shells, the dialog stubbed to answer "No"):

- [X] with unsaved changes asks once to save, and "No" discards the change.
- With `connected`, the window is always vetoed: it hides and stays alive for reuse, as in Electron.
- [X] with no changes closes the editor without asking.
- A tracer in a floating window steps and continues to its result.

**Deviations:**

- A new window's `x`/`y` lands as the **content** position under Tauri, and as the outer position in Electron (a frame's width apart). The saved `editWins` from `editWinsRememberPos` are content bounds in both shells, so this only affects where a new window first appears.
- On a mixed-DPI setup, logical coordinates are computed per monitor, so they can differ from Electron's DIP space on secondary monitors. Not tested (single 1920×1080 monitor here).

**Verification:**

- `npm run tauri:build` passes (`cargo build` release). Exe 8.40 MB (was 8.38).
- `npx eslint` on the 6 touched files: 59 problems before and after, so no new ones.
- Dyalog 20 (`RIDE_INIT=SERVE:*:4602`):
  - **Tauri**, connected from the Connect page: float-cdp 14/14, smoke 7/7, aux-cdp 17/17.
  - Starting with `floating=1` persisted, then running float-cdp straight after connecting: 14/14, with one editor window. That is the race regression check; it failed before the fix.
  - **Electron** (`RIDE_CONNECT`), starting with `floating=1`: float-cdp 14/14, smoke 7/7, aux-cdp 16/16 (TaskDialog is native in Electron, so its HTML path is skipped).
- Manual look (screenshot): the Tauri floating editor sits at the saved position (200, 200, 800×600), has its toolbar and language bar, and its title is "ShotF - CLEAR WS - …".
