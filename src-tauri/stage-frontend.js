#!/usr/bin/env node
// Copies the frontend into _/tauri-frontend, the directory Tauri embeds (build.frontendDist).
// The file set mirrors the Electron packager filter in `mk`, minus Electron-only files
// and with node_modules cut down to what the HTML pages load. Tauri refuses a frontendDist
// containing node_modules, so those files are staged under vendor/ and index.html is
// rewritten to match.
const fs = require('fs');
const path = require('path');
const version = require('./version');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '_', 'tauri-frontend');

const files = [
  'index.html', 'about.html', 'dialog.html', 'empty.html', 'status.html', 'log.html', 'html3500.html',
  'D.png', 'favicon.ico', 'favicon.png',
  'node_modules/jquery/dist/jquery.min.js',
  'node_modules/toastr/build/toastr.min.js',
  'node_modules/toastr/build/toastr.min.css',
];
const dirs = [
  'src', 'lib', 'style/fonts', 'style/img',
  'node_modules/monaco-editor/min',
];

const dest = (rel) => path.join(out, rel.replace(/^node_modules\//, 'vendor/'));
const copy = (rel) => {
  const dst = dest(rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dst);
};

fs.rmSync(out, { recursive: true, force: true });
files.forEach(copy);
dirs.forEach((d) => fs.cpSync(path.join(root, d), dest(d), { recursive: true }));
const index = path.join(out, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/node_modules\//g, 'vendor/'));
fs.readdirSync(path.join(root, 'style'))
  .filter((f) => f.endsWith('.css'))
  .forEach((f) => copy(`style/${f}`));

// Same shape as the version.js `mk` generates.
const v = version.about;
const vi = { versionInfo: { version: v, date: version.date(), rev: version.rev() } };
fs.mkdirSync(path.join(out, '_'), { recursive: true });
fs.writeFileSync(path.join(out, '_', 'version.js'), `D=${JSON.stringify(vi)}`);

// eslint-disable-next-line no-console
console.info(`staged frontend v${v} in ${path.relative(root, out)}`);
