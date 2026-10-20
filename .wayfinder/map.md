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
## Not yet specified

- **Wiring the frontend to the host adapter in the Electron shell.** Shape depends on the host-adapter design; probably several tickets split by area (windows, menus, prefs, file IO).
- **Tauri implementation of each adapter area** beyond the connection: menus and context menus, dialogs, clipboard, open-external, zoom, devtools. The inventory adds printing (`webContents.print`), relaunch for "New Session", drag-and-drop `.dws` (no `File.path`), the auxiliary windows (About, protocol log, 3500⌶ HTML, status, the String/Task dialog), `RIDE_EDITOR` external editing, and the `RIDE_JS`/`RIDE_CSS`/`RIDE_DEMO_SCRIPT` env hooks.
- **Window bounds and layouts.** Porting `main.js`'s two-layout bounds save/restore (the window-state plugin doesn't fit).
- **Packaging and size.** Bundle config per platform, measuring and trimming the Windows exe under 20 MB, Linux WebKitGTK quirks (IME, fonts, NVIDIA flicker), macOS paste prompt.
- **Build integration.** How Grunt/LESS output feeds Tauri's frontend dist; whether CI is touched at all.

## Out of scope

- **Spawning an interpreter, listen mode, SSH connections.** Not needed for the experiment.
- **Windows APL IME installer** (`windows-ime/`). Installer component, not app functionality.
- **Browser mode** (interpreter serving RIDE over HTTP). Not a constraint; may break.
