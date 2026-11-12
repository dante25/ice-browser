#!/usr/bin/env bash
# Pravi ice-browser_<verzija>_amd64.deb: Ice + Chromium (ungoogled) + Node, sve u /opt/ice.
# Upotreba: bash scripts/build-deb.sh [izlazni-folder]
set -euo pipefail
ICE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ICE/dist}"
VER="${ICE_VERSION:-0.2.0}"
CHROMIUM="${ICE_CHROMIUM_DIR:-$HOME/.local/share/ice/chromium/current}"
NODE="${ICE_NODE:-$(readlink -f "$(command -v node)")}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -x "$CHROMIUM/chrome" ] || { echo "Nema Chromiuma u $CHROMIUM (pokreni: npm run guardian -- --install)"; exit 1; }
[ -x "$NODE" ] || { echo "Nema Node.js"; exit 1; }

P="$STAGE/pkg"
mkdir -p "$P/opt/ice" "$P/usr/bin" "$P/usr/share/applications" "$P/DEBIAN"

# Program (bez node_modules, starog Electron koda, git-a i rezervnih kopija)
tar -C "$ICE" --exclude=node_modules --exclude=legacy --exclude=.git --exclude=dist --exclude=ice-features/ice-sidebar/features.json \
  -cf - bin src ice-features chrome-extensions own-extensions assets scripts test package.json README.md KOMANDE.md PLAN-SUCELJE.md | tar -C "$P/opt/ice" -xf -
cp -a "$CHROMIUM/." "$P/opt/ice/chromium/" 2>/dev/null || { mkdir -p "$P/opt/ice/chromium"; cp -a "$CHROMIUM/." "$P/opt/ice/chromium/"; }
install -m 755 "$NODE" "$P/opt/ice/node"

# Komanda i prečica
cat > "$P/usr/bin/ice" <<'EOF'
#!/bin/sh
exec /opt/ice/node /opt/ice/bin/ice.js "$@"
EOF
chmod 755 "$P/usr/bin/ice"
cat > "$P/usr/share/applications/ice-browser.desktop" <<'EOF'
[Desktop Entry]
Version=1.0
Type=Application
Name=Ice
GenericName=Web preglednik
Comment=Ice: lagani i siguran preglednik
Exec=/usr/bin/ice %U
Icon=ice-browser
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=Ice
Actions=new-window;

[Desktop Action new-window]
Name=Novi prozor
Exec=/usr/bin/ice --new-window
EOF
for n in 16 24 32 48 64 128 256 512; do
  mkdir -p "$P/usr/share/icons/hicolor/${n}x${n}/apps"
  cp "$ICE/assets/icons/ice-$n.png" "$P/usr/share/icons/hicolor/${n}x${n}/apps/ice-browser.png"
done

SIZE=$(du -sk "$P" | cut -f1)
cat > "$P/DEBIAN/control" <<EOF
Package: ice-browser
Version: $VER
Section: web
Priority: optional
Architecture: amd64
Installed-Size: $SIZE
Depends: libgtk-3-0, libnss3, libxss1, libasound2t64 | libasound2, libgbm1, xdg-utils, python3, python3-gi, gir1.2-secret-1
Recommends: rclone, libnotify-bin
Maintainer: Ice <noreply@users.noreply.github.com>
Homepage: https://github.com/dante25/ice-browser
Description: Ice - lagani i siguran preglednik
 Ice je ungoogled-chromium s ugrađenim zaštitama (phishing i malware
 blokada, HTTPS-first, GPC), vlastitim panelom i odabranim funkcijama.
 Sadrži vlastiti Chromium i Node.js (u /opt/ice).
EOF

cat > "$P/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor 2>/dev/null || true
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications 2>/dev/null || true
exit 0
EOF
cp "$P/DEBIAN/postinst" "$P/DEBIAN/postrm"
chmod 755 "$P/DEBIAN/postinst" "$P/DEBIAN/postrm"

mkdir -p "$OUT"
FILE="$OUT/ice-browser_${VER}_amd64.deb"
dpkg-deb --root-owner-group -Zxz -z6 --build "$P" "$FILE" >/dev/null
echo "$FILE"
ls -la "$FILE" | awk '{print "veličina:", $5/1048576 " MB"}'
