---
title: Implement TLS connect in the Rust connection bridge
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["008"]
---

## Question

Extend the Rust connection bridge with TLS, following the "Research TLS connections in Rust for RIDE" resolution: `rustls` 0.23 + `tokio-rustls` + `ring`, a custom verifier (chain against `rootcertsdir`, no hostname check, optional subject CN == host), PEM client certificate and key, plus the two Dyalog workarounds (extra signature algorithm for the bundled test CA; exact-match accept for a self-signed leaf in the root-certs folder). Key the TLS path off `subtype === 'ssl'` rather than the dead `x.ssl` flag. Done when the Tauri build connects to Dyalog 20 serving RIDE over TLS and a wrong CN produces RIDE's own error.


**Context from [Bridge the RIDE TCP connection through Rust](008-rust-tcp-bridge.md#resolution):** hook TLS into `open()` in `src-tauri/src/conn.rs`. It returns a `TcpStream`, and `conn_connect` uses `into_split`, so TLS needs a generic stream (`tokio::io::split`). In `src/host/tauri.js`, remove the `o.ssl` → `ENOTSUP` rejection and pass `ssl`/`cert`/`key`/`subj`/`rootcertsdir` to `conn_connect`. Report `ECERTNAME` through the existing `ConnError`.


## Resolution

**Done. Under Tauri, a "via TLS/SSL" connection runs through rustls in Rust. The release build connects to Dyalog 20 serving RIDE over TLS (`Secure=Secure`, Dyalog's TestCertificates), runs `⍳10`, and passes the smoke 6/7 over TLS (floating is still pending). A wrong CN shows RIDE's own `Wrong server certificate name. Expected:"127.0.0.1", actual:"localhost"`.**

### How it's built

- **`src-tauri/src/tls.rs`** (new): `rustls` 0.23 + `tokio-rustls` 0.26 on `ring` (no `aws-lc-rs`), `x509-parser` for the CN, `webpki-roots` (Mozilla's list, as Node used) when no `rootcertsdir` is given, and `serde_json` to format the CN message the way `JSON.stringify` does (`actual:undefined` for a certificate with no CN). New direct dependencies only; no upgrades.
  - `RideVerifier` wraps `WebPkiServerVerifier`: it ignores SAN/hostname mismatches, checks that the first subject CN equals the host when `subj` is set, and accepts a leaf that is byte-identical to a certificate in `rootcertsdir` and currently valid (a self-signed server certificate in the roots folder, which Node accepted).
  - Dyalog's malformed test CA (rsaEncryption without NULL, negative modulus) is handled by three extra chain-signature algorithms (RSA PKCS#1 SHA-256/384/512) added to a once-built provider. Handshake signatures are unchanged.
  - Files are read before connecting, as the Electron shell does: every file in `rootcertsdir` is read as PEM, and files with no certificates add nothing. Client cert and key are PEM; PKCS#1 with Dyalog's `certtool` preamble works. A missing file gives `ENOENT: cannot read "<path>": …`. A folder with no certificates or a file with no cert/key gives an `EINVAL` message naming the file.
- **`conn.rs`**: the connection is now a boxed `AsyncRead + AsyncWrite` stream split with `tokio::io::split`, so framing, send order, reset and abort are shared by TCP and TLS. `conn_connect` takes an optional `tls` object. The handshake is inside the abortable `select!`, so Cancel works during it.
- **Errors** (all through the existing `ConnError`):
  - Wrong CN → `ECERTNAME` with RIDE's exact message.
  - Other rustls failures → `EPROTO` "TLS handshake failed: invalid peer certificate: UnknownIssuer" (or similar).
  - A plain interpreter on the port either resets or sends a Ride frame. `cn.js` hides resets, so both cases become `EPROTO` "TLS handshake failed. Check that the interpreter serves Ride over TLS."
  - The TLS interpreter drops a client it won't serve without a `close_notify`, whether it is busy or wants a client certificate, and the two can't be told apart. An unclean end before the first message therefore becomes "Connection rejected": "Either it is already serving another Ride client, or it requires a client certificate it trusts." A missing `close_notify` after that counts as a normal close, as Node treats it. Killing the interpreter ends the session with no dialog, the same as plain TCP.
- **`src/host/tauri.js`**: the `ENOTSUP` rejection is gone. It passes `tls: {cert, key, rootcertsdir, subj}` when `o.ssl` is set. `cn.js` already keys `ssl` off `subtype === 'ssl'`, so it needed no change.
- `cargo fmt` now formats the crate with default rustfmt settings (user's call), which reflowed `conn.rs` and `build.rs`.

### Verification

- `cargo clippy` and `cargo fmt --check` are clean. `npm run tauri:build` passes and `ride.exe` is **8.12 MB** (was 7.11; rustls, ring, webpki-roots and x509-parser).
- ESLint on `src/host/tauri.js`: 0 problems.
- Driven over CDP from the Connect page (subtype "via TLS/SSL", fields filled as a user would, Go clicked) against Dyalog 20 with `RIDE_INIT=SERVE::4599,CONFIG:ride.ini` (`Secure=Secure`, `SSLValidation=0`, Dyalog test server cert, CA `TestCertificates/ca`):

| Case | Result |
|---|---|
| John Doe client cert, CA dir, subj on, `localhost` | connects, `⍳10` OK; smoke 6/7 (only floating fails) on three fresh connections. On the very first run the tracer check missed once and never recurred. |
| host `127.0.0.1`, subj on | `Wrong server certificate name. Expected:"127.0.0.1", actual:"localhost"` |
| host `127.0.0.1`, subj off | connects (SAN mismatch ignored, chain still checked) |
| no client cert | "Connection rejected" hint |
| busy interpreter (another TLS client attached) | same "Connection rejected" hint |
| no `rootcertsdir` | `TLS handshake failed: invalid peer certificate: UnknownIssuer` |
| roots folder without the CA | same UnknownIssuer |
| missing cert file | `ENOENT: cannot read "…/nope.pem": …` |
| TLS to a plain interpreter (4602) | "Check that the interpreter serves Ride over TLS." |
| self-signed `ssl/cert.pem` server, that cert as the only root, subj off | connects, `⍳10` OK |
| same with subj on (cert has no CN) | `…Expected:"localhost", actual:undefined` |
| same server, test CA as roots | `invalid peer certificate: Other(OtherError(CaUsedAsEndEntity))` (correctly rejected) |
| interpreter killed mid-session | session ends, no dialog |
| plain TCP to 4602 (regression) | first message `SupportedProtocols=2` |

### Found along the way (not this ticket)

- The Connect page's `…` browse buttons for cert, key and root folder do nothing under Tauri (`browse` returns early without `D.el`); the paths have to be typed. This is already listed on [Make dialogs async on D.host.dlg](015-host-dialogs.md).
- Deliberate differences from Electron: TLS now actually happens for "via TLS/SSL" (Electron's `x.ssl` bug was fixed in the cn.js ticket); rejections and plain-server mismatches show a message where Node's reset was silent; rustls supports only TLS 1.2/1.3 (Node's default minimum is 1.2 too). Linux/macOS TLS isn't tested yet; it goes with packaging.
