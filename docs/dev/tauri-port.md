# The Tauri port

The `tauri-port` branch runs RIDE in a [Tauri v2](https://v2.tauri.app) shell as well as the usual Electron shell. On Windows the Tauri build is a single portable `ride.exe` of about 9 MB, compared with Electron's 115 MB zip. This page explains how to build it and the ideas behind it. The detail lives in the documents it links to.

## Philosophy

- **Port, not rewrite.** The existing JS/jQuery/Monaco frontend is kept as-is. Only the Electron/Node layer is replaced. Dependencies (Monaco, jQuery, Grunt/LESS) aren't upgraded unless something forces it.
- **One frontend, two shells.** Electron and Tauri run the same frontend. It reaches the platform only through one async interface, `D.host`, with areas `conn`, `win`, `ipc`, `menu`, `dlg`, `store`, `sys` and `fs`. Each shell implements it: `src/host/electron.js` and `src/host/tauri.js`. `D.desktop` means "running in a desktop shell" (it used to be `D.el`). See [ADR 0001](../adr/0001-async-host-adapter.md) and the glossary in [`CONTEXT.md`](../../CONTEXT.md).
- **Thin Rust.** Rust (`src-tauri/src`) owns sockets, framing, TLS and a few OS calls (`conn.rs`, `tls.rs`, `store.rs`, `fs.rs`, `sys.rs`). RIDE protocol logic stays in JS.
- **Shared data folder.** Both shells read and write the same versioned folder (`Ride-4.8` under the OS config directory), with the same files. You can switch between shells without migrating anything. See [ADR 0002](../adr/0002-shared-versioned-data-folder.md).
- **Keep taking upstream.** `master` is merged into `tauri-port` regularly. See [Taking changes from master into tauri-port](porting-from-master.md).

Out of scope under Tauri: spawning an interpreter, listen mode, SSH connections, the APL IME installer, browser mode, `RIDE_EDITOR`, and a Tauri installer (the exe is portable). Those still work in the Electron shell where they did before. The full list, and how every decision was reached, is on the [wayfinder map](../../.wayfinder/map.md).

## Prerequisites

- [Node.js](https://nodejs.org) (CI uses 22) and `npm install`. `npm install` also brings in Electron and the Tauri CLI. On Node 26 / npm 12, Electron's binary isn't fetched automatically; see the workaround in the [baseline ticket](../../.wayfinder/tickets/002-baseline-electron-against-dyalog20.md).
- A [Rust toolchain](https://rustup.rs), 1.90 or newer (`rust-version` in `src-tauri/Cargo.toml`).
- Windows: the WebView2 runtime (part of Windows 10/11). macOS and Linux need [Tauri's system dependencies](https://v2.tauri.app/start/prerequisites/), but only Windows is built and tested so far.

## Building and running

| Command | What it does |
|---|---|
| `npm run tauri:stage` | Compiles the CSS, then copies the frontend into `_/tauri-frontend`, which Tauri embeds. `node_modules/` files are staged under `vendor/`, because Tauri refuses a frontend containing `node_modules`. |
| `npm run tauri:dev` | Stages, then runs a debug build. A watcher (`src-tauri/stage-frontend.js --watch`) recopies changed `src/`, `lib/`, `style/` and HTML files and recompiles `.less`. Reload from devtools to see edits; pages don't reload on their own. |
| `npm run tauri:build` | Stages and builds the release exe: `src-tauri\target\release\ride.exe`. No installer is built. |
| `npm start` / `npm run dev` | The Electron shell, as on `master`. |

Both Tauri commands go through `src-tauri/tauri-cli.js`, which injects the version into the exe. The version is `4.8.<commit count>`, the same as About and `mk` (`src-tauri/version.js`).

A new frontend file or dependency must be added to the `files`/`dirs` lists in `src-tauri/stage-frontend.js`, or the Tauri build won't ship it.

To connect, start Dyalog serving RIDE (for example `dyalog.exe RIDE_INIT=SERVE:*:4502`) and use the Connect page, or set `RIDE_CONNECT=127.0.0.1:4502` before launching. TLS connections work in both shells.

## Checking a change

There's no automated test suite for the port. Instead, scripts drive a running RIDE over the Chrome DevTools Protocol. Run them in **both** shells:

```powershell
# Electron
$env:RIDE_CONNECT='127.0.0.1:4502'; node_modules\electron\dist\electron.exe . --remote-debugging-port=9222
# Tauri
$env:RIDE_CONNECT='127.0.0.1:4502'; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; src-tauri\target\release\ride.exe
# then
node .wayfinder\assets\smoke-cdp.js 9222
```

[`smoke-cdp.js`](../../.wayfinder/assets/smoke-cdp.js) covers the session, an editor, the tracer and a floating window, and should report 7/7. Area-specific scripts (floating windows, aux windows, bounds, system calls, quit prompts) are listed under [Re-verification](porting-from-master.md#re-verification) in the porting guide, along with the lint and exe-size checks.

## CI and releases

The fork ([lstefano71/ride](https://github.com/lstefano71/ride)) builds with GitHub Actions in `.github/workflows/tauri-port.yml`; Dyalog's `Jenkinsfile` is untouched. Every push to `tauri-port` builds two Windows zips as artifacts: a portable Electron ia32 build and the Tauri x64 `ride.exe` with its `ride.pdb`. Pushing a `tauri-v*` tag, or running the workflow by hand with "release" ticked, publishes them as a [GitHub release](https://github.com/lstefano71/ride/releases). Pushes that only touch docs or `.wayfinder/` don't build.

Every zip gets a signed [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) linking it to the workflow run and commit that built it; check one with `gh attestation verify <zip> -R lstefano71/ride`. Releases also carry `SHA256SUMS.txt` (verify with `sha256sum -c SHA256SUMS.txt`, or compare against `Get-FileHash <zip>` on Windows), and the same hashes are listed in the release notes.