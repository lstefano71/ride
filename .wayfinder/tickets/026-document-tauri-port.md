---
title: Document building the Tauri port and its philosophy
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

The repo has nothing about the Tauri port for a newcomer: `readme.md` doesn't mention it. Only `CONTEXT.md` and ADRs 0001/0002 cover parts of it. Write a doc that covers:

- **Building:** prerequisites (Rust toolchain, WebView2, Node), `npm run tauri:dev` / `tauri:build`, staging into `_/tauri-frontend`, where the exe lands, version injection, and how to run the CDP smoke scripts.
- **Philosophy:** port not rewrite, one frontend two shells behind `D.host`, thin Rust (sockets/framing/TLS only), shared versioned data folder, what's out of scope. Link the ADRs, `CONTEXT.md` and the map rather than restating them.

Link it from `readme.md`. If CI exists by then ([Build the Windows Electron and Tauri zips in GitHub Actions and release them](024-ci-windows-zips.md)), mention it. If the porting guide exists ([Assess drift from master and write the porting procedure](025-master-drift-and-porting-guide.md)), link it.

## Resolution

Wrote [The Tauri port](../../docs/dev/tauri-port.md) (`docs/dev/tauri-port.md`, next to the porting guide) and linked it from a new "Tauri shell" section in `readme.md`.

- **Philosophy:** port not rewrite, one frontend on `D.host` in two shells, thin Rust, shared `Ride-4.8` data folder, keep merging `master`. It gists each point and links ADR 0001/0002, `CONTEXT.md`, the porting guide and the map (for out-of-scope items and decision history) instead of restating them.
- **Building:** prerequisites (Node, Rust ≥ 1.90, WebView2; the Node 26 Electron workaround is linked, not copied), a table of `tauri:stage` / `tauri:dev` / `tauri:build`, staging into `_/tauri-frontend` with `vendor/`, where `ride.exe` lands, version injection via `tauri-cli.js`, and the `stage-frontend.js` file list to update for new frontend files.
- **Checking:** the launch commands for both shells with CDP, `smoke-cdp.js` 7/7, and a pointer to the porting guide's re-verification table for the area scripts.
- **CI:** the GitHub Actions workflow, its two zips, how to release, and that docs-only pushes skip the build.

The doc is left out of `mkdocs.yml` nav, like the porting guide, because the site is the user guide. Every relative link was checked to resolve. Docs-only change, so no build or smoke was run.
