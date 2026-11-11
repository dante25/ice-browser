# Patches waiting for the next build

Kept here so pushing them does not cancel the running build. When the current
build passes, move them to `core-build/patches/` (one push = one new build).

- ice-10-settings-advanced-functions: chrome://settings "Napredne funkcije"
  (3 switches; prefs from ice-04 and ice-06). WebUI/TypeScript: not covered by
  the early compile check, so it waits until the core build is green.

Already promoted to patches/: ice-06 (add-ons from <install>/dodaci), ice-07
(Ice Shield out of the core, shipped as add-on), ice-08 (indexed DNR rulesets
of read-only add-ons in the user data dir).
- ice-20-sidebar-rail.patch: GUI step 2+3 (minimal): always-visible left icon rail
  (`chrome/browser/ui/views/ice/`) in normal windows with app menu (hamburger), bookmarks,
  history, downloads, "Funkcije" overlay panel (placeholder), settings and the avatar;
  the toolbar's ⋮ and avatar buttons are hidden. See docs/gui/SIDEBAR-DESIGN.md.
- ice-11-builtins-hidden-no-welcome: Ice built-ins never appear in the toolbar or the
  extensions (puzzle) menu (reached from the Ice panel instead); on first install / version
  change a built-in's tabs.create and options pages are suppressed for 2 minutes (no welcome tabs).
- ice-30-ice-theme.patch: Ice default browser colors, light + dark (follows the system),
  from docs/gui/tema-*.png: new `chrome/browser/ui/color/ice_color_mixer.cc` (frame, tabs,
  toolbar/rail, omnibox pill, separators), added before the native/custom-theme mixers and
  only when there is no theme / user color / GTK-Qt theme, so themes still override it.
  The Linux `kSystemTheme` pref now defaults to "Classic" (Ice colors) instead of GTK/Qt.
- ice-32-newtab-builtin.patch: `ice-features/ice-newtab` (Ice new tab page) as built-in
  hchkphbcnnbhopaimgcgfkgjejephmcn.
- Branding (no patch): `core-build/branding/**` (Ice product_logo PNGs, same paths as
  under src/) is copied over the tree and `core-build/ice-rebrand.py` renames "Chromium"
  to "Ice" in chromium_strings.grd / components_chromium_strings.grd + all .xtb
  translations (moved to the new message IDs). Both run in ice-hook.sh after the patches.
- ice-21-ice-panel.patch: chrome://ice-panel (WebUI, resources compiled in) hosted in the
  ice-20 overlay panel: "Funkcije" cards with Ice controls writing to each feature's
  chrome.storage, the 3 restart switches, and the main menu (#menu, hamburger). Page sources:
  docs/gui/ice-panel/. See docs/gui/SIDEBAR-DESIGN.md.
