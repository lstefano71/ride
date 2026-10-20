---
title: Fix the session decoration error on connect under Tauri
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Under Tauri, connecting to Dyalog 20 sometimes throws `TypeError: Cannot read properties of undefined (reading 'type')` in `Se.setGroupDecorations` (`se.js:456`, reached from the debounced `se.setDecorations`). Found during [Move prefs and storage onto D.host.store](014-host-store.md#resolution). It happens about half the time on a fresh app start, with persistent history on or off, and never in Electron. The walk over model rows advances through `se.lines` only on non-dirty rows, so `curr` runs past the end when the model has more such rows than `se.lines` has entries. The suspect is message timing from the Rust bridge: batched or held events (see [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md#resolution)) let the session text and `se.lines` drift apart. Find the cause, then fix it in the bridge/adapter if timing is the trigger, or in `se.js` if the code is fragile in both shells. Done when 10 fresh Tauri starts connect without the error, and the CDP smoke still passes in both shells.
