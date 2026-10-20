---
title: Assess drift from master and write the porting procedure
type: wayfinder:task
status: closed
assignee: stf
blocked_by: []
---

## Question

One goal of `tauri-port` is to keep taking non-revolutionary changes from `master` over time. Is that still realistic, and how should it be done?

- Measure the drift: `master` hasn't moved since the branch point (`307003ef` Bump master to v4.8), so measure the *conflict surface* instead. That means which shared files the port rewrote and how heavily (`cn.js`, `init.js`, `ipc.js`, `km.js`, `util.js`, `main.js`, ...). Test it by replaying a sample of real historical `master` commits (for example the 4.7→4.8 range) onto `tauri-port` and recording which apply cleanly, which conflict, and why.
- Classify the kinds of upstream change by porting cost: frontend-only, touches Electron/Node APIs (must be re-expressed on `D.host`), and `main.js`/packaging.
- Write the procedure (merge vs cherry-pick, conflict hotspots, how to translate a `D.el`/`node.require` call into `D.host`, what to re-verify: the CDP smoke scripts in both shells), checked into the repo.

Done when the drift verdict and the porting guide are in the repo, backed by the replay results.

## Resolution

**Verdict: taking changes from `master` stays realistic.** The guide is [`docs/dev/porting-from-master.md`](../../docs/dev/porting-from-master.md).

- **Drift.** `master` hasn't moved since the branch point. The port rewrote 25 shared files: `cn.js`, `ipc.js` and `init.js` heavily, `main.js`, `km.js`, `util.js`, `ide.js`, `menu.js`, `prf*.js`, `abt.js` and `demo.js` moderately, and `se.js`/`ed.js` lightly.
- **Replay** ([drift-replay.py](../assets/drift-replay.py), [results](../assets/drift-replay.tsv), all done with `git merge-tree`, so the work tree is never touched):
  - Merging all of `origin/ride4.6` is clean on both branches.
  - Of the 7 unmerged cherry-picks (`ride4.6`, `issue1246`, `issue1319`), the same 3 are clean on both branches. The other 4 conflict on `master` too.
  - Of the 140 `master` commits from v4.5 to v4.8, 74 revert cleanly on `master` and 70 of those revert cleanly on the port. The 4 port-only conflicts are all Electron/Node call sites the port moved: paste `webPreferences`, About platform, AggregateError messages, and the Electron version lock file. Each fix already exists on the port in its new home.
- **Classes of upstream change:** frontend-only and CI/Jenkins changes merge unchanged. Electron/Node API changes are re-expressed on `D.host`, with a translation table in the guide. Dependency changes need the lock file regenerated, and a new frontend dependency must be added to `stage-frontend.js`.
- **Procedure:** preview with `git merge-tree`, then `git merge --no-ff origin/master` (no rebase, since the branch is published and releases are tagged from it). Use `cherry-pick -x` for maintenance-branch fixes. Grep for any Node that reappeared, then re-verify: eslint on touched files, `tauri:build`, smoke 7/7 in both shells, and the area CDP scripts.
- **CI:** `tauri-port.yml` now has `paths-ignore` (`**.md`, `docs/**`, `mkdocs.yml`, `.wayfinder/**`), so docs-only pushes don't build the zips. GitHub doesn't evaluate path filters for tag pushes, so `tauri-v*` releases still build.
- `docs/dev/` sits under the mkdocs `docs_dir`, as `docs/adr/` already does. It isn't in `nav`.
