#!/usr/bin/env bash
# Samo čitanje: ispisuje verzije instaliranog Chromea/Chromiuma i Electrona.
# Ništa ne mijenja i ne šalje na mrežu.
for b in google-chrome google-chrome-stable chromium chromium-browser brave-browser; do
  if command -v "$b" >/dev/null 2>&1; then
    echo "$b: $("$b" --version 2>/dev/null)"
  fi
done
if command -v flatpak >/dev/null 2>&1; then
  flatpak list --app --columns=name,version 2>/dev/null | grep -i -E 'chrom|brave' | sed 's/^/flatpak: /'
fi
if [ -x node_modules/.bin/electron ]; then
  echo "electron: $(node_modules/.bin/electron --version)"
  ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron -e "console.log('chromium u Iceu:', process.versions.chrome)" 2>/dev/null
fi
echo
echo "Uporedi verziju s najnovijom stabilnom na https://chromiumdash.appspot.com/releases"
