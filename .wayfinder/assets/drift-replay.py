#!/usr/bin/env python3
"""Replay upstream changes onto master and tauri-port without touching the work tree.

Run from the repo root: python .wayfinder/assets/drift-replay.py [range] > out.tsv

Two modes, both via `git merge-tree --write-tree` (git >= 2.38):
  fwd  - cherry-pick a commit C onto a target: base=C^, ours=target, theirs=C.
         Used for commits not yet on master (e.g. origin/ride4.6).
  rev  - revert a historical master commit C on a target: base=C, ours=target, theirs=C^.
         Proxy for "would a change to the same lines still apply after the port":
         if the port rewrote the lines C touched, the revert conflicts.
A commit only counts against the port if it is clean on master but conflicts on tauri-port.
"""
import subprocess, sys

MASTER = '307003ef'
PORT = 'tauri-port'
FWD_REFS = ['origin/ride4.6', 'origin/issue1246', 'origin/issue1319']
REV_RANGE = sys.argv[1] if len(sys.argv) > 1 else 'v4.5.4097..' + MASTER


def git(*a):
    return subprocess.run(['git', *a], capture_output=True, text=True, encoding='utf-8')


def files(c):
    return [f for f in git('diff-tree', '--no-commit-id', '--name-only', '-r', c).stdout.split('\n') if f]


def merge(base, ours, theirs):
    r = git('merge-tree', '--write-tree', '--name-only', '--no-messages', '--merge-base=' + base, ours, theirs)
    lines = r.stdout.strip().split('\n')
    return ('clean', []) if r.returncode == 0 else ('conflict', lines[1:])


def row(mode, c):
    subj = git('log', '-1', '--format=%s', c).stdout.strip()
    if mode == 'fwd':
        m, _ = merge(c + '^', MASTER, c)
        p, cf = merge(c + '^', PORT, c)
    else:
        m, _ = merge(c, MASTER, c + '^')
        p, cf = merge(c, PORT, c + '^')
    fs = files(c)
    print('\t'.join([mode, c[:8], m, p, ','.join(cf), ','.join(fs), subj[:70]]))
    sys.stdout.flush()


print('\t'.join(['mode', 'commit', 'master', 'port', 'port_conflicts', 'files', 'subject']))
for ref in FWD_REFS:
    for c in git('rev-list', '--no-merges', '--reverse', 'origin/master..' + ref).stdout.split():
        row('fwd', c)
for c in git('rev-list', '--no-merges', '--reverse', REV_RANGE).stdout.split():
    row('rev', c)
