# Patches waiting for the next build

Kept here so pushing them does not cancel the running build. When the current
build passes, move them to `core-build/patches/` (one push = one new build).

- ice-10-settings-advanced-functions: chrome://settings "Napredne funkcije"
  (3 switches; prefs from ice-04 and ice-06). WebUI/TypeScript: not covered by
  the early compile check, so it waits until the core build is green.

Already promoted to patches/: ice-06 (add-ons from <install>/dodaci), ice-07
(Ice Shield out of the core, shipped as add-on), ice-08 (indexed DNR rulesets
of read-only add-ons in the user data dir).
