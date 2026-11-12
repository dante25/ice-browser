#!/usr/bin/env bash
# Inkrementalna izmjena već kompajliranog stabla (build -4): ikone ekstenzija se vraćaju DESNO od adresne
# trake. Stablo -4 sadrži zakrpu koja ih je premjestila lijevo (icons-left.hunk); ovdje se ona poništava,
# pa ninja ponovo kompajlira samo toolbar_view.cc i povezuje chrome. Isto stanje daje i puna gradnja iz
# core-build/patches (ice-40 više nema taj dio).
# Upotreba: apply.sh <chromium src dir>
set -euo pipefail
SRC="$1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SRC"
grep -q "Ice: extension icons (Tab Counter, grabbers) sit LEFT" chrome/browser/ui/views/toolbar/toolbar_view.cc \
    || { echo "[ice-inc] toolbar_view.cc nema zakrpu 'ikone lijevo' (pogrešno polazno stablo?)" >&2; exit 1; }
patch -R -p1 --no-backup-if-mismatch < "$HERE/icons-left.hunk"
if grep -q "sit LEFT of the address bar" chrome/browser/ui/views/toolbar/toolbar_view.cc; then echo "[ice-inc] poništavanje nije uspjelo" >&2; exit 1; fi
echo "[ice-inc] ikone ekstenzija: desno od adresne trake (standardno)"
