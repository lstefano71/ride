---
title: Bridge the RIDE TCP connection through Rust
type: wayfinder:task
status: open
assignee:
blocked_by: ["006", "013"]
---

## Question

Implement `D.host.conn` in the Tauri shell (the message-level seam from [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md)): Rust opens the TCP socket, handles RIDE message framing (4-byte big-endian length + `RIDE` magic + payload), and passes whole messages to and from JS; all protocol logic stays in `cn.js`. Done when the Tauri build connects to Dyalog 20, completes the handshake, and the session executes `⍳10`.

**Contract to match** (built in [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)): `connect(opts, {signal}) → Promise<conn>`, errors as `Error`s with `{name, code, message, hostname?}` using the codes `cn.js` understands (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`, `EPROTO`, `ECERTNAME`, `ABORT`), messages buffered until the first `onMessage`, and `onClose` on clean EOF only. Replace the `ENOTSUP` stub in `src/host/tauri.js`. Tauri doesn't read `RIDE_CONNECT` until the `D.host.sys` snapshot exists, so smoke this ticket by driving the Connect page over CDP (`J.cn.go.click()` with host/port set), or land the argv/env part of [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md) first.
