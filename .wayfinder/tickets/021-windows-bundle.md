---
title: Bundle the Tauri RIDE for Windows
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Turn on bundling in `src-tauri/tauri.conf.json` (it is `"active": false` today) and produce the Windows deliverable the destination asks for: a single exe under 20 MB, with WebView2 assumed present. Decide whether that is the bare `ride.exe` (8.77 MB after [Port window bounds and the launch/main layout switch onto D.host.win](020-window-bounds-layouts.md#resolution)) or an NSIS/MSI installer, and settle the icon, product name and version metadata. Electron's `Ride-4.8` data folder is shared ([ADR 0002](../../docs/adr/0002-shared-versioned-data-folder.md)), so the identifier must not move it.

Done when the artifact installs or runs under a fresh Windows user profile, connects to Dyalog 20 (smoke 7/7), shows RIDE's icon and version in Explorer and in About, and is under 20 MB.
