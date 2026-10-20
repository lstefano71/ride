---
title: Build the Windows Electron and Tauri zips in GitHub Actions and release them
type: wayfinder:task
status: closed
assignee: copilot
blocked_by: [023]
---

## Question

Carry out [Decide how CI builds and releases the Tauri RIDE from the fork](023-decide-ci-for-tauri.md). Add a GitHub Actions workflow on `tauri-port` (`lstefano71/ride`) with one `windows-latest` job:

- builds `ride-electron-4.8.<count>-win-ia32.zip` (`npm run build w` folder, exe renamed `Ride.exe`) and `ride-tauri-4.8.<count>-win-x64.zip` (exactly `ride.exe` + `ride.pdb`);
- uploads both as artifacts on every push; on a `tauri-v4.8.<count>` tag or a release-requesting dispatch, creates a full GitHub release with the optional intro + first-parent commit list since the previous `tauri-v*` tag (or `307003ef`);
- puts npm/cargo/Electron caches on D: and uses rust-cache, the npm cache and an Electron download cache;
- sets `debug = "line-tables-only"` in `[profile.release]` if the exe stays about 9 MB.

Done when a run on `lstefano71/ride` produces a release with both zips with exactly the contents above. The downloaded Tauri exe must pass smoke 7/7 against Dyalog 20, and the Electron one must render properly (styles present) and connect. Cold and warm run times are recorded.

## Resolution

**`.github/workflows/tauri-port.yml` ("Windows zips") on `lstefano71/ride` builds both portable zips from `tauri-port`. Both downloaded builds pass smoke 7/7 against Dyalog 20.**

- **Workflow:** one `windows-latest` job running checkout (full history, for the commit count and tags), Node 22, stable Rust, `npm ci`, `npm run build w`, `npm run tauri:build`, then 7-Zip. Every push uploads two artifacts. A `tauri-v*` tag, or a dispatch with **release** ticked, runs `gh release create` for a full release. The tag must equal `tauri-v<version>`. The notes are the optional intro (dispatch input or annotated-tag message), then `Changes since <prev>:` and the first-parent log since the previous `tauri-v*` tag, or `307003ef` for the first release.
- **Zips** (4.8.4320):
  - `ride-electron-4.8.4320-win-ia32.zip` (115 MB): the packager folder's *contents* at the zip root, with the exe renamed to `Ride.exe`.
  - `ride-tauri-4.8.4320-win-x64.zip` (11 MB): exactly `ride.exe` (9,164,288 bytes) and `ride.pdb` (18.5 MB).
- **PDB:** `debug = "line-tables-only"` in `[profile.release]`. The exe grows by about 1 KB locally, and the PDB goes from 3.3 to 18 MB with line tables.
- **Caches:** `npm_config_cache`, `CARGO_HOME` and `electron_config_cache` move to `runner.temp` on D:. `rust-cache`, the setup-node npm cache and `actions/cache` handle the Electron downloads. `@electron/get` ignores `ELECTRON_CACHE`: `npm ci` reads `electron_config_cache`, and `mk`'s packager uses only `%LOCALAPPDATA%\electron\Cache`. Both paths are cached, and `mk` is untouched.
- **Times:**
  - Cold: about 11 min, including `npm ci` 1m32s, Tauri 5m40s, and a `-mx=9` zip of 2m22s.
  - After dropping `-mx=9`, the warm run took **5m35s**: `npm ci` 1m15s, Electron 9s, Tauri 2m37s, zip 21s.
- **Verified** from the warm run's downloaded artifacts against Dyalog 20 (`RIDE_CONNECT`):
  - Tauri `ride.exe`: smoke 7/7, file version 4.8.4320.
  - Electron `Ride.exe`: smoke 7/7. All stylesheets loaded (`ride-base.css`, `light-theme.css`, … 1,850 rules), and `D.versionInfo` is 4.8.4320.
- **Dispatch needs the default branch:** GitHub only shows **Run workflow** when the workflow file is on the repo's default branch, so `tauri-port` was made the fork's default. Tags work regardless.
- **Released:** a dispatch on `361cfaa9` (intro "First CI release") published the full release [`tauri-v4.8.4320`](https://github.com/lstefano71/ride/releases/tag/tauri-v4.8.4320). Its notes list the first-parent log since `307003ef`. The Tauri zip has exactly `ride.exe` (file version 4.8.4320) and `ride.pdb`. The Electron zip has `Ride.exe` and the compiled `style/*.css`. The release's own `ride.exe` passes smoke 7/7 against Dyalog 20.
- **Commits:** this resolution is a second commit, deliberately. Amending `361cfaa9` would leave the release tag off the branch, and `git describe` would then lose it as the base for the next release's notes.
- **Lessons:**
  - The first push failed to parse because of an unquoted trailing colon in a step name.
  - Pushing needs the user: this machine has no git credentials for the fork and no `gh`. Artifacts were fetched through the GitHub MCP signed URLs.
- **No dependency upgrades.**
