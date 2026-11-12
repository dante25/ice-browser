#!/usr/bin/env bash
# Packages the Ice core build (core-build/build.sh output) as ice-browser_<version>_amd64.deb.
#
#   /opt/ice-browser/                      chrome + the files portablelinux ships (scripts/package.sh)
#   /opt/ice-browser/chrome-sandbox        from out/Default/chrome_sandbox, root:root 4755
#   /opt/ice-browser/resources/ice-builtins/<dir>/   extensions, byte-for-byte (core-build/README.md)
#   /opt/ice-browser/ice-browser           launcher (CHROME_WRAPPER), /usr/bin/ice-browser -> it
#   /usr/share/applications/ice-browser.desktop, /usr/share/icons/hicolor/*/apps/ice-browser.png
#
# Usage: core-build/package-deb.sh [--out-dir <chromium out/Default>] [--dest <dir>]
# Env:   ICE_PL_DIR (as in build.sh), ICE_DEB_VERSION, ICE_DEB_DEPENDS
set -euo pipefail

ICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PL="${ICE_PL_DIR:-core-build/.work/portablelinux}"
case "$PL" in /*) ;; *) PL="$ICE/$PL" ;; esac
OUT_DIR="$PL/build/src/out/Default"
DEST="$ICE/dist"
while [ $# -gt 0 ]; do
    case "$1" in
        --out-dir) OUT_DIR="$2"; shift 2 ;;
        --dest) DEST="$2"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

log() { echo "[ice-deb] $*"; }
die() { echo "[ice-deb] ERROR: $*" >&2; exit 1; }

PKG=ice-browser
INSTALL=/opt/ice-browser

CHROMIUM_VERSION="156.0.8078.79"
UC_REVISION="1"
if [ -f "$PL/ungoogled-chromium/chromium_version.txt" ]; then
    CHROMIUM_VERSION="$(cat "$PL/ungoogled-chromium/chromium_version.txt")"
    UC_REVISION="$(cat "$PL/ungoogled-chromium/revision.txt")"
fi
VERSION="${ICE_DEB_VERSION:-${CHROMIUM_VERSION}-${UC_REVISION}}"

# Runtime libraries of an official Chromium build linked against the Debian sysroot
# (same set Google Chrome's .deb declares); "t64" alternatives for Ubuntu 24.04+/Debian 13.
DEPENDS="${ICE_DEB_DEPENDS:-libasound2t64 | libasound2 (>= 1.0.17), libatk-bridge2.0-0t64 | libatk-bridge2.0-0 (>= 2.5.3), libatk1.0-0t64 | libatk1.0-0 (>= 2.11.90), libatspi2.0-0t64 | libatspi2.0-0 (>= 2.9.90), libc6 (>= 2.28), libcairo2 (>= 1.6.0), libcups2t64 | libcups2 (>= 1.6.0), libdbus-1-3 (>= 1.9.14), libdrm2 (>= 2.4.75), libexpat1 (>= 2.1~beta3), libgbm1 (>= 17.1.0~rc2), libglib2.0-0t64 | libglib2.0-0 (>= 2.39.4), libgtk-3-0t64 | libgtk-3-0 (>= 3.9.10), libnspr4 (>= 2:4.9-2~), libnss3 (>= 2:3.35), libpango-1.0-0 (>= 1.14.0), libudev1 (>= 183), libx11-6 (>= 2:1.4.99.1), libxcb1 (>= 1.9.2), libxcomposite1 (>= 1:0.4.4-1), libxdamage1 (>= 1:1.1), libxext6, libxfixes3, libxkbcommon0 (>= 0.5.0), libxrandr2, xdg-utils (>= 1.0.2), ca-certificates, fonts-liberation}"

# portablelinux scripts/package.sh $_files (156.0.8078.79-1). Upstream copies them with
# "cp -r ... &" + bare "wait", which ignores missing files; here the core set is required.
REQUIRED_FILES="chrome
chrome_100_percent.pak
chrome_200_percent.pak
chrome_crashpad_handler
icudtl.dat
libEGL.so
libGLESv2.so
locales
resources.pak
v8_context_snapshot.bin"
OPTIONAL_FILES="chromedriver
chrome-wrapper
libqt5_shim.so
libqt6_shim.so
libvk_swiftshader.so
libvulkan.so.1
product_logo_48.png
vk_swiftshader_icd.json
xdg-mime
xdg-settings"

# core-build/README.md mapping: <dir> -> repo source
BUILTINS="adblock-for-youtube:chrome-extensions
bookmarks-clean-up:chrome-extensions
chrome-tab-counter:chrome-extensions
default-quality-adjuster-for-youtube:chrome-extensions
enable-right-click-for-google-chrome:chrome-extensions
go-back-with-backspace:chrome-extensions
hide-anything-element-hider-for-chrome:chrome-extensions
hide-labels-and-end-cards-on-youtube:chrome-extensions
multiselect-for-youtube:chrome-extensions
permanent-progress-bar-for-youtube:chrome-extensions
screenshot-youtube:chrome-extensions
search-by-image:chrome-extensions
tab-session-manager:chrome-extensions
webmail-ad-blocker:chrome-extensions
youtube-nonstop:chrome-extensions
google-images-viewer:ice-features
ice-newtab:ice-features"

# Expected IDs (README table), checked against each manifest "key".
EXPECTED_IDS="adblock-for-youtube cmedhionkhpnakcndndgjdbohmhepckk
bookmarks-clean-up oncbjlgldmiagjophlhobkogeladjijl
chrome-tab-counter fhnegjjodccfaliddboelcleikbmapik
default-quality-adjuster-for-youtube dddapfimfefnombikhnbckhjmfkggifl
enable-right-click-for-google-chrome ofgdcdohlhjfdhbnfkikfeakhpojhpgm
go-back-with-backspace eekailopagacbcdloonjhbiecobagjci
hide-anything-element-hider-for-chrome gkjljknnkogcgndejajchomapofgiinf
hide-labels-and-end-cards-on-youtube jinenhpepbpkepablpjjchejlabbpken
multiselect-for-youtube gpgbiinpmelaihndlegbgfkmnpofgfei
permanent-progress-bar-for-youtube dammfdepmngjjoidfdbhkjboecgceamb
screenshot-youtube gjoijpfmdhbjkkgnmahganhoinjjpohk
search-by-image cnojnbdhbhnkbcieeekonklommdnndci
tab-session-manager iaiomicjabeggjcfkbimgmglanimpnae
webmail-ad-blocker cbhfdchmklhpcngcgjmpdbjakdggkkjp
youtube-nonstop nlkaejimjacpillmajjnopmpbkbnocid
google-images-viewer bblfilgjmibmjophkgpigfedganlieod
ice-newtab hchkphbcnnbhopaimgcgfkgjejephmcn"

command -v dpkg-deb >/dev/null || die "dpkg-deb not found"
command -v python3 >/dev/null || die "python3 not found"
[ -d "$OUT_DIR" ] || die "build output not found: $OUT_DIR"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
umask 022
P="$STAGE/pkg"
O="$P$INSTALL"
mkdir -p "$O" "$P/usr/bin" "$P/usr/share/applications" "$P/DEBIAN"

# --- Chromium files
for f in $REQUIRED_FILES; do
    [ -e "$OUT_DIR/$f" ] || die "missing required build output: $OUT_DIR/$f"
    cp -a "$OUT_DIR/$f" "$O/"
done
for f in $OPTIONAL_FILES; do
    if [ -e "$OUT_DIR/$f" ]; then
        cp -a "$OUT_DIR/$f" "$O/"
    else
        log "WARNING: optional file not in build output: $f"
    fi
done
[ -x "$OUT_DIR/chrome_sandbox" ] || die "missing $OUT_DIR/chrome_sandbox (ninja target chrome_sandbox)"
install -m 4755 "$OUT_DIR/chrome_sandbox" "$O/chrome-sandbox"
chmod 4755 "$O/chrome-sandbox"   # install(1) may drop setuid for non-root users

# --- Built-in extensions, byte-for-byte
mkdir -p "$O/resources/ice-builtins"
while IFS=: read -r dir parent; do
    src="$ICE/$parent/$dir"
    [ -f "$src/manifest.json" ] || die "missing extension source $src/manifest.json"
    cp -a "$src" "$O/resources/ice-builtins/$dir"
done <<< "$BUILTINS"
while IFS=: read -r dir parent; do
    diff -r "$ICE/$parent/$dir" "$O/resources/ice-builtins/$dir" >/dev/null \
        || { diff -r "$ICE/$parent/$dir" "$O/resources/ice-builtins/$dir" | head -20 >&2; die "copy of $parent/$dir differs from source"; }
done <<< "$BUILTINS"
[ "$(find "$O/resources/ice-builtins" -mindepth 1 -maxdepth 1 -type d | wc -l)" = 17 ] \
    || die "expected 17 dirs in resources/ice-builtins"
while read -r dir id; do
    got="$(python3 -I - "$O/resources/ice-builtins/$dir/manifest.json" <<'PY'
import base64, hashlib, re, sys
text = open(sys.argv[1], encoding="utf-8-sig").read()
m = re.search(r'"key"\s*:\s*"([^"]+)"', text)
if not m:
    print("no-key")
else:
    h = hashlib.sha256(base64.b64decode(m.group(1))).hexdigest()[:32]
    print("".join(chr(ord("a") + int(c, 16)) for c in h))
PY
)"
    [ "$got" = "$id" ] || die "$dir: manifest key gives ID $got, expected $id"
done <<< "$EXPECTED_IDS"
# Not writable by users: root-owned via dpkg-deb --root-owner-group, dirs 755, files 644.
find "$O/resources/ice-builtins" -type d -exec chmod 755 {} +
find "$O/resources/ice-builtins" -type f -exec chmod 644 {} +
[ -z "$(find "$O/resources/ice-builtins" ! -type f ! -type d)" ] || die "symlinks/special files in ice-builtins"

# Exactly the files (no extra, none missing, same SHA-256) compiled into the browser.
INC="${ICE_BUILTINS_INC:-$PL/build/src/chrome/browser/extensions/ice_builtins_files.inc}"
if [ ! -f "$INC" ]; then
    [ "${ICE_ALLOW_NO_INC:-0}" = 1 ] || die "compiled-in file list not found: $INC (set ICE_BUILTINS_INC)"
    log "WARNING: $INC not found, regenerating for comparison"
    INC="$STAGE/ice_builtins_files.inc"
    python3 -I "$ICE/core-build/gen-ice-builtins-files.py" "$ICE" "$INC"
fi
python3 -I - "$INC" "$O/resources/ice-builtins" <<'PY'
import hashlib, os, re, sys
inc, root = sys.argv[1], sys.argv[2]
want = {}
for line in open(inc, encoding="utf-8"):
    m = re.match(r'\s*\{"([^"]+)", "([^"]+)", "([0-9a-f]{64})"\},\s*$', line)
    if m:
        want[(m.group(1), m.group(2))] = m.group(3)
if not want:
    sys.exit(f"no entries parsed from {inc}")
have = {}
for name in os.listdir(root):
    for dirpath, _, files in os.walk(os.path.join(root, name)):
        for fn in files:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, os.path.join(root, name)).replace(os.sep, "/")
            with open(full, "rb") as f:
                have[(name, rel)] = hashlib.sha256(f.read()).hexdigest()
bad = [f"extra: {k}" for k in have.keys() - want.keys()]
bad += [f"missing: {k}" for k in want.keys() - have.keys()]
bad += [f"modified: {k}" for k in want.keys() & have.keys() if want[k] != have[k]]
if bad:
    print("\n".join(sorted(bad)[:50]), file=sys.stderr)
    sys.exit(f"ice-builtins does not match {inc}")
print(f"[ice-deb] ice-builtins matches compiled-in list ({len(want)} files)")
PY
log "17 built-in extensions copied and verified (diff -r, IDs, compiled-in SHA-256 list, 755/644)"

# --- Add-ons (dodaci): normal extensions, unchanged, loaded from $INSTALL/dodaci by
# patch ice-06. Updatable with a new .deb, no compiling. tests/ and README.md are not shipped.
ADDONS="sn-downloader:own-extensions/Ultimate SN Downloader/extension
video-sniffer:own-extensions/video-sniffer
ice-shield:ice-features/ice-shield"
for d in "$ICE"/dodaci/*/; do
    [ -f "$d/manifest.json" ] || continue
    ADDONS+=$'\n'"$(basename "$d"):dodaci/$(basename "$d")"
