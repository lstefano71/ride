---
title: Bundle the Tauri RIDE for Windows
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

Turn on bundling in `src-tauri/tauri.conf.json` (it is `"active": false` today) and produce the Windows deliverable the destination asks for: a single exe under 20 MB, with WebView2 assumed present. Decide whether that is the bare `ride.exe` (8.77 MB after [Port window bounds and the launch/main layout switch onto D.host.win](020-window-bounds-layouts.md#resolution)) or an NSIS/MSI installer, and settle the icon, product name and version metadata. Electron's `Ride-4.8` data folder is shared ([ADR 0002](../../docs/adr/0002-shared-versioned-data-folder.md)), so the identifier must not move it.

Done when the artifact installs or runs under a fresh Windows user profile, connects to Dyalog 20 (smoke 7/7), shows RIDE's icon and version in Explorer and in About, and is under 20 MB.

## Resolution

The Windows deliverable is the **bare `ride.exe`**, decided with stf. It is a portable single file of 8.77 MB that embeds the whole frontend, with no DLLs or side files. `bundle.active` stays `false`, so Tauri builds no NSIS or MSI. An installer is left to Dyalog's own WiX scripts (`CI/packagescripts/windows`), outside this effort.

- **Version.** The exe's file and product version is `4.8.<commit count>`, the same number `mk` gives the Electron exe and About shows. A new [`src-tauri/version.js`](../../src-tauri/version.js) computes it the way `mk` does, honouring `APPVERSION` for Dyalog builds. `stage-frontend.js` now uses it for `_/version.js`. The new [`src-tauri/tauri-cli.js`](../../src-tauri/tauri-cli.js) runs the Tauri CLI with `--config {version, bundle.copyright}` merged in, and `tauri:dev`/`tauri:build` go through it. Running `cargo build` or `npx tauri` directly still gives `4.8.0`. The app never reads its own version at runtime.
- **Metadata.** `bundle.publisher` is "Dyalog Ltd", which is now the CompanyName (it was "dyalog", taken from the identifier). The copyright year is the current year, as in `mk`. ProductName and FileDescription are both "RIDE": tauri-build ties FileDescription to `productName`, unlike Electron's "Cross-platform IDE for Dyalog APL", and that name also reads better in Task Manager. OriginalFilename is unset, because tauri-build doesn't expose it.
- **Icon.** The exe already carried RIDE's D icon, generated from `D.svg` in [Scaffold a Tauri v2 shell that loads the existing frontend](006-scaffold-tauri-shell.md#resolution).
- **Identifier.** `com.dyalog.ride` is unchanged. It only names the WebView2 cache folder. Prefs stay in `%APPDATA%\Ride-4.8` (ADR 0002).

Verification:
- `npm run tauri:build` passes. `ride.exe` is 8.77 MB, and Explorer shows FileVersion/ProductVersion 4.8.4316, CompanyName Dyalog Ltd, copyright (c) 2014-2026 Dyalog Ltd, and the D icon.
- A copy alone in an empty temp folder passes smoke 7/7 against Dyalog 20.
- Fresh Windows user profile (checked by stf): it runs, shows the D icon, connects to Dyalog 20, and About shows 4.8.4316.
- `npx eslint` on `version.js`, `tauri-cli.js` and `stage-frontend.js`: clean.
