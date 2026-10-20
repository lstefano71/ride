---
title: Move cn.js to a plain script on a message-level connection
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["012"]
---

## Question

Turn `cn.js` from a CommonJS module loaded through `nodeRequire` into a plain script that sets `D.cn`, and move its sockets and framing (`net`, `tls`, `Buffer`, the 4-byte length + `RIDE` magic parsing, `nudge`) behind `D.host.conn` (`connect(opts) -> {send, onMessage, onError, onClose, close}`) in the Electron adapter. Protocol logic and the handshake stay in `cn.js`. Keep TLS keyed off `subtype === 'ssl'`. Done when Electron connects to Dyalog 20 and runs `⍳10` through the new seam. The Tauri side is [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md).

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `init.js`: the Tauri placeholder (`#host_pending`) in the main-window branch. Replace it with the Connect page, and load `cn.js` as a script in both shells instead of ``nodeRequire(`${__dirname}/src/cn`)``. **Also done when** the Tauri build shows the Connect page (connecting from it is [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md)).
- `km.js:264` (LOG) also `nodeRequire`s `cn`.
- `cn.js`: every `D.el`/`D.elw`/`nodeRequire` use.

## Resolution

**Done. `cn.js` is a plain script loaded by `index.html` in both shells. It sets `D.cn = {start, getLog, addLogListener, rmLogListener}`, and every connection goes through a message-level `D.host.conn`. Electron connects to Dyalog 20 and runs `⍳10` through the new seam, and the Tauri build shows the Connect page.** Scope agreed with the user: **narrow**, and spawn/listen/SSH **kept** in Electron.

### The `conn` contract as built

- `D.host.conn.connect({host, port, ssl, cert, key, subj, rootcertsdir}, {signal}) → Promise<conn>`. It resolves once connected (after the TLS handshake when `ssl`) and rejects with an error. `signal` is an `AbortSignal`; aborting destroys the socket and rejects with code `ABORT`, which `cn.js` treats as silent. The Connect page's cancel button aborts a pending connect and closes an established one.
- `conn`: `send(str) → Promise`, `onMessage(fn(str))`, `onError(fn(err))`, `onClose(fn)`, `close() → Promise`. Listeners stack. Messages that arrive before the first `onMessage` are buffered. `onClose` fires on a clean EOF only; a reset arrives as `onError` (code `ECONNRESET`), as with Node's `end` before.
- **Errors** are `Error`s carrying `{name, code, message, hostname?}`. `cn.js` special-cases `ENOTFOUND` (uses `hostname`), keeps `ECONNRESET`/`ETIMEDOUT`/`ABORT` silent, and reports `ECONNABORTED` after connect as "already serving another Ride client". The adapter adds `EPROTO` ("Bad protocol message": a frame of 8 bytes or fewer, after which it drops the socket instead of stalling as before) and `ECERTNAME` (TLS subject CN ≠ host when `subj` is set). When dual-stack connects fail on several addresses, the messages are joined and `name` is the code, matching the old dialog.
- Framing (4-byte big-endian length including itself + `RIDE` + UTF-8 payload) and the receive buffer moved verbatim from `cn.js` into `host/electron.js`. Each message is now written separately, where the handshake used to be written as one concatenated write.
- **Electron only:** `D.host.conn.adopt(socket) → conn` frames a socket `cn.js` already holds (spawned interpreter, listen mode, SSH forward in/out). These paths keep `nodeRequire` in `cn.js`. Under Tauri the Start/Listen types and the SSH subtype are removed from the form.
- **Tauri:** `connect` rejects with `ENOTSUP` ("Connecting is not available in the Tauri shell yet.") until [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md).

### Other changes

- **TLS works again.** `connect` now gets `ssl: x.subtype === 'ssl'`. Before, it read `x.ssl`, which no config sets, so "via TLS/SSL" silently connected in the clear. Against Dyalog's plain-TCP port it now fails the handshake (`WRONG_VERSION_NUMBER`) as it should.
- **`nudge` removed** (the `cn.js` broadcasts and the responder in `ipc.js`). Connect, listen and the CDP smoke all pass without it on Electron 35, so the Ride #387 workaround is no longer needed.
- `init.js`: the `#host_pending` placeholder is gone. Both shells call `D.cn.start()`, and Electron still waits for its hidden windows first. `km.js` LOG uses `D.cn` instead of `nodeRequire`.
- Every other Node site in `cn.js` stays in Electron behind a `D.el`/`fs` guard and does nothing under Tauri. Each one is listed on the ticket that owns it: connections file → [Move prefs and storage onto D.host.store](014-host-store.md); `browse()` → [Make dialogs async on D.host.dlg](015-host-dialogs.md); argv/env, temp/pid log path, protocol log file, F12, `networkInterfaces` → [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md); `winstate`/`toggleConfig`/`save-win` → the "Window bounds and layouts" fog (under Tauri the page uses default launch-layout values and doesn't resize the window). The spectron `global.go` hook is kept, Electron-only.

### Verification

- `npm run tauri:build` passes; `ride.exe` is still 7.02 MB.
- ESLint on `cn.js`, `init.js`, `km.js`, `ipc.js`, `host/*`: 24 problems against a baseline of 25 (one `no-console` removed from `cn.js`), none new.
- **Electron** against Dyalog 20:
  - `RIDE_CONNECT`: [smoke-cdp.js](../assets/smoke-cdp.js) passes all 7 checks, and `⍳10` → `0 1 2 3 4 5 6 7 8 9` (`⎕IO←0` left over from the smoke run). `D.cn.getLog()` and the LOG window show traffic.
  - Connect page over CDP, with `$.err` stubbed: refused port → `connect ECONNREFUSED`; unknown host → "Host not found"; cancel during connect to a black-hole address → silent, dialog closed, timer cleared; `subtype: 'ssl'` → TLS handshake error; plain connect → session up and `⍳10` runs.
  - Listen mode (`RIDE_LISTEN`, second interpreter with `RIDE_INIT=CONNECT:`) → connected, `⍳3` runs. Killing that interpreter → session dies with no dialog, as before.
- **Tauri** release exe over CDP: Connect page visible with the splash hidden and no placeholder; the form offers only `connect` with `raw`/`ssl`; Go shows the `ENOTSUP` error; no exceptions or console errors on reload; checked by screenshot. The config panel is clipped by the 800 px scaffold window (window-bounds fog).
- No dependency upgrades.
