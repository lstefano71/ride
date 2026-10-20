---
title: Move native and context menus onto D.host.menu
type: wayfinder:task
status: open
assignee:
blocked_by: ["012"]
---

## Question

Implement `D.host.menu.setApp(template) -> {setChecked}` and `D.host.menu.popup(template) -> Promise<id|null>` from plain menu data with roles mapped to native/predefined items. Move `menu.js` (app menu, live `checkBoxPref`), the `init.js` context menus and the Connect-page menu onto it. Hide the menu bar in full screen as `main.js` does. Done when the app menu, accelerators, checkbox/radio items and context menus work in both shells.

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.