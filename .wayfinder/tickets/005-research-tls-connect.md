---
title: Research TLS connections in Rust for RIDE
type: wayfinder:research
status: open
assignee:
blocked_by: []
---

## Question

How does RIDE's TLS connect work today (`src/cn.js` around the `tls` branch: client `cert`, `rootcertsdir` CA bundle, custom `checkServerIdentity` comparing subject CN), how does a Dyalog interpreter serve RIDE over TLS (`RIDE_INIT=SERVE:...` with certificates; see `ssl/readme`), and what Rust stack (`rustls` / `tokio-rustls` / `native-tls`) reproduces it, including the CN-only identity check? Estimate effort and any blockers.
