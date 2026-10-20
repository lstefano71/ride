---
title: Research TLS connections in Rust for RIDE
type: wayfinder:research
status: closed
assignee: copilot
blocked_by: []
---

## Question

How does RIDE's TLS connect work today (`src/cn.js` around the `tls` branch: client `cert`, `rootcertsdir` CA bundle, custom `checkServerIdentity` comparing subject CN), how does a Dyalog interpreter serve RIDE over TLS (`RIDE_INIT=SERVE:...` with certificates; see `ssl/readme`), and what Rust stack (`rustls` / `tokio-rustls` / `native-tls`) reproduces it, including the CN-only identity check? Estimate effort and any blockers.

## Resolution

Feasible, about 2–4 dev-days, verified against a live Dyalog 20 TLS server. Stack: `rustls` 0.23 + `tokio-rustls` + `ring`, with a custom `ServerCertVerifier` that validates the chain against `rootcertsdir`, skips the hostname check, and optionally requires subject CN == host. PEM client certificates and keys load directly. Both TLS 1.3 and 1.2 work. Two Dyalog quirks have tested workarounds: the bundled test CA is badly encoded (add an extra signature algorithm, about 40 lines), and a self-signed leaf listed in the root-certs folder needs an exact-match accept (about 5 lines). `native-tls` was rejected (differs per OS; can't load Dyalog's key format). Surprise: today's TLS branch is unreachable from the UI. `cn.js` checks `x.ssl`, unset since a 2017 refactor, so "TLS/SSL" connects over plain TCP; the port should key off `subtype === 'ssl'`. `Secure=Secure` rejects clients without certificates.

Findings: `.wayfinder/research/tls-connect.md` on branch `research/tls-connect` (commit `602003eb`); probe sources in the session `files/tlsprobe` folder.
