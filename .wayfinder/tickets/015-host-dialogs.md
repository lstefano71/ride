---
title: Make dialogs async on D.host.dlg
type: wayfinder:task
status: open
assignee:
blocked_by: ["012"]
---

## Question

Implement `D.host.dlg.message` and `D.host.dlg.open`, and reshape every sync dialog site onto them: `$.alert`, `$.err`, `$.confirm`, `optionsDialog`, `taskDialog`'s native branch, `showOpenDialogSync` in `km.js` (OWS) and `cn.js`. Fix `cn.js` `save()` (it uses `$.confirm`'s return value). The unsaved-changes `onbeforeunload` prompt in floating editors moves with `D.host.win.onCloseRequested` in [Replace node-ipc with D.host.ipc and message-fed aux windows](017-host-ipc.md). Done when every dialog works in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.