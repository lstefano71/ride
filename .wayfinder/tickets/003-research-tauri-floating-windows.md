---
title: Research how Tauri v2 can support floating editor windows
type: wayfinder:research
status: open
assignee:
blocked_by: []
---

## Question

RIDE opens editors and dialogs in separate OS windows that reach into the main window's JS state through `@electron/remote` (`D.el.BrowserWindow`, `getGlobal`, shared `D` object; see `src/init.js`, `src/ide.js`). What does Tauri v2 offer for the same: multiple `WebviewWindow`s with events/IPC, `window.open` with a usable `window.opener` on WebView2/WKWebView/WebKitGTK, multiple webviews in one window, or something else? For each option: can child windows call the main window's JS synchronously or only by message passing, per-platform caveats, and rough porting cost. Recommend one, or recommend in-app panels if no option reaches parity cheaply.
