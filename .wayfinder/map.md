---
title: Port RIDE from Electron to Tauri
labels: [wayfinder:map]
status: open
---

## Destination

RIDE runs as a Tauri v2 app built from the `tauri-port` branch: it connects over TCP to a Dyalog 20 interpreter with feature parity for everything in scope (session, editors, tracer, floating windows, preferences, menus, themes, keyboard layouts), and the Windows build is a single exe under 20 MB. The work is carried out on the map, not just planned.

## Notes

- **Execution is in scope.** This map overrides the wayfinder default: tickets carry the port out, not only decide it. Build tickets end with working code.
- **Port, not rewrite.** The existing JS/jQuery/Monaco frontend is kept; only the Electron/Node layer is replaced.
- **One frontend, two shells.** Electron and Tauri shells both run the same frontend behind a host adapter (see `CONTEXT.md`). If keeping Electron alive becomes a burden, switch to Tauri-only: record that as a decision, don't drift into it.
- **Thin Rust.** Rust owns sockets and framing only; RIDE protocol logic stays in JS.
- **Dependency upgrades** (Monaco 0.31, jQuery, Grunt/LESS) are avoided by default, allowed when they block progress. Upstream is wary of Monaco upgrades breaking things, so call out any upgrade in the resolution.
- **Verification per build ticket:** `cargo build` passes, `npx eslint` reports no new problems in touched files (`master` has ~1800 and no lint script, so a clean run isn't the bar), plus a smoke check against a live interpreter: [smoke-cdp.js](assets/smoke-cdp.js) over CDP, then a manual look.
- **Interpreter:** Dyalog 20 at `d:\devel\dyalog\20.0` (`dyalog.exe`). The user can supply an installed official RIDE for comparison on request. Skills: `dyalog-ride` / `dyalog-apl-runner` for interpreter work.
- **Commits:** one commit per resolved ticket on `tauri-port`; no pushes until the user picks a remote.
- **Packaging targets:** Windows single exe (WebView2 runtime assumed present, size goal applies here only), macOS `.app`/`.dmg`, Linux AppImage/`.deb`.
- **Tracker:** local markdown. Map: `.wayfinder/map.md`. Tickets: `.wayfinder/tickets/NNN-slug.md` with front matter `title`, `type` (`wayfinder:research|prototype|grilling|task`), `status` (`open|closed`), `assignee` (the claim), `blocked_by` (ticket ids; no native blocking, so this is the convention). Resolution is appended to the ticket as `## Resolution`. Frontier = open, unclaimed tickets whose `blocked_by` are all closed.

## Decisions so far

<!-- one line per closed ticket -->

- [Research how Tauri v2 can support floating editor windows](tickets/003-research-tauri-floating-windows.md): one `WebviewWindow` per floating window plus a label-addressed event shim replacing `node-ipc`; RIDE never shared JS synchronously across windows; docked mode can ship first.
- [Research Tauri v2 coverage of RIDE's Electron features](tickets/004-research-tauri-api-coverage.md): no blockers; main costs are async-everything, dialog/menu small gaps, data-folder relocation; about 2.7 MiB base exe, so under 20 MB is realistic.
- [Research TLS connections in Rust for RIDE](tickets/005-research-tls-connect.md): rustls with a custom CN verifier works against Dyalog 20 (2–4 days); today's TLS option is silently dead in `cn.js`.
- [Inventory Electron and Node usage in the frontend](tickets/001-inventory-electron-node-usage.md): [inventory asset](assets/electron-inventory.md); shallow but wide, the main cost is sync dialogs and storage, `D.el` doubles as a desktop flag, the `node-ipc` vocabulary is closed, and four `userData` files exist.
- [Run the Electron RIDE against Dyalog 20 as a baseline](tickets/002-baseline-electron-against-dyalog20.md): works; scripted CDP smoke check (session, editor, tracer, floating) all pass; Electron install needs a manual workaround on Node 26/npm 12; lint isn't a usable gate.
- [Scaffold a Tauri v2 shell that loads the existing frontend](tickets/006-scaffold-tauri-shell.md): `src-tauri/` renders the untouched frontend with no Node (7.02 MB release exe); assets are staged into `_/tauri-frontend` with `node_modules` renamed to `vendor/`; without `D.el` it falls into browser mode and its WebSocket fails harmlessly.
- [Design the host adapter interface](tickets/007-design-host-adapter.md): one async-only `D.host` (areas `conn/win/ipc/menu/dlg/store/sys/fs`) implemented by both shells ([ADR 0001](../docs/adr/0001-async-host-adapter.md)); `D.desktop` replaces `D.el` as a flag; windows addressed by label; one migration ticket per area, built and smoke-checked in both shells.
- [Decide where preferences live under Tauri](tickets/010-decide-prefs-location.md): both shells share Electron's versioned folder (`config_dir()/Ride-4.8`) with identical files and no migration; Rust resolves paths; last writer wins; unthrottled write-behind; winstate shared with matching semantics ([ADR 0002](../docs/adr/0002-shared-versioned-data-folder.md)).
- [Introduce the host adapter skeleton and desktop flag](tickets/012-host-adapter-skeleton.md): `src/host/{electron,tauri}.js` set `D.host`/`D.desktop` on every page; Tauri leaves browser mode for a placeholder (the Connect page moved to the cn.js ticket); only 3 flag sites were shell-neutral, and the rest are listed on their area tickets.
- [Move cn.js to a plain script on a message-level connection](tickets/013-cn-message-level-connection.md): `cn.js` is a plain script (`D.cn.start`) over an abortable, message-level `D.host.conn` (framing in `host/electron.js`, Electron-only `adopt` for spawn/listen/SSH); TLS works again, `nudge` is gone; Tauri shows the Connect page and its `connect` is an `ENOTSUP` stub; other Node sites are guarded and handed to their area tickets.
- [Bridge the RIDE TCP connection through Rust](tickets/008-rust-tcp-bridge.md): `src-tauri/src/conn.rs` (tokio) owns the sockets and framing, with events on a per-connection `Channel`; Tauri connects from the Connect page and runs `⍳10`, and the smoke passes 6/7 (floating is pending); sends are batched for order, early events are held until listeners exist, and a reload frees the interpreter; TLS is still `ENOTSUP`; exe 7.11 MB.
- [Implement TLS connect in the Rust connection bridge](tickets/009-tls-connect-in-rust.md): rustls/ring with a CN-only verifier, pinning for a self-signed root and leniency for Dyalog's malformed test CA; Tauri connects to Dyalog 20 over TLS (smoke 6/7), a wrong CN gives RIDE's own error, and silent resets now say why; exe 8.12 MB.

## Not yet specified

- **Window bounds and layouts.** Porting `main.js`'s two-layout bounds save/restore (the window-state plugin doesn't fit) and the launch↔main layout switch (`save-win`, `toggleConfig`) onto `D.host.win`. `winstate.json` is shared with Electron, so Tauri must write bounds with the same meaning (see [Decide where preferences live under Tauri](tickets/010-decide-prefs-location.md)). `cn.js` keeps `winstate`/`toggleConfig`/`save-win` behind `D.el`; under Tauri the Connect page uses default launch-layout values and is clipped by the 800 px scaffold window. Closing or reloading while connected shows WebView2's native, renderer-blocking "Reload site?" prompt (from `onbeforeunload` setting `returnValue`), so close/quit confirmation needs a Tauri path too.
- **Packaging and size.** Bundle config per platform (bundling is off in the scaffold), Linux WebKitGTK quirks (IME, fonts, NVIDIA flicker), macOS paste prompt. The bare Windows exe is 7 MB, so size is a check to repeat, not work to do.
- **Build integration.** Staging (`npm run tauri:stage`) already feeds Grunt/LESS output into Tauri. Still open: restaging during `tauri dev` without a manual step, and whether CI is touched at all.

## Out of scope

- **Spawning an interpreter, listen mode, SSH connections.** Not needed for the experiment.
- **Windows APL IME installer** (`windows-ime/`). Installer component, not app functionality.
- **Browser mode** (interpreter serving RIDE over HTTP). Not a constraint; may break.
- **`RIDE_EDITOR` external editing, `DEV_STYLE` live reload, spectron test hooks** (`global.js`, `spectron_temp_dir`, `NODE_ENV==='test'`). `RIDE_EDITOR` needs process spawn; the others are dev tooling that CDP smoke replaces. Ruled out in [Design the host adapter interface](tickets/007-design-host-adapter.md).