done
mkdir -p "$O/dodaci"
while IFS=: read -r dir src; do
    [ -f "$ICE/$src/manifest.json" ] || die "missing add-on source $src/manifest.json"
    [ ! -e "$O/dodaci/$dir" ] || die "duplicate add-on name: $dir"
    cp -a "$ICE/$src" "$O/dodaci/$dir"
    rm -rf "$O/dodaci/$dir/tests" "$O/dodaci/$dir/README.md"
    diff -r -x tests -x README.md "$ICE/$src" "$O/dodaci/$dir" >/dev/null \
        || { diff -r -x tests -x README.md "$ICE/$src" "$O/dodaci/$dir" | head -20 >&2; die "copy of $src differs from source"; }
done <<< "$ADDONS"
find "$O/dodaci" -type d -exec chmod 755 {} +
find "$O/dodaci" -type f -exec chmod 644 {} +
[ -z "$(find "$O/dodaci" ! -type f ! -type d)" ] || die "symlinks/special files in dodaci"
log "add-ons in dodaci/: $(ls "$O/dodaci" | tr '\n' ' ')"

# --- Uvoz iz drugog browsera: Python uvoznik + native messaging host za dodatak dodaci/ice-uvoz
# (bez kompajliranja). Manifest hosta ide u /etc/chromium/native-messaging-hosts i, preko launchera,
# u <profil>/NativeMessagingHosts.
UVOZ_ID="dfhbiomgcficgkidolpkoiafdoegbbha"
grep -q '"key"' "$O/dodaci/ice-uvoz/manifest.json" || die "dodaci/ice-uvoz has no manifest key"
python3 -I -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read())' "$ICE/core-build/uvoz/ice-uvoz.py" \
    || die "ice-uvoz.py has a syntax error"
install -D -m 755 "$ICE/core-build/uvoz/ice-uvoz.py" "$O/uvoz/ice-uvoz.py"
cat > "$O/uvoz/ice.uvoz.json" <<UVOZ
{
  "name": "ice.uvoz",
  "description": "Ice: uvoz iz drugog browsera",
  "path": "$INSTALL/uvoz/ice-uvoz.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$UVOZ_ID/"]
}
UVOZ
chmod 644 "$O/uvoz/ice.uvoz.json"
install -D -m 644 "$O/uvoz/ice.uvoz.json" "$P/etc/chromium/native-messaging-hosts/ice.uvoz.json"

# --- Launcher (CHROME_WRAPPER must point into $INSTALL so Chrome finds xdg-settings/xdg-mime)
cat > "$O/ice-browser" <<EOF
#!/bin/bash
# Ice browser launcher
THIS="\$(readlink -f "\$0")"
HERE="\$(dirname "\$THIS")"
export CHROME_WRAPPER="\$THIS"
export CHROME_DESKTOP="ice-browser.desktop"
extra=()
case " \$* " in
    *" --user-data-dir="*|*" --user-data-dir "*) ;;
    *) ud="\${ICE_PROFILE:-\${XDG_CONFIG_HOME:-\$HOME/.config}/ice-browser}"
       extra+=("--user-data-dir=\$ud")
       # host dodatka "Uvoz iz drugog browsera"
       mkdir -p "\$ud/NativeMessagingHosts" 2>/dev/null && cp -f "\$HERE/uvoz/ice.uvoz.json" "\$ud/NativeMessagingHosts/" 2>/dev/null || true ;;
