// RIDE's version, computed as `mk` computes it: "x.y.z", where z counts the commits
// since the start of the project. `about` is what About shows (_/version.js);
// `exe` is the Windows file/product version, which Dyalog builds take from APPVERSION.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sh = (x) => execSync(x, { cwd: root, encoding: 'utf8' }).trim();
const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const about = `${pj.version.replace(/\.0$/, '')}.${sh('git rev-list --count HEAD')}`;
const exe = /^dyalog/.test(pj.name) && process.env.APPVERSION ? process.env.APPVERSION : about;

module.exports = {
  about,
  exe,
  date: () => sh('git show -s HEAD --pretty=format:%ci'),
  rev: () => sh('git rev-parse HEAD'),
};
