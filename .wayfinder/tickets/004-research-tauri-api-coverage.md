---
title: Research Tauri v2 coverage of RIDE's Electron features
type: wayfinder:research
status: closed
assignee: copilot
blocked_by: []
---

## Question

For the Electron features RIDE uses outside the connection layer, what is the Tauri v2 equivalent (core API or official plugin) and are there gaps? Cover at least: application and context menus built from templates (`Menu.buildFromTemplate`), native dialogs, clipboard, `shell.openExternal`, zoom, devtools toggle, window bounds save/restore, persisted app data location, single-instance, command-line args, and loading local HTML/JS/CSS (including `nodeRequire`-free module loading). Also report realistic release exe size for a minimal Tauri v2 app on Windows, and the known WebKitGTK/WKWebView issues that matter for a Monaco-based app. Cite sources.

## Resolution

No blockers. Core or official plugins cover menus (incl. accelerators, check items, live updates, popups), dialogs, clipboard, opener, window bounds, app paths, CLI args, and plain `<script>` + Monaco AMD loading. Zoom is already CSS/Monaco-based; single-instance isn't used. Gaps to absorb: everything is async (sync dialogs and sync prefs reads need refactoring); message dialogs are limited to 3 buttons with no checkbox (use RIDE's HTML dialog); no radio menu items (fake with check items); some predefined menu items are macOS-only; no `enableDeprecatedPaste` (use clipboard plugin `readText()`); devtools toggle needs a small Rust command, and release `devtools` blocks App Store submission; app data dir moves to the bundle identifier (migrate or override); window-state plugin doesn't fit RIDE's two-layout bounds, so port `main.js` logic. Size: Tauri's CI benchmark is about 2.7 MiB for a size-optimised hello world on Windows, plus Monaco and assets (several MiB), so under 20 MB is realistic. Webview risks: IME bugs on all three platforms, macOS paste prompt, Linux font-weight, NVIDIA blank/flicker and scrolling issues.

Findings: `.wayfinder/research/tauri-api-coverage.md` on branch `research/tauri-api-coverage` (commit `9eb8908e`).
