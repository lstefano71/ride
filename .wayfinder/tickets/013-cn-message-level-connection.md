---
title: Move cn.js to a plain script on a message-level connection
type: wayfinder:task
status: open
assignee:
blocked_by: ["012"]
---

## Question

Turn `cn.js` from a CommonJS module loaded through `nodeRequire` into a plain script that sets `D.cn`, and move its sockets and framing (`net`, `tls`, `Buffer`, the 4-byte length + `RIDE` magic parsing, `nudge`) behind `D.host.conn` (`connect(opts) -> {send, onMessage, onError, onClose, close}`) in the Electron adapter. Protocol logic and the handshake stay in `cn.js`. Keep TLS keyed off `subtype === 'ssl'`. Done when Electron connects to Dyalog 20 and runs `⍳10` through the new seam. The Tauri side is [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md).

Follow the interface in [Design the host adapter interface](007-design-host-adapter.md#resolution). Implement the area in **both** `src/host/electron.js` and `src/host/tauri.js`. Smoke-check in both shells.

**Desktop-flag sites handed over by [Introduce the host adapter skeleton and desktop flag](012-host-adapter-skeleton.md#resolution).** Each of these still tests `D.el` because its block calls Electron. Move it onto `D.host` and flip the test to `D.desktop` (or drop it):

- `init.js`: the Tauri placeholder (`#host_pending`) in the main-window branch. Replace it with the Connect page, and load `cn.js` as a script in both shells instead of ``nodeRequire(`${__dirname}/src/cn`)``. **Also done when** the Tauri build shows the Connect page (connecting from it is [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md)).
- `km.js:264` (LOG) also `nodeRequire`s `cn`.
- `cn.js`: every `D.el`/`D.elw`/`nodeRequire` use.
