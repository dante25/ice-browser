#!/usr/bin/env bash
# Instalira Ice u meni aplikacija (ikona + prečica) i komandu `ice`. Samo za tvog korisnika, bez sudo.
set -e
ICE="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || echo "$HOME/.local/bin/node")"

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
cat > "$HOME/.local/bin/ice" <<EOF
#!/usr/bin/env bash
exec "$NODE" "$ICE/bin/ice.js" "\$@"
EOF
chmod +x "$HOME/.local/bin/ice"

for n in 16 24 32 48 64 128 256 512; do
  d="$HOME/.local/share/icons/hicolor/${n}x${n}/apps"
  mkdir -p "$d" && cp "$ICE/assets/icons/ice-$n.png" "$d/ice-browser.png"
done

cat > "$HOME/.local/share/applications/ice-browser.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Ice
GenericName=Web preglednik
Comment=Ice: lagani i siguran preglednik
Exec=$HOME/.local/bin/ice %U
Icon=ice-browser
Terminal=false
Categories=Network;WebBrowser;
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=Ice
Actions=new-window;

[Desktop Action new-window]
Name=Novi prozor
Exec=$HOME/.local/bin/ice --new-window
EOF

gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database -q "$HOME/.local/share/applications" 2>/dev/null || true
echo "Ice je u meniju aplikacija. Komanda: ice"
