# Taking changes from master into tauri-port

`tauri-port` keeps taking ordinary changes from Dyalog's `master`. This guide covers how hard that is, where conflicts happen, and how to do it. For the port's design, see [ADR 0001](../adr/0001-async-host-adapter.md) (one frontend on an async `D.host`), [ADR 0002](../adr/0002-shared-versioned-data-folder.md) (shared data folder) and [`CONTEXT.md`](../../CONTEXT.md).

## Verdict: realistic

The port changes the Electron/Node layer, not the RIDE frontend. Most upstream work (session, editor, syntax, help, keyboard, styles, CI) lands in files the port left alone or barely touched, so it merges as-is.

Evidence, from [`drift-replay.py`](../../.wayfinder/assets/drift-replay.py) ([raw results](../../.wayfinder/assets/drift-replay.tsv)). The script uses `git merge-tree` and doesn't touch the work tree. It ran against `tauri-port` at 4.8.4320, branched from `307003ef` ("Bump master to v4.8"). `master` hasn't moved since.

| Replay | Clean on master | Clean on tauri-port |
|---|---|---|
| Merge all of `origin/ride4.6` (the newest maintenance branch) | yes | yes |
| Cherry-pick the 7 unmerged commits on `ride4.6`, `issue1246` and `issue1319` | 3 of 7 | the same 3 of 7 (the other 4 conflict on `master` too) |
| Revert each of the 140 `master` commits from v4.5.4097 to v4.8 | 74 | 70 of those 74 |

