---
title: Build the Windows Electron and Tauri zips in GitHub Actions and release them
type: wayfinder:task
status: open
assignee:
blocked_by: [023]
---

## Question

Carry out [Decide how CI builds and releases the Tauri RIDE from the fork](023-decide-ci-for-tauri.md). Add a GitHub Actions workflow on `tauri-port` (`lstefano71/ride`) with one `windows-latest` job:

- builds `ride-electron-4.8.<count>-win-ia32.zip` (`npm run build w` folder, exe renamed `Ride.exe`) and `ride-tauri-4.8.<count>-win-x64.zip` (exactly `ride.exe` + `ride.pdb`);
- uploads both as artifacts on every push; on a `tauri-v4.8.<count>` tag or a release-requesting dispatch, creates a full GitHub release with the optional intro + first-parent commit list since the previous `tauri-v*` tag (or `307003ef`);
- puts npm/cargo/Electron caches on D: and uses rust-cache, the npm cache and an Electron download cache;
- sets `debug = "line-tables-only"` in `[profile.release]` if the exe stays about 9 MB.

Done when a run on `lstefano71/ride` produces a release with both zips with exactly the contents above. The downloaded Tauri exe must pass smoke 7/7 against Dyalog 20, and the Electron one must render properly (styles present) and connect. Cold and warm run times are recorded.
