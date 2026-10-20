---
title: Run the Electron RIDE against Dyalog 20 as a baseline
type: wayfinder:task
status: open
assignee:
blocked_by: []
---

## Question

Can the current Electron build be installed, built and connected to the local Dyalog 20 (`d:\devel\dyalog\20.0\dyalog.exe`) over TCP? Record the exact commands: `npm install`, the Grunt/LESS build, starting RIDE, starting the interpreter in serve mode (e.g. `RIDE_INIT=SERVE:*:4502`), and connecting. Note anything broken on `master` today. This is the reference behaviour every later smoke check compares against.
