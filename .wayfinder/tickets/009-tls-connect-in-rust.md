---
title: Implement TLS connect in the Rust connection bridge
type: wayfinder:task
status: open
assignee:
blocked_by: ["008"]
---

## Question

Extend the Rust connection bridge with TLS, following the "Research TLS connections in Rust for RIDE" resolution: `rustls` 0.23 + `tokio-rustls` + `ring`, a custom verifier (chain against `rootcertsdir`, no hostname check, optional subject CN == host), PEM client certificate and key, plus the two Dyalog workarounds (extra signature algorithm for the bundled test CA; exact-match accept for a self-signed leaf in the root-certs folder). Key the TLS path off `subtype === 'ssl'` rather than the dead `x.ssl` flag. Done when the Tauri build connects to Dyalog 20 serving RIDE over TLS and a wrong CN produces RIDE's own error.


**Context from [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md#resolution):** hook TLS into `open()` in `src-tauri/src/conn.rs`. It returns a `TcpStream`, and `conn_connect` uses `into_split`, so TLS needs a generic stream (`tokio::io::split`). In `src/host/tauri.js`, remove the `o.ssl` → `ENOTSUP` rejection and pass `ssl`/`cert`/`key`/`subj`/`rootcertsdir` to `conn_connect`. Report `ECERTNAME` through the existing `ConnError`.