# Patches waiting for the next build

Kept here so pushing them does not cancel the running build. When the current
build passes, move them to `core-build/patches/` (one push = one new build).

- ice-06-addons-loader: loads EVERY add-on dir with a manifest.json from
  `<install>/dodaci/` (async listing on the file thread, then like
  --load-extension: normal unpacked, unchanged). `sn-downloader` and
  `video-sniffer` are gated by prefs `ice.addons.sn_downloader_enabled` /
  `ice.addons.video_sniffer_enabled` (default on); others always on.
- ice-07-ice-shield-out-of-core: Ice Shield is no longer a built-in
  (removed from kIceBuiltins and ice_builtin_ids.h); it ships as add-on
  `dodaci/ice-shield` so it can be updated without compiling.
- ice-08-dnr-readonly-addons: indexed static DNR rulesets of unpacked
  extensions also go to the user data dir (add-ons live read-only in /opt).
- ice-10-settings-advanced-functions: chrome://settings "Napredne funkcije"
  (needs ice-06 for the two add-on prefs).

TODO when promoting (scripts; editing them now would cancel the build):
- package-deb.sh: copy `own-extensions/Ultimate SN Downloader/extension` ->
  `dodaci/sn-downloader`, `own-extensions/video-sniffer` -> `dodaci/video-sniffer`,
  `ice-features/ice-shield` -> `dodaci/ice-shield`, and every `dodaci/*/`
  (with manifest.json) from the repo; byte-identical, root-owned, read-only.
  Stop copying ice-shield into resources/ice-builtins.
- gen-ice-builtins-files.py: drop ice-shield.
