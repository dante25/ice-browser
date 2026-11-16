#!/usr/bin/env bash
# Ice: run by the upstream build.sh (inserted by apply.sh) after all patches and both domain
# substitutions, in the ungoogled-chromium-android checkout. Copies Ice's files into src/
# (launcher icons ...) and renames "Chromium" -> "Ice" in the UI strings, as on the desktop.
set -euo pipefail
cp -a ice-files/. src/
python3 ice-android/ice-rebrand.py src
echo "Ice hook done"