esac
exec "\$HERE/chrome" --class=Ice "\${extra[@]}" "\$@"
EOF
chmod 755 "$O/ice-browser"
ln -s "$INSTALL/ice-browser" "$P/usr/bin/ice-browser"

# --- Desktop file (conventions of scripts/build-deb.sh; MIME list/actions from portablelinux)
cat > "$P/usr/share/applications/ice-browser.desktop" <<'EOF'
[Desktop Entry]
Version=1.0
Type=Application
Name=Ice
GenericName=Web preglednik
Comment=Ice: lagani i siguran preglednik
Exec=/usr/bin/ice-browser %U
Icon=ice-browser
Terminal=false
Categories=Network;WebBrowser;
MimeType=application/pdf;application/rdf+xml;application/rss+xml;application/xhtml+xml;application/xhtml_xml;application/xml;image/gif;image/jpeg;image/png;image/webp;text/html;text/xml;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
StartupWMClass=Ice
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=Novi prozor
Exec=/usr/bin/ice-browser --new-window

[Desktop Action new-private-window]
Name=Novi privatni prozor
Exec=/usr/bin/ice-browser --incognito
EOF
if command -v desktop-file-validate >/dev/null; then
    desktop-file-validate "$P/usr/share/applications/ice-browser.desktop"
