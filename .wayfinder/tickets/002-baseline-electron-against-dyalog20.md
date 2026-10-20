---
title: Run the Electron RIDE against Dyalog 20 as a baseline
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: []
---

## Question

Can the current Electron build be installed, built and connected to the local Dyalog 20 (`d:\devel\dyalog\20.0\dyalog.exe`) over TCP? Record the exact commands: `npm install`, the Grunt/LESS build, starting RIDE, starting the interpreter in serve mode (e.g. `RIDE_INIT=SERVE:*:4502`), and connecting. Note anything broken on `master` today. This is the reference behaviour every later smoke check compares against.

## Resolution

**Yes: `master`'s Electron build installs, builds, connects to Dyalog 20 over TCP and passes a scripted smoke check.** Environment: Windows, Node 26.11.1, npm 12.2.0, Electron 35.7.5, Dyalog APL/W-64 20.0 Unicode.

### Commands (PowerShell, repo root)

```powershell
npm install
# npm 12 blocks install scripts, so Electron's binary isn't fetched. Running
# `node node_modules\electron\install.js` downloads to the cache, but its
# extract-zip step dies silently under Node 26. Extract by hand:
$zip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache\*\electron-v35.7.5-win32-x64.zip" | Select -First 1
Expand-Archive $zip node_modules\electron\dist -Force
[IO.File]::WriteAllText("$PWD\node_modules\electron\path.txt", 'electron.exe')
npm run css                                   # grunt less: "3 stylesheets created"

# interpreter in serve mode
$env:RIDE_INIT = 'SERVE:*:4502'; Start-Process d:\devel\dyalog\20.0\dyalog.exe

# RIDE, auto-connecting, with isolated prefs, protocol log and CDP for scripting
$env:RIDE_CONNECT = '127.0.0.1:4502'
$env:RIDE_PREFS   = "$env:TEMP\ride-baseline\prefs.json"
$env:RIDE_LOG     = "$env:TEMP\ride-baseline\proto.log"
node_modules\electron\dist\electron.exe . --remote-debugging-port=9222

# smoke check (separate shell)
$env:NODE_PATH = "$PWD\node_modules"; node .wayfinder\assets\smoke-cdp.js 9222
```

`npm install` also rewrites `package-lock.json` (npm 12 churn); revert it rather than commit.

### Smoke check: all pass

[smoke-cdp.js](../assets/smoke-cdp.js) drives the renderer over the Chrome DevTools Protocol:

| Check | Result |
|---|---|
| connected, title `CLEAR WS - Dyalog APL/W-64 20.0 Unicode` | pass |
| execute `⍳5` → `1 2 3 4 5` | pass |
| execute `+/⍳10` (⎕IO 0) → `45` | pass |
| `)ed` opens a docked editor | pass |
| trace (`exec(…,1)`) opens the tracer; StepInto + Continue completes with `8` | pass |
| floating mode: `)ed` opens a separate `index.html?type=editor&winId=…` window | pass |

No stderr output beyond the DevTools banner. Protocol handshake as logged: `SupportedProtocols=2`, `UsingProtocol=2`, `Identify {apiVersion:1, identity:1}`, `Connect`, `GetWindowLayout`, `GetSyntaxInformation`.

For the Tauri port the same script should work on Windows: WebView2 exposes CDP via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`. It reaches into `D.ide` / `D.prf`, which the port keeps.

### Broken or surprising on `master` today

- **Lint is not a usable gate.** There is no `npm run lint` script, CI (Jenkinsfile) never runs ESLint, and `npx eslint src main.js` reports 1813 problems (1776 errors) on `master`. The map's verification criterion was changed to "no new ESLint problems in touched files" (see the map's Notes).
- **Electron install on current Node/npm** needs the manual workaround above (blocked install scripts and a silent extract-zip failure under Node 26).
- **Hidden windows created at start-up.** Besides the main window, Electron creates `status.html` (Status Output), `dialog.html` (Task) and a Preferences `index.html?type=prf` window up front, kept hidden. Relevant to the auxiliary-window fog and the floating-window port.
- `npm test` (ava + spectron 19 against Electron 35) wasn't attempted; spectron is long unmaintained and is not a usable baseline.
