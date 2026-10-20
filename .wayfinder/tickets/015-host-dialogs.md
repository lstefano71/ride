---
title: Make dialogs async on D.host.dlg
type: wayfinder:task
status: open
assignee:
blocked_by: ["012"]
---

## Question

Implement `D.host.dlg.message` and `D.host.dlg.open`, and reshape every sync dialog site onto them: `$.alert`, `$.err`, `$.confirm`, `optionsDialog`, `taskDialog`'s native branch, `showOpenDialogSync` in `km.js` (OWS) and `cn.js`. (`cn.js` `save()` already uses `$.confirm`'s callback form since [Move prefs and storage onto D.host.store](014-host-store.md#resolution).) The unsaved-changes `onbeforeunload` prompt in floating editors moves with `D.host.win.onCloseRequested` in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md). Done when every dialog works in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `util.js:105`, `218`, `303`, `309`, `316` (in Tauri these currently fall back to `alert`/browser branches)
- `km.js:131` (OWS)
- `ide.js:1063` (unsaved-changes prompt, with `onCloseRequested`)
- `cn.js` `browse()` (handed over by [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)): returns early under Tauri, so the log/cert/key/root-certs `...` buttons do nothing there.