fi

for n in 16 24 32 48 64 128 256 512; do
    [ -f "$ICE/assets/icons/ice-$n.png" ] || die "missing assets/icons/ice-$n.png"
    install -D -m 644 "$ICE/assets/icons/ice-$n.png" "$P/usr/share/icons/hicolor/${n}x${n}/apps/ice-browser.png"
done

# --- Control files
SIZE=$(du -sk "$P" | cut -f1)
cat > "$P/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: web
Priority: optional
Architecture: amd64
Installed-Size: $SIZE
Depends: $DEPENDS
Recommends: libva2, libvulkan1, libu2f-udev, upower, python3, python3-gi, gir1.2-secret-1, python3-cryptography | openssl
Provides: www-browser
Maintainer: Ice <noreply@users.noreply.github.com>
Homepage: https://github.com/dante25/ice-browser
Description: Ice - lagani i siguran preglednik
 Ice je ungoogled-chromium $CHROMIUM_VERSION-$UC_REVISION s ugrađenim Ice
 funkcijama (component ekstenzije u $INSTALL/resources/ice-builtins).
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

# --- Informational: libraries the binary needs that this machine lacks
if command -v ldd >/dev/null; then
    missing="$(ldd "$O/chrome" 2>/dev/null | grep 'not found' || true)"
    [ -z "$missing" ] || log "NOTE: on this host ldd reports missing libraries:"$'\n'"$missing"
fi

mkdir -p "$DEST"
FILE="$DEST/${PKG}_${VERSION}_amd64.deb"
dpkg-deb --root-owner-group -Zxz -z6 --build "$P" "$FILE" >/dev/null

# --- Verify the result
listing="$(dpkg-deb -c "$FILE")"
grep -qE "^-rwsr-xr-x root/root .* \./opt/ice-browser/chrome-sandbox$" <<< "$listing" \
    || die "chrome-sandbox is not root:root 4755 in the package"
grep -q "\./opt/ice-browser/resources/ice-builtins/google-images-viewer/manifest.json$" <<< "$listing" \
    || die "built-ins missing from the package"
for a in sn-downloader video-sniffer ice-shield ice-uvoz; do
    grep -q "\./opt/ice-browser/dodaci/$a/manifest.json$" <<< "$listing" || die "add-on $a missing from the package"
done
badperm="$(grep ' \./opt/ice-browser/dodaci/' <<< "$listing" \
    | grep -vE '^(-rw-r--r--|drwxr-xr-x) root/root ' || true)"
[ -z "$badperm" ] || die "wrong owner/mode in dodaci:"$'\n'"$(echo "$badperm" | head -10)"
badperm="$(grep ' \./opt/ice-browser/resources/ice-builtins/' <<< "$listing" \
    | grep -vE '^(-rw-r--r--|drwxr-xr-x) root/root ' || true)"
[ -z "$badperm" ] || die "wrong owner/mode in ice-builtins:"$'\n'"$(echo "$badperm" | head -10)"
grep -qE "^-rwxr-xr-x root/root .* \./opt/ice-browser/uvoz/ice-uvoz.py$" <<< "$listing" \
    || die "ice-uvoz.py missing or not executable"
dpkg-deb -f "$FILE" Package Version Depends >/dev/null
echo "$FILE"
ls -la "$FILE" | awk '{printf "[ice-deb] size: %.1f MB\n", $5/1048576}'
