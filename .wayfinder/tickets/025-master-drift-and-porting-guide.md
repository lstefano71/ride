---
title: Assess drift from master and write the porting procedure
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

One goal of `tauri-port` is to keep taking non-revolutionary changes from `master` over time. Is that still realistic, and how should it be done?

- Measure the drift: `master` hasn't moved since the branch point (`307003ef` Bump master to v4.8), so measure the *conflict surface* instead. That means which shared files the port rewrote and how heavily (`cn.js`, `init.js`, `ipc.js`, `km.js`, `util.js`, `main.js`, ...). Test it by replaying a sample of real historical `master` commits (for example the 4.7→4.8 range) onto `tauri-port` and recording which apply cleanly, which conflict, and why.
- Classify the kinds of upstream change by porting cost: frontend-only, touches Electron/Node APIs (must be re-expressed on `D.host`), and `main.js`/packaging.
- Write the procedure (merge vs cherry-pick, conflict hotspots, how to translate a `D.el`/`node.require` call into `D.host`, what to re-verify: the CDP smoke scripts in both shells), checked into the repo.

Done when the drift verdict and the porting guide are in the repo, backed by the replay results.
