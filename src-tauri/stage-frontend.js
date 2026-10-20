#!/usr/bin/env node
// Copies the frontend into _/tauri-frontend, the directory Tauri embeds (build.frontendDist).
// The file set mirrors the Electron packager filter in `mk`, minus Electron-only files
// and with node_modules cut down to what the HTML pages load. Tauri refuses a frontendDist
// containing node_modules, so those files are staged under vendor/ and index.html is
// rewritten to match.
//
// With --watch (tauri dev's beforeDevCommand) it stages nothing up front: tauri-cli.js
// has already staged, since Tauri starts the app without waiting for this command. It
// keeps running instead: a changed source file is recopied, and a changed .less file is
// recompiled. Tauri's dev server serves the staged copy from disk, so a reload shows it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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
  if (rel === 'index.html') {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    fs.writeFileSync(dst, html.replace(/node_modules\//g, 'vendor/'));
  } else {
    fs.copyFileSync(path.join(root, rel), dst);
  }
};
const isStyleCss = (rel) => /^style\/[^/]+\.css$/.test(rel);
const isStaged = (rel) => files.includes(rel) || isStyleCss(rel)
  || dirs.some((d) => rel.startsWith(`${d}/`));
const log = (msg) => console.info(msg); // eslint-disable-line no-console

const stage = () => {
  fs.rmSync(out, { recursive: true, force: true });
  files.forEach(copy);
  dirs.forEach((d) => fs.cpSync(path.join(root, d), dest(d), { recursive: true }));
  fs.readdirSync(path.join(root, 'style'))
    .filter((f) => f.endsWith('.css'))
    .forEach((f) => copy(`style/${f}`));

  // Same shape as the version.js `mk` generates.
  const v = version.about;
  const vi = { versionInfo: { version: v, date: version.date(), rev: version.rev() } };
  fs.mkdirSync(path.join(out, '_'), { recursive: true });
  fs.writeFileSync(path.join(out, '_', 'version.js'), `D=${JSON.stringify(vi)}`);
  log(`staged frontend v${v} in ${path.relative(root, out)}`);
};

// Same as `npm run css`; grunt writes style/*.css, which the watcher then restages.
const less = () => {
  const grunt = require.resolve('grunt/bin/grunt');
  const r = spawnSync(process.execPath, [grunt, 'less'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) log('stage-frontend: grunt less failed');
};

const restage = (rel) => {
  try {
    if (fs.existsSync(path.join(root, rel))) {
      if (fs.statSync(path.join(root, rel)).isFile()) copy(rel);
    } else {
      fs.rmSync(dest(rel), { recursive: true, force: true });
    }
    log(`restaged ${rel}`);
  } catch (e) {
    log(`stage-frontend: ${rel}: ${e.message}`);
  }
};

const watch = () => {
  // fs.watch fires several times per save; act once things settle.
  const timers = new Map();
  const later = (key, fn) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, 100));
  };
  const onChange = (rel) => {
    if (/^style\/.*\.less$/.test(rel)) later('less', less);
    else if (isStaged(rel)) later(rel, () => restage(rel));
  };
  const watchDir = (d, recursive) => fs.watch(path.join(root, d), { recursive }, (_, f) => {
    if (f) onChange(path.posix.join(d, f.replace(/\\/g, '/')).replace(/^\.\//, ''));
  });
  watchDir('.', false);
  ['src', 'lib', 'style'].forEach((d) => watchDir(d, true));
  log('stage-frontend: watching for changes');
};

if (process.argv.includes('--watch')) {
  if (!fs.existsSync(out)) { less(); stage(); }
  watch();
} else {
  stage();
}
