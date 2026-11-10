#!/usr/bin/env python3
"""Builds a small source tree of chosen Chromium 156 files exactly as the Ice build sees them.

For each requested path (relative to src/): fetch the original from the GitHub mirror of
chromium 156.0.8078.79 (missing = new file), apply the hunks of every ungoogled-chromium and
portablelinux patch (series order) that touch it, then the Ice patches in core-build/patches
and core-build/patches-next sorted by file name, stopping BEFORE --upto (e.g. --upto ice-30).

Usage: base_tree.py OUTDIR [--upto ice-NN] path [path ...]
Needs core-build/.work/portablelinux (run: bash core-build/build.sh setup).
Write your patch as: diff -u --label a/P --label b/P OUTDIR/P EDITED/P
"""
import os, re, subprocess, sys, urllib.request

ICE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PL = os.path.join(ICE, 'core-build/.work/portablelinux')
RAW = 'https://raw.githubusercontent.com/chromium/chromium/156.0.8078.79/'

def split_patch(text):
    return [p for p in re.split(r'(?m)^(?=--- (?:a/|/dev/null))', text) if p.startswith('--- ')]

def target_of(part):
    m = re.search(r'(?m)^\+\+\+ b/(\S+)', part)
    return m.group(1) if m else None

def apply(outdir, part, label):
    r = subprocess.run(['patch', '-p1', '--forward', '--batch', '-s', '-d', outdir], input=part,
                       text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f'FAILED applying {label}:\n{r.stdout}{r.stderr}')

def main():
    args = sys.argv[1:]
    out = args.pop(0)
    upto = None
    if args and args[0] == '--upto':
        args.pop(0); upto = args.pop(0)
    want = set(args)
    os.makedirs(out, exist_ok=True)
    for p in want:
        dst = os.path.join(out, p); os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            with urllib.request.urlopen(RAW + p) as r: data = r.read()
            open(dst, 'wb').write(data)
        except Exception:
            pass  # new file (created by a patch)
    series = []
    for base in ('ungoogled-chromium/patches', 'patches'):
        d = os.path.join(PL, base)
        for line in open(os.path.join(d, 'series')):
            line = line.strip()
            if line and not line.startswith('#'): series.append(os.path.join(d, line))
    ice = []
    for d in ('core-build/patches', 'core-build/patches-next'):
        dd = os.path.join(ICE, d)
        if os.path.isdir(dd):
            ice += [os.path.join(dd, f) for f in os.listdir(dd) if f.startswith('ice-') and f.endswith('.patch')]
    ice.sort(key=os.path.basename)
    if upto: ice = [p for p in ice if os.path.basename(p) < upto]
    for pf in series + ice:
        for part in split_patch(open(pf, errors='replace').read()):
            if target_of(part) in want:
                apply(out, part, f'{os.path.basename(pf)} -> {target_of(part)}')
    for p in sorted(want):
        print(('ok    ' if os.path.exists(os.path.join(out, p)) else 'new   ') + p)

main()
