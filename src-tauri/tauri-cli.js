#!/usr/bin/env node
// Runs the Tauri CLI with the computed RIDE version (and mk's copyright year) merged into
// tauri.conf.json, so the exe's Windows version resource matches About and the Electron
// build (package.json alone would give x.y.0).
const { spawnSync } = require('child_process');
const version = require('./version');

const config = {
  version: version.exe,
  bundle: { copyright: `(c) 2014-${new Date().getFullYear()} Dyalog Ltd` },
};
const cli = require.resolve('@tauri-apps/cli/tauri.js');
const args = [cli, ...process.argv.slice(2), '--config', JSON.stringify(config)];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
