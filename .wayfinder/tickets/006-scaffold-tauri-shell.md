---
title: Scaffold a Tauri v2 shell that loads the existing frontend
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: ["002"]
---

## Question

Add a `src-tauri/` Tauri v2 project that opens the existing `index.html` frontend (built styles included) without Electron, with no Node in the webview. The frontend need not connect yet; success is the UI shell rendering and failing gracefully where `D.el` is absent. Record the dev and build commands, the Windows release exe size, and how the frontend assets are bundled.

## Resolution

**Done: `src-tauri/` is a Tauri v2 shell that renders the existing frontend with no Node in the webview.** The release build is a **7.02 MB** `ride.exe` on Windows, well under the 20 MB goal, with all frontend assets embedded. Frontend source files are untouched, and Electron still runs from the same tree.

### What was added

- `src-tauri/`: the `ride` crate (lib `ride_lib`). `lib.rs` is only `tauri::Builder::default().run(...)`: no commands and no plugins yet. Release profile uses `opt-level="s"`, `lto`, `codegen-units=1`, `panic="abort"`, `strip`.
- `tauri.conf.json`: identifier `com.dyalog.ride`, `mainBinaryName: "ride"`, version read from `../package.json`, a single `main` window at 800×600 with the Electron background colour. `withGlobalTauri: true` exposes `window.__TAURI__`, so the bundler-less frontend can reach the Tauri API without `@tauri-apps/api`. `csp: null` because `index.html` sets its own CSP meta tag. `bundle.active: false`, so no installers yet (packaging is still fog).
- Icons were generated from `D.svg` with `tauri icon`. The mobile and Store sizes were dropped.
- `@tauri-apps/cli@^2` (2.12.3) is a devDependency. The `package-lock.json` diff only adds the CLI packages and syncs the lock's stale `ride47`/`4.7.0` name and version to `package.json`.
- npm scripts: `tauri`, `tauri:stage`, `tauri:dev`, `tauri:build`.

### How frontend assets are bundled

`src-tauri/stage-frontend.js` (run by `beforeDevCommand`/`beforeBuildCommand` through `npm run tauri:stage`, after `npm run css`) copies the frontend into `_/tauri-frontend` (gitignored through `_/`), which is `build.frontendDist`.

- The file set mirrors `mk`'s Electron packager filter: root `*.html`, `D.png`, favicons, `src/`, `lib/`, `style/*.css`, `style/fonts`, `style/img`, and `_/version.js` (generated with the same shape as `mk`'s).
- `node_modules` is cut down to what pages actually load: jQuery `dist/jquery.min.js`, toastr `build/`, and `monaco-editor/min`.
- **Tauri refuses a `frontendDist` containing `node_modules`**, so those files are staged under `vendor/` and the staged `index.html` has `node_modules/` rewritten to `vendor/`. No other page or script references `node_modules/`.
- The staged size is 15.4 MB. Tauri embeds it brotli-compressed, which is how the exe stays at 7 MB.

### Commands

```powershell
npm install                 # adds @tauri-apps/cli; see the baseline ticket for the Electron install workaround
npm run tauri:dev           # stages, builds debug (about 2.5 min cold), serves _/tauri-frontend at http://127.0.0.1:1430
npm run tauri:build         # stages, builds release (about 4.7 min cold) -> src-tauri\target\release\ride.exe
# CDP for scripted checks, as with smoke-cdp.js:
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; src-tauri\target\release\ride.exe
```

In dev, Tauri watches only `src-tauri/`. After editing `src/`, `style/` or the HTML, run `npm run tauri:stage` and reload the window. Making that smoother belongs to the "Build integration" fog.

### Verification

- `tauri build` (which runs `cargo build --release`) passes. `npx eslint src-tauri/stage-frontend.js` is clean.
- A CDP probe against both the release exe (`http://tauri.localhost/`) and dev (`http://127.0.0.1:1430/`) found:
  - `window.__TAURI__` present, `D.el` and `nodeRequire` undefined;
  - Monaco loaded, splash hidden, `D.ide` created with the session window `0`, and `D.versionInfo.version` = `4.8.4300`.
  - Screenshot: HTML menu bar (Edit/View/Window/Action/Threads/Help), language bar, an empty session with a cursor, and the status bar.
- **How it fails without `D.el`:** `init.js` takes its browser-mode branch and opens `new WebSocket(ws://<location.host>)`. In the release build that's `tauri.localhost` (connection refused). In dev it's the Tauri dev server (handshake 200). Both are logged as `ws error` and nothing else breaks. No other exceptions.

### Notes for later tickets

- With no Electron present, the frontend currently ends up in **browser mode**. [Design the host adapter interface](007-design-host-adapter.md) needs a Tauri branch so it lands on the Connect page instead. Detect it with `window.__TAURI__` (available because of `withGlobalTauri`).
- WebView2 CDP works with the same env var as the baseline ticket noted, so `smoke-cdp.js` can drive the Tauri shell once it connects.
- No dependency upgrades were needed (Monaco, jQuery, Grunt and LESS are unchanged).