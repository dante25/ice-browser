#!/usr/bin/env python3
"""Ice built-ins and add-ons for Android, from the same sources as the desktop .deb.

usage: gen-android-builtins.py <repo root> <out dir>   (out dir mirrors the Chromium src tree; build.sh copies it into src/)

Writes
  chrome/browser/extensions/ice_builtins_files.inc         SHA-256 list of the built-ins (core-build/gen-ice-builtins-files.py, as on the desktop)
  chrome/browser/extensions/ice_android_assets.inc         APK asset name -> path under <app data>/ice/ (ice-builtins/<dir>/..., dodaci/<dir>/...)
  chrome/browser/extensions/ice_android_assets_digest.inc  digest of all of it; the files are extracted again when it changes
  chrome/android/ice_assets/BUILD.gn + files/NNNNN          android_assets target, stored uncompressed (OpenApkAsset needs that)
Asset names are numbers so that no file name (spaces, _locales, non-ASCII) can be mangled or dropped by the APK tools;
the files themselves are copied byte for byte."""
import hashlib, importlib.util, json, os, shutil, subprocess, sys
sys.dont_write_bytecode = True

repo, out = sys.argv[1], sys.argv[2]
spec = importlib.util.spec_from_file_location('gen', os.path.join(repo, 'core-build/gen-ice-builtins-files.py'))
gen = importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
# Ice: no Tab Counter on Android (the browser has its own counter).
gen.BUILTINS.pop('chrome-tab-counter', None)
ext = os.path.join(out, 'chrome/browser/extensions'); os.makedirs(ext, exist_ok=True)

# Android versions of the built-ins: copies of the desktop sources (which stay unchanged) with the changes in
# mobile_patches.py (the YouTube built-ins must also work on m.youtube.com). Every change must match exactly
# once, so an update of an original fails here instead of silently shipping a broken extension. The
# SHA-256 list compiled into the browser is made from these copies.
import tempfile
stage = tempfile.mkdtemp(prefix='ice-android-builtins-')
for name, src in gen.BUILTINS.items():
    shutil.copytree(os.path.join(repo, src), os.path.join(stage, src))
# Add-ons are staged as well, so mobile_patches can change their Android copies too.
ADDONS = {'sn-downloader': 'own-extensions/Ultimate SN Downloader/extension',
          'video-sniffer': 'own-extensions/video-sniffer',
          'ice-shield': 'ice-features/ice-shield'}
for d in sorted(os.listdir(os.path.join(repo, 'dodaci'))):
    if os.path.isfile(os.path.join(repo, 'dodaci', d, 'manifest.json')):
        assert d not in ADDONS, 'duplicate add-on name ' + d
        ADDONS[d] = 'dodaci/' + d
# Android versions of add-ons that cannot work as on the desktop (android/overlay/addons/<name>):
# ice-uvoz reads other browsers through a desktop program (native messaging); on Android it imports files.
for d in sorted(os.listdir(os.path.join(repo, 'android/overlay/addons'))):
    assert d in ADDONS, 'android add-on without a desktop one: ' + d
    ADDONS[d] = 'android/overlay/addons/' + d
for name, src in ADDONS.items():
    shutil.copytree(os.path.join(repo, src), os.path.join(stage, src),
                    ignore=shutil.ignore_patterns('node_modules'))
spec2 = importlib.util.spec_from_file_location('mobile_patches', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile_patches.py'))
mp = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(mp)
for rel, changes in mp.PATCHES.items():
    f = os.path.join(stage, rel)
    text = open(f, encoding='utf-8').read()
    for change in changes:
        old, new = change[0], change[1]
        want = change[2] if len(change) > 2 else 1      # optional: how many times the original text occurs
        n = text.count(old)
        if n != want: sys.exit(f'mobile patch for {rel}: expected the original text {want}x, found {n}: {old[:80]!r}')
        text = text.replace(old, new)
    open(f, 'w', encoding='utf-8').write(text)
for rel, text in getattr(mp, 'FILES', {}).items():   # new files of the Android versions
    f = os.path.join(stage, rel)
    if os.path.exists(f): sys.exit(f'mobile file {rel} exists in the original')
    open(f, 'w', encoding='utf-8').write(text)
print(f'{sum(len(c) for c in mp.PATCHES.values())} mobile change(s) in {len(mp.PATCHES)} file(s), {len(getattr(mp, "FILES", {}))} new file(s)')
subprocess.run([sys.executable, '-I', os.path.join(repo, 'core-build/gen-ice-builtins-files.py'), stage,
                os.path.join(ext, 'ice_builtins_files.inc')], check=True)

entries = []   # (destination under <app data>/ice, source file)
def walk(kind, name, src, skip_top=(), base=repo):
    root = os.path.join(base, src)
    if not os.path.isfile(os.path.join(root, 'manifest.json')): sys.exit('missing manifest: ' + root)
    if kind == 'dodaci':   # unpacked extensions: Chromium refuses names starting with "_" except _locales
        bad = [os.path.join(dp, n) for dp, dns, fns in os.walk(root) for n in dns + fns if n.startswith('_') and n != '_locales']
        if bad: sys.exit('reserved "_" names in add-on ' + name + ': ' + ', '.join(bad))
    for dp, dns, fns in os.walk(root):
        if dp == root: dns[:] = [d for d in dns if d not in skip_top]
        dns.sort()
        for fn in sorted(fns):
            if dp == root and fn in skip_top: continue
            full = os.path.join(dp, fn)
            if os.path.islink(full): sys.exit('symlink not allowed: ' + full)
            entries.append((f'{kind}/{name}/' + os.path.relpath(full, root).replace(os.sep, '/'), full))
for name in sorted(gen.BUILTINS): walk('ice-builtins', name, gen.BUILTINS[name], base=stage)
for name in sorted(ADDONS): walk('dodaci', name, ADDONS[name], skip_top=('tests', 'README.md'), base=stage)

adir = os.path.join(out, 'chrome/android/ice_assets'); shutil.rmtree(adir, ignore_errors=True)
os.makedirs(os.path.join(adir, 'files'))
digest = hashlib.sha256(); inc = ['// Generated by android/overlay/builtins/gen-android-builtins.py. Do not edit.']
srcs, dsts = [], []
for i, (dest, full) in enumerate(entries):
    asset = 'ice/%05d' % i
    shutil.copyfile(full, os.path.join(adir, 'files', '%05d' % i))
    data = open(full, 'rb').read()
    digest.update(dest.encode() + b'\0' + hashlib.sha256(data).digest())
    inc.append(f'    {{{json.dumps(asset)}, {json.dumps(dest, ensure_ascii=False)}}},')
    srcs.append(f'    "files/{i:05d}",'); dsts.append(f'    "{asset}",')
open(os.path.join(ext, 'ice_android_assets.inc'), 'w', encoding='utf-8').write('\n'.join(inc) + '\n')
open(os.path.join(ext, 'ice_android_assets_digest.inc'), 'w').write(
    '// Generated by android/overlay/builtins/gen-android-builtins.py. Do not edit.\n'
    f'inline constexpr char kIceAndroidAssetsDigest[] = "{digest.hexdigest()}";\n')
open(os.path.join(adir, 'BUILD.gn'), 'w').write(
    '# Generated by android/overlay/builtins/gen-android-builtins.py. Do not edit.\n'
    'import("//build/config/android/rules.gni")\n\n'
    '# Ice built-ins and add-ons, extracted to <app data>/ice/ on first start (chrome/browser/extensions/ice_builtins.cc).\n'
    'android_assets("ice_assets") {\n  disable_compression = true\n  renaming_sources = [\n' + '\n'.join(srcs) +
    '\n  ]\n  renaming_destinations = [\n' + '\n'.join(dsts) + '\n  ]\n}\n')
print(f'{len(entries)} files: {len(gen.BUILTINS)} built-ins, {len(ADDONS)} add-ons ({", ".join(sorted(ADDONS))})')
