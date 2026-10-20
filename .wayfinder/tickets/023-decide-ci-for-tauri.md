---
title: Decide how CI builds and releases the Tauri RIDE from the fork
type: wayfinder:grilling
status: closed
assignee: copilot
blocked_by: []
---

## Question

CI today is Dyalog's Jenkins (`Jenkinsfile`). It builds Electron for Linux, Windows (`ia32`, WiX setup), macOS x86 and ARM (signed and notarised), copies the installers to `/devt`, and `CI/GH-Release.sh` creates a draft release on `Dyalog/ride` for `master`/`rideX.Y` only. Every step uses Dyalog-only agents, credentials and the `/devt` mount.

The user wants CI to also build the Tauri Windows `ride.exe` and publish it as a separate zip (only `ride.exe` + `ride.pdb`) next to the existing artifacts in the GitHub release. For now this goes only to the `lstefano71` remote, from the `tauri-port` branch.

Decide:

- **Where it runs.** Dyalog's Jenkins can't publish to the fork, so is this GitHub Actions on `lstefano71/ride`, a change to `Jenkinsfile`, or both (Actions now, a Jenkins stage drafted for upstream later)?
- **What "the other targets" means on the fork.** Rebuild Electron Windows setup/macOS/Linux in Actions (no Dyalog signing/notarisation credentials, no WiX agent), or ship only the Tauri zip for now?
- **Trigger and release shape.** Push to `tauri-port` vs tag vs manual; draft vs prerelease; tag/version naming (`v4.8.<count>`) without colliding with upstream tags; what happens to old drafts.
- **PDB.** Release builds currently produce `ride.pdb`? Confirm the profile settings so it exists and matches the exe.

## Resolution

**GitHub Actions on `lstefano71/ride` builds two portable Windows zips, Electron and Tauri, from `tauri-port`. Dyalog's Jenkins is untouched.**

- **Why not Jenkins:** it runs on Dyalog-only agents, credentials and `/devt`, and `CI/GH-Release.sh` only releases `master`/`rideX.Y` to `Dyalog/ride`. `Jenkinsfile`, `CI/` and `mk` stay untouched so upstream merges stay clean. The workflow file lives only on `tauri-port`.
- **Scope cut:** no macOS (can't build it), no Linux (not wanted), no Windows setup.exe (RIDE is effectively portable). See Out of scope on the map.
- **One `windows-latest` job**, Node 22 (as Jenkins), stable Rust:
  - `ride-electron-4.8.<count>-win-ia32.zip`: the `npm run build w` output folder, with the exe renamed to `Ride.exe`. ia32 stays, as upstream ships it.
  - `ride-tauri-4.8.<count>-win-x64.zip`: exactly `ride.exe` + `ride.pdb`.
- **Release flow:** a push to `tauri-port` (or a dispatch) uploads both zips as workflow artifacts. A pushed tag `tauri-v4.8.<count>`, or a `workflow_dispatch` asking for a release, creates a **full** (not pre-) GitHub release. The `tauri-` prefix avoids colliding with upstream `v4.8.x` tags.
- **Release notes:** an optional intro (dispatch input or annotated tag message), then `Changes since <prev>:` with `git log <prev>..HEAD --first-parent --format='- %s (%h)'`. `<prev>` is the latest `tauri-v*` tag, or the branch point `307003ef` for the first release. With `--first-parent`, a merge from `master` shows as one line.
- **PDB:** add `debug = "line-tables-only"` to `[profile.release]` so the PDB gives usable stack traces, provided `ride.exe` stays about 9 MB. Today's PDB (3.3 MB) has public symbols only.
- **Speed** (per [the awakecoding article](https://awakecoding.com/posts/speeding-up-dotnet-builds-on-windows-nuget-cache/), which is about NuGet but applies the same way): move `npm_config_cache`, `CARGO_HOME` and `ELECTRON_CACHE` from C: to `$RUNNER_TEMP` on D:. Cache across runs with `Swatinem/rust-cache` (about 400 crates under LTO), the `setup-node` npm cache, and `actions/cache` for the Electron download. Measure cold and warm times.
- **The `distzip` branch:** left alone. Its "cubist" output came from running `node mk w` without `npm run css`, so the LESS styles were never compiled.
