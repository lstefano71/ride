---
title: Document building the Tauri port and its philosophy
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

The repo has nothing about the Tauri port for a newcomer: `readme.md` doesn't mention it. Only `CONTEXT.md` and ADRs 0001/0002 cover parts of it. Write a doc that covers:

- **Building:** prerequisites (Rust toolchain, WebView2, Node), `npm run tauri:dev` / `tauri:build`, staging into `_/tauri-frontend`, where the exe lands, version injection, and how to run the CDP smoke scripts.
- **Philosophy:** port not rewrite, one frontend two shells behind `D.host`, thin Rust (sockets/framing/TLS only), shared versioned data folder, what's out of scope. Link the ADRs, `CONTEXT.md` and the map rather than restating them.

Link it from `readme.md`. If CI exists by then ([Build the Windows Electron and Tauri zips in GitHub Actions and release them](024-ci-windows-zips.md)), mention it. If the porting guide exists ([Assess drift from master and write the porting procedure](025-master-drift-and-porting-guide.md)), link it.