The revert replay is a proxy for future changes. It checks whether the lines each historical commit touched still read the same on `tauri-port`. The 66 commits that can't be reverted cleanly on `master` itself (later commits rewrote the same lines) say nothing about the port and are left out. Of the 74 that can, 70 revert cleanly on the port. The 4 that don't are exactly the kind expected (see [Hotspots](#hotspots)):

| Commit | Change | Conflicts in | Where it lives on tauri-port |
|---|---|---|---|
| `7c06238f` | `enableDeprecatedPaste` for Electron windows | `src/init.js`, `src/ipc.js` | the single window factory in `src/host/electron.js` (and `main.js`) |
| `1be11e8f` | Platform and arch in About | `src/abt.js` | `abt.js` reads them from `D.host.sys` |
| `2ab08bfa` | List every message of an AggregateError | `src/cn.js` | connection error mapping in `src/host/electron.js` (`cn.js` keeps a copy) |
| `acff1f5c` | Electron 34 → 35 | `package-lock.json` | regenerate the lock file |

## Kinds of upstream change

| Kind | Typical files | Cost |
|---|---|---|
| **Frontend only** | `se.js`, `ed.js`, `mon_apl.js`, `syntax_info.js`, `hlp.js`, `bq.js`, `kbds.js`, `wse.js`, `style/**`, `docs/**` | Merges unchanged. Most commits are this kind. |
| **CI and upstream packaging** | `Jenkinsfile`, `CI/**`, `mk` | Merges unchanged. The fork builds with GitHub Actions (`.github/workflows/tauri-port.yml`), so these don't affect the Tauri build. |
| **Electron or Node APIs** | `cn.js`, `init.js`, `ipc.js`, `abt.js`, `ide.js`, `km.js`, `util.js`, `menu.js`, `prf*.js`, `demo.js`, `main.js` | Conflicts likely. Re-express the change on `D.host` (see the [translation table](#translating-electron-and-node-calls)). If it's a new capability, add it to both `src/host/electron.js` and `src/host/tauri.js` (plus Rust, if it needs sockets or the OS). |
| **Electron version and dependencies** | `package.json`, `package-lock.json` | Take `master`'s `package.json` change, then run `npm install` to regenerate the lock file. A new frontend dependency must also be added to `src-tauri/stage-frontend.js` (`files`/`dirs`), or the Tauri build won't ship it. |

## Hotspots

These shared files were rewritten by the port (`git diff --stat 307003ef tauri-port`). Expect conflicts when upstream edits them:

- **`src/cn.js`** (heavy): now a plain script (`D.cn.start`) on `D.host.conn`. Sockets, framing and TLS have moved to `src/host/electron.js` and `src-tauri/src/conn.rs`. Changes to connection *behaviour* belong there, and changes to the Connect page stay here.
- **`src/ipc.js`** (heavy): `node-ipc` is gone. Windows message each other by label through `D.host.ipc`.
- **`src/init.js`** (heavy): window creation, quit and close prompts are async through `D.host.win` and `D.host.dlg`.
- **`main.js`** (moderate): bounds code moved to `src/winstate.js`, and IPC/dialog code moved into `src/host/electron.js`.
- **`src/km.js`, `src/util.js`, `src/ide.js`, `src/menu.js`, `src/prf*.js`, `src/abt.js`, `src/demo.js`** (moderate): synchronous dialogs, storage, clipboard and menus became `await D.host.*`.
- **`src/se.js`, `src/ed.js`** (light): a guard or two. Rarely in the way.

New on the port, so never in conflict: `src/host/*.js`, `src/winstate.js`, `src-tauri/**`, `.github/workflows/tauri-port.yml`.

## Procedure

1. **Fetch and preview.** Before merging anything, see where it conflicts:

   ```powershell
   git fetch origin
   git merge-tree --write-tree --name-only --no-messages tauri-port origin/master
   ```

   The first line is a tree id. Any other lines are the files that conflict. Run it against `master`'s previous tip as well to tell the port's conflicts from upstream's own.

2. **Merge, don't rebase.** `tauri-port` is published, it's the fork's default branch, and releases are tagged from it. So bring `master` in with a merge:

   ```powershell
   git merge --no-ff origin/master
   ```

   Release notes list first-parent commits, so the whole upstream batch shows up as one entry. To take single fixes from a maintenance branch (`ride4.x`) that haven't reached `master` yet, use `git cherry-pick -x <commit>`. The `-x` records where each one came from, so later merges are easy to follow.

3. **Resolve conflicts.** Keep the port's structure and apply upstream's *intent* inside it. Each conflict is an Electron/Node call site the port has already moved. Find where that code lives now (usually `src/host/electron.js` or a `D.host.*` call) and change it there. Use the table below. Find any Node that reappeared with:

   ```powershell
   git diff ORIG_HEAD -- src | Select-String 'D\.el\b|nodeRequire|require\(|Sync\('
   ```

   `D.el` is allowed only for spawning an interpreter, listen mode, SSH and IME, which are out of scope for Tauri. Everything else goes through `D.host`, and `D.desktop` is the "running in a desktop shell" flag.

4. **Verify** (see [Re-verification](#re-verification)).

5. **Commit the merge** with a note on any conflict you translated rather than took as-is.

## Translating Electron and Node calls

Every `D.host` call returns a Promise ([ADR 0001](../adr/0001-async-host-adapter.md)), so a synchronous upstream call becomes `await` and its caller becomes `async`.

| Upstream writes | On tauri-port |
|---|---|
| `if (D.el)` as a "desktop" check | `if (D.desktop)` |
| `dialog.showMessageBoxSync(...)` / `showOpenDialogSync` | `await D.host.dlg.message({...})` / `await D.host.dlg.open({...})` |
| `new BrowserWindow({...})`, `webPreferences` options | `D.host.win.open(label, page, opts)`. Electron-only `webPreferences` go in the window factory in `src/host/electron.js`. Ask whether Tauri needs an equivalent. |
| `bw.setBounds` / `getBounds` / `focus` / `close` | `D.host.win.setBounds(label, b)` and so on, addressed by window label |
| `node-ipc` / `D.ipc.server.emit` | `D.host.ipc.send(label, type, data)` / `D.host.ipc.on(type, fn)` |
| `Menu.buildFromTemplate` / context menu | `D.host.menu.setApp(template, onClick)` / `await D.host.menu.popup(template)` |
| `fs.readFileSync` of prefs, connections or history | `D.db` (a sync snapshot) or `D.host.store` |
| other `fs.*Sync` | `await D.host.fs.readText` / `writeText` / `appendText` / `remove` |
| `process.env` / `argv` / `platform` / `arch` / `versions` | `D.host.sys.env` and so on (a sync snapshot) |
| `clipboard.readText()` | `await D.host.sys.clipboard.readText()` |
| `shell.openExternal(url)` | `D.host.sys.openExternal(url)` |
| `net.connect` / `tls.connect` / socket events in `cn.js` | `D.host.conn`. Socket and error handling is in `src/host/electron.js` and `src-tauri/src/conn.rs`. Change both. |

If the change needs something `D.host` doesn't offer, add it to both `src/host/electron.js` and `src/host/tauri.js`. Keep Rust to sockets, framing, TLS and OS calls; RIDE protocol logic stays in JS.

## Re-verification

Run these after every merge (prerequisites: Node, a Rust toolchain, and WebView2 on Windows):

1. `npx eslint <touched files>`: no *new* problems. `master` already has around 1800, so a clean run isn't the bar.
2. `cargo build` in `src-tauri`, only if `src-tauri/**` changed.
3. `npm run tauri:build`. The exe lands in `src-tauri\target\release\ride.exe` and must stay under 20 MB.
4. Start Dyalog 20 serving RIDE (`dyalog.exe RIDE_INIT=SERVE:*:4502`) and run [`smoke-cdp.js`](../../.wayfinder/assets/smoke-cdp.js) in **both** shells. It should report 7/7.
   - Electron: `$env:RIDE_CONNECT='127.0.0.1:4502'; node_modules\electron\dist\electron.exe . --remote-debugging-port=9222`
   - Tauri: `$env:RIDE_CONNECT='127.0.0.1:4502'; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; src-tauri\target\release\ride.exe`
   - then: `node .wayfinder\assets\smoke-cdp.js 9222`
5. If the merge touched an area that has its own check, run that too, in both shells:

   | Touched | Script |
   |---|---|
   | floating editors, `ipc.js`, `ed.js` window code | [`float-cdp.js`](../../.wayfinder/assets/float-cdp.js) |
   | prefs/status/about/log windows | [`aux-cdp.js`](../../.wayfinder/assets/aux-cdp.js) |
   | window bounds, layouts, `winstate.js` | [`bounds-cdp.js`](../../.wayfinder/assets/bounds-cdp.js) `tauri electron` |
   | env, files, clipboard, devtools, drag-and-drop | [`sys-cdp.js`](../../.wayfinder/assets/sys-cdp.js) |
   | quit and close prompts | [`quit-cdp.js`](../../.wayfinder/assets/quit-cdp.js) |

6. Take a quick manual look at whatever the upstream change was about.

To re-measure drift later, run `python .wayfinder/assets/drift-replay.py <range>`. It prints the same table as above (edit `MASTER`/`FWD_REFS` at the top).
