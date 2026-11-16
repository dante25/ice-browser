#!/usr/bin/env python3
"""Ice Android: the state of single Chromium source files as the build sees them, to write and check Ice patches without the
whole source tree (about 100 GB).

A file goes through the same steps as in ungoogled-chromium-android's build.sh, in the same order:
  Chromium tag -> ungoogled-chromium patches -> domain substitution -> ungoogled-chromium-android patches -> 2nd domain substitution
and then (verify) the Ice patches.

usage:
  srcprep.py prep  OUTDIR  path/in/src [...]       files after all upstream steps
  srcprep.py check PATCH [PATCH ...]               apply the Ice patches (in order) to such files; exit 1 on any failure

Inputs (env, defaults are the session checkouts):
  ICE_CHR  git repo with Chromium at the tag in FETCH_HEAD (a blob-less clone is enough: files are fetched one by one)
  ICE_UGC  ungoogled-chromium at the matching tag      ICE_UCA  ungoogled-chromium-android at the matching tag
"""
import os, re, subprocess, sys, tempfile, shutil

CHR = os.environ.get('ICE_CHR', '/tmp/chr')
UGC = os.environ.get('ICE_UGC', '/tmp/ugc-main')
UCA = os.environ.get('ICE_UCA', '/tmp/uca')

def series(root):
    out = []
    for l in open(os.path.join(root, 'patches', 'series')):
        l = l.strip()
        if l and not l.startswith('#'): out.append(os.path.join(root, 'patches', l))
    return out

_split_cache = {}
def sections(patch):
    """{path: text of the hunks of that file} for one patch file"""
    if patch in _split_cache: return _split_cache[patch]
    lines = open(patch, encoding='utf-8', errors='surrogateescape').read().split('\n')
    res, cur, cur_path = {}, None, None
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.startswith('--- ') and i + 1 < len(lines) and lines[i + 1].startswith('+++ '):
            if cur_path: res[cur_path] = res.get(cur_path, '') + '\n'.join(cur) + '\n'
            new = lines[i + 1][4:].split('\t')[0].strip()
            old = l[4:].split('\t')[0].strip()
            p = new if new != '/dev/null' else old
            cur_path = re.sub(r'^[ab]/', '', p); cur = [l, lines[i + 1]]; i += 2; continue
        if cur is not None:
            if l.startswith('diff --git ') or (l.startswith('From ') and ' ' in l[5:]):
                res[cur_path] = res.get(cur_path, '') + '\n'.join(cur) + '\n'; cur = None; cur_path = None
            else: cur.append(l)
        i += 1
    if cur_path: res[cur_path] = res.get(cur_path, '') + '\n'.join(cur) + '\n'
    _split_cache[patch] = res
    return res

def domain_list(name):
    return set(l.strip() for l in open(os.path.join(UGC if name == 'domain_substitution.list' else UCA, name)) if l.strip())

_regex = None
def regexes():
    global _regex
    if _regex is None:
        _regex = []
        for l in open(os.path.join(UGC, 'domain_regex.list')):
            l = l.rstrip('\n')
            if not l: continue
            pat, rep = l.split('#', 1)
            _regex.append((re.compile(pat), rep))
    return _regex

def substitute(path_in_tree, rel):
    with open(path_in_tree, 'rb') as f: raw = f.read()
    for enc in ('UTF-8', 'cp1252'):
        try: text = raw.decode(enc); break
        except UnicodeDecodeError: continue
    n = 0
    for rx, rep in regexes():
        text, k = rx.subn(rep, text); n += k
    if n:
        with open(path_in_tree, 'wb') as f: f.write(text.encode(enc))

def apply_section(tree, text, label):
    with tempfile.NamedTemporaryFile('w', suffix='.patch', delete=False) as t: t.write(text); name = t.name
    r = subprocess.run(['patch', '-p1', '--batch', '--forward', '--no-backup-if-mismatch', '-d', tree, '-i', name], capture_output=True, text=True)
    os.unlink(name)
    if r.returncode != 0:
        raise SystemExit(f'FAILED: {label}\n{r.stdout}{r.stderr}')
    return r.stdout

def fetch(rel, dest):
    r = subprocess.run(['git', '-C', CHR, 'show', f'FETCH_HEAD:{rel}'], capture_output=True)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if r.returncode != 0: return False             # a file the upstream patches create
    open(dest, 'wb').write(r.stdout); return True

def prep(outdir, files):
    ugc, uca = series(UGC), series(UCA)
    sub1, sub2 = domain_list('domain_substitution.list'), domain_list('domain_sub_2.list')
    for rel in files:
        dest = os.path.join(outdir, rel)
        fetch(rel, dest)
        steps = []
        for p in ugc:
            s = sections(p).get(rel)
            if s: steps.append(('ugc ' + os.path.relpath(p, UGC), s))
        for label, s in steps: apply_section(outdir, s, f'{label} on {rel}')
        if rel in sub1 and os.path.exists(dest): substitute(dest, rel)
        steps = []
        for p in uca:
            s = sections(p).get(rel)
            if s: steps.append(('uca ' + os.path.relpath(p, UCA), s))
        for label, s in steps: apply_section(outdir, s, f'{label} on {rel}')
        if rel in sub2 and os.path.exists(dest): substitute(dest, rel)
        print(f'prepared {rel} ({len(steps)} android patch(es))' + ('' if os.path.exists(dest) else ' [does not exist]'))

def check(patches):
    files = []
    for p in patches:
        for rel in sections(p):
            if rel not in files: files.append(rel)
    tree = tempfile.mkdtemp(prefix='ice-check-')
    prep(tree, files)
    ok = True
    for p in patches:
        for rel, s in sections(p).items():
            try:
                out = apply_section(tree, s, f'{os.path.basename(p)} on {rel}')
                fuzz = 'fuzz' in out or 'offset' in out
                print(f'OK   {os.path.basename(p)}: {rel}' + ('  (' + out.strip().splitlines()[-1] + ')' if fuzz else ''))
            except SystemExit as e:
                print(e); ok = False
    print('tree:', tree)
    return ok

if __name__ == '__main__':
    if len(sys.argv) >= 4 and sys.argv[1] == 'prep': prep(sys.argv[2], sys.argv[3:])
    elif len(sys.argv) >= 3 and sys.argv[1] == 'check': sys.exit(0 if check(sys.argv[2:]) else 1)
    else: print(__doc__); sys.exit(2)
