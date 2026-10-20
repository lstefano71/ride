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
- **Verification per build ticket:** `cargo build` and `npm run lint` pass, plus a manual smoke check against a live interpreter.
- **Interpreter:** Dyalog 20 at `d:\devel\dyalog\20.0` (`dyalog.exe`). The user can supply an installed official RIDE for comparison on request. Skills: `dyalog-ride` / `dyalog-apl-runner` for interpreter work.
- **Commits:** one commit per resolved ticket on `tauri-port`; no pushes until the user picks a remote.
- **Packaging targets:** Windows single exe (WebView2 runtime assumed present, size goal applies here only), macOS `.app`/`.dmg`, Linux AppImage/`.deb`.
- **Tracker:** local markdown. Map: `.wayfinder/map.md`. Tickets: `.wayfinder/tickets/NNN-slug.md` with front matter `title`, `type` (`wayfinder:research|prototype|grilling|task`), `status` (`open|closed`), `assignee` (the claim), `blocked_by` (ticket ids; no native blocking, so this is the convention). Resolution is appended to the ticket as `## Resolution`. Frontier = open, unclaimed tickets whose `blocked_by` are all closed.

## Decisions so far

<!-- one line per closed ticket -->

## Not yet specified

- **Wiring the frontend to the host adapter in the Electron shell.** Shape depends on the host-adapter design; probably several tickets split by area (windows, menus, prefs, file IO).
- **Tauri implementation of each adapter area** beyond the connection: menus and context menus, dialogs, clipboard, open-external, zoom, devtools.
- **Floating editor windows in Tauri.** Approach waits on the floating-windows research; parity is the goal unless it proves costly.
- **Preferences persistence.** Where prefs live under Tauri, and whether existing Electron prefs are migrated or read in place.
- **TLS connections.** Exploratory; graduates once the TLS research reports.
- **Packaging and size.** Bundle config per platform, measuring and trimming the Windows exe under 20 MB, Linux WebKitGTK quirks.
- **Build integration.** How Grunt/LESS output feeds Tauri's frontend dist; whether CI is touched at all.

## Out of scope

- **Spawning an interpreter, listen mode, SSH connections.** Not needed for the experiment.
- **Windows APL IME installer** (`windows-ime/`). Installer component, not app functionality.
- **Browser mode** (interpreter serving RIDE over HTTP). Not a constraint; may break.
