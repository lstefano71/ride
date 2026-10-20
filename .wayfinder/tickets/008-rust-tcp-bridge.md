---
title: Bridge the RIDE TCP connection through Rust
type: wayfinder:task
status: open
assignee:
blocked_by: ["006", "007"]
---

## Question

Implement the connection part of the host adapter in the Tauri shell: Rust opens the TCP socket, handles RIDE message framing (4-byte big-endian length + `RIDE` magic + payload), and passes whole messages to and from JS; all protocol logic stays in `cn.js`. Done when the Tauri build connects to Dyalog 20, completes the handshake, and the session executes `⍳10`.
