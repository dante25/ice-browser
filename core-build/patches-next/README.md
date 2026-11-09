# Patches waiting for the next build

Kept here so pushing them does not cancel the running build. When the current
build passes, move them to `core-build/patches/` (one push = one new build).

- ice-06-addons-loader.patch: loads SN Downloader / Video Sniffer unchanged from
  `<install>/dodaci/{sn-downloader,video-sniffer}` as normal unpacked extensions
  (like --load-extension), each gated by a profile pref (default on):
  `ice.addons.sn_downloader_enabled`, `ice.addons.video_sniffer_enabled`.
  ALSO TODO when promoting: `core-build/package-deb.sh` must copy
  `own-extensions/Ultimate SN Downloader/extension` -> `dodaci/sn-downloader` and
  `own-extensions/video-sniffer` -> `dodaci/video-sniffer` (byte-identical, root-owned, read-only).
- ice-10-settings-advanced-functions.patch: chrome://settings "Napredne funkcije" with the 3 switches.
