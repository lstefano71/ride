---
title: Fix the session decoration error on connect under Tauri
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

Under Tauri, connecting to Dyalog 20 sometimes throws `TypeError: Cannot read properties of undefined (reading 'type')` in `Se.setGroupDecorations` (`se.js:456`, reached from the debounced `se.setDecorations`). Found during [Move prefs and storage onto D.host.store](014-host-store.md#resolution). It happens about half the time on a fresh app start, with persistent history on or off, and never in Electron. The walk over model rows advances through `se.lines` only on non-dirty rows, so `curr` runs past the end when the model has more such rows than `se.lines` has entries. The suspect is message timing from the Rust bridge: batched or held events (see [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md#resolution)) let the session text and `se.lines` drift apart. Find the cause, then fix it in the bridge/adapter if timing is the trigger, or in `se.js` if the code is fragile in both shells. Done when 10 fresh Tauri starts connect without the error, and the CDP smoke still passes in both shells.

## Resolution

**Fixed in `se.js`. The bug comes from `master`, isn't specific to Tauri, and has nothing to do with the bridge.** In `setGroupDecorations`, `let next = se.lines[0]` had no `|| {}` fallback, unlike the `se.lines[j + 1] || {}` inside the loop. When the debounced pass runs while `se.lines` is still empty, `curr` becomes `undefined` on the first row and `curr.type` throws. The fix is `let next = se.lines[0] || {};` (from commit `4578a494` on `master`).

**How it happens on connect.** The protocol log shows `SetPromptType {type:1}` arriving in the same batch as `ReplyIdentify`, before `ReplyGetLog`. `prompt(1)` edits the model, which schedules the 100 ms debounced `setDecorations`. That pass runs before the session log has filled `se.lines`. Under Tauri, the log arrived about 220 ms after the prompt.

**The ticket's premise was wrong:** this was never Tauri-only. Electron throws on every fresh start too (3/3), even when the log arrived only 32 ms after the prompt. Earlier checks missed it because they attached CDP after the exception had already been thrown. Collecting buffered exceptions through `Runtime.enable` shows it in both shells. The trailing-rows case named in the question (`curr` running past the end of `se.lines`) was already safe, because of the `|| {}` inside the loop.

**Verification**
- [connect-cdp.js](../assets/connect-cdp.js) (new: N fresh Dyalog + shell starts, collecting exceptions through `Runtime.enable`). Before the fix: Tauri 5/6 runs with the error, Electron 3/3. After the fix: **Tauri 0/10, Electron 0/3**, and every run connected.
- [smoke-cdp.js](../assets/smoke-cdp.js): 7/7 in both shells.
- `npm run tauri:build` passes. Exe 8.77 MB, unchanged.
- ESLint on `src/se.js`: 7 problems before, 7 after.
- No dependency changes.

**Nothing else changed.** The bridge needs no change: the error doesn't depend on its timing. `ReplyGetLog` took 32–150 ms in Electron and about 220 ms in one Tauri sample, which wasn't measured further. Neither shell decorates the prompt line before the log arrives, and the next `add` redraws the decorations.
