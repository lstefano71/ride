---
title: Bridge the RIDE TCP connection through Rust
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["006", "013"]
---

## Question

Implement `D.host.conn` in the Tauri shell (the message-level seam from [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md)): Rust opens the TCP socket, handles RIDE message framing (4-byte big-endian length + `RIDE` magic + payload), and passes whole messages to and from JS; all protocol logic stays in `cn.js`. Done when the Tauri build connects to Dyalog 20, completes the handshake, and the session executes `⍳10`.

**Contract to match** (built in [Move cn.js to a plain script on a message-level connection](013-cn-message-level-connection.md#resolution)): `connect(opts, {signal}) → Promise<conn>`, errors as `Error`s with `{name, code, message, hostname?}` using the codes `cn.js` understands (`ENOTFOUND`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`, `EPROTO`, `ECERTNAME`, `ABORT`), messages buffered until the first `onMessage`, and `onClose` on clean EOF only. Replace the `ENOTSUP` stub in `src/host/tauri.js`. Tauri doesn't read `RIDE_CONNECT` until the `D.host.sys` snapshot exists, so smoke this ticket by driving the Connect page over CDP (`J.cn.go.click()` with host/port set), or land the argv/env part of [Move process, env, file and misc calls onto D.host.sys and D.host.fs](018-host-sys-fs.md) first.


## Resolution

**Done. Under Tauri, `D.host.conn.connect` goes through Rust (`src-tauri/src/conn.rs`): Rust owns the socket and the framing, and JS gets whole messages. The Tauri release build connects to Dyalog 20 from the Connect page, completes the handshake, and `⍳10` → `1 2 3 4 5 6 7 8 9 10`.** TLS is still `ENOTSUP` and belongs to [Implement TLS connect in the Rust connection bridge](009-tls-connect-in-rust.md).

### How it's built

- **Rust** (tokio, which Tauri already ships; `serde` and `tokio` were added as direct dependencies): five commands, `conn_connect`, `conn_send`, `conn_close`, `conn_abort` and `conn_reset`. Connections live in a managed `Conns` map keyed by a random u32 that JS picks, and each entry records the owning webview label. `conn_connect` resolves the host and tries each address the way Node's `net.connect` does, then splits the socket into a read task and a write task. Each connection's events (`message` / `error` / `close`) go back on its own `tauri::ipc::Channel`, which keeps them in order.
- **Framing** is the same as in `host/electron.js`: 4-byte big-endian length (counting itself, read as `i32`) + `RIDE` + payload, decoded as lossy UTF-8. A frame of 8 bytes or fewer gives `EPROTO` and drops the socket.
- **Errors** follow the contract and arrive as real `Error`s: `ECONNREFUSED` ("connect ECONNREFUSED 127.0.0.1:1"), `ENOTFOUND` with `hostname`, and a dual-stack failure joins the messages and sets `name` to the code. Abort gives `ABORT`/`AbortError`. Other errors map from `io::ErrorKind` (`ECONNRESET`, `ETIMEDOUT`, `ECONNABORTED`, …).
- **Send order.** `cn.js` fires `send`s without awaiting them, and Tauri invokes can be reordered. The adapter batches sends behind the one in flight, and `conn_send` is a sync command, so the main thread queues them in arrival order.
- **Events held until listeners exist.** The channel can deliver an event before `conn_connect`'s reply, and an early `error`/`close` was lost because of it. The adapter holds channel events until a `setTimeout` after resolving, so the caller's `.then` has registered its listeners, as with Node sockets. Messages still also use the buffer-until-`onMessage` rule.
- **`close()`** half-closes, like `socket.end()`. `onClose` fires when the peer's EOF arrives.
- **Reload frees the interpreter.** On load, each page calls `conn_reset`, which ends every connection its webview label owns. Without this, a reloaded page left the interpreter "already serving another Ride client". When a read task ends, it removes its entry only if the entry's sender is its own, so a reused id after a reload is safe.

### Verification

- `cargo build` and `cargo clippy` are clean. `npm run tauri:build` passes and `ride.exe` is **7.11 MB** (was 7.02).
- ESLint on `src/host/tauri.js`: 0 problems.
- Tauri release exe against Dyalog 20 (`RIDE_INIT=SERVE:*:4602`), driven over CDP:
  - Connect page (host/port set, `J.cn.go.click()`) → connected with no `$.err`. `⍳10` runs. A 165 KB burst (`⍳20000` after `⍴⍕⍳100000`) arrives complete and in order, and non-ASCII output is intact.
  - [smoke-cdp.js](../assets/smoke-cdp.js), with its page filter changed to `tauri.localhost`: 6 of 7 pass (connect, `⍳5`, `+/⍳10`, docked editor, tracer, trace result). **Floating editor window** fails as expected; that's [Port floating windows to Tauri windows](011-floating-windows-tauri.md).
  - Adapter level: refused, unknown host, `localhost` dual-stack, `ssl` → `ENOTSUP`, and abort of a connect to a black-hole address (rejects in ~500 ms) all give the expected codes and messages.
  - Second client while one is connected → clean `close`. `cn.js` shows "Connection rejected". Under Node this was an RST, which `cn.js` ignores silently, so Tauri is slightly more informative.
  - Killing the interpreter → session dies with no dialog, as in Electron. Killing the RIDE process or reloading the page → a reconnect succeeds.
- No dependency upgrades.

### Found along the way (not this ticket)

- Reloading or closing the window while connected shows WebView2's native "Reload site?" prompt (RIDE's `onbeforeunload` sets `returnValue`). The prompt blocks the renderer and can't be reached over CDP or UI Automation. It belongs with window close/quit handling under the "Window bounds and layouts" fog and [Make dialogs async on D.host.dlg](015-host-dialogs.md). For CDP tests, set `window.onbeforeunload = null` before reloading.