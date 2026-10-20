---
title: Research how Tauri v2 can support floating editor windows
type: wayfinder:research
status: closed
assignee: copilot
blocked_by: []
---

## Question

RIDE opens editors and dialogs in separate OS windows that reach into the main window's JS state through `@electron/remote` (`D.el.BrowserWindow`, `getGlobal`, shared `D` object; see `src/init.js`, `src/ide.js`). What does Tauri v2 offer for the same: multiple `WebviewWindow`s with events/IPC, `window.open` with a usable `window.opener` on WebView2/WKWebView/WebKitGTK, multiple webviews in one window, or something else? For each option: can child windows call the main window's JS synchronously or only by message passing, per-platform caveats, and rough porting cost. Recommend one, or recommend in-app panels if no option reaches parity cheaply.

## Resolution

Use one Tauri `WebviewWindow` per floating window, with Tauri events addressed by window label replacing `node-ipc`. The premise was wrong: floating windows never call main-window JS synchronously. They already exchange async JSON over `node-ipc` (`src/ipc.js`, `dialog.html`, `status.html`), and `@electron/remote` is only used for native window operations. Porting means writing a same-API shim keyed by label; `getContentBounds`/`getDisplayMatching` become async. `window.open`/`opener` and multi-webview were rejected (platform-split behaviour, unreleased fixes, `unstable` feature). Docked mode (`floating=0`, the default) can ship first.

Findings: `.wayfinder/research/tauri-floating-windows.md` on branch `research/tauri-floating-windows` (commit `a8754b38`).
