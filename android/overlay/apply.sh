#!/usr/bin/env bash
# Ice overlay on a checkout of ungoogled-chromium-android (the tag in android/upstream.version).
# usage: apply.sh <path of the ungoogled-chromium-android checkout>
set -euo pipefail
UP="${1:?path of the ungoogled-chromium-android checkout}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$UP"
[ -f android_flags.gn ] && [ -f patches/series ] || { echo "not an ungoogled-chromium-android checkout: $UP" >&2; exit 1; }

# 1) GN args
grep -v '^[[:space:]]*#' "$HERE/flags.ice.gn" | grep -v '^[[:space:]]*$' > /tmp/ice-flags.gn || true
if [ -s /tmp/ice-flags.gn ]; then { echo; echo "# --- Ice"; cat /tmp/ice-flags.gn; } >> android_flags.gn; fi

REPO="$(cd "$HERE/../.." && pwd)"

# 2) desktop Ice patches shared with Android (built-in extensions, add-ons), first
mkdir -p patches/Ice
for p in $(grep -v '^[[:space:]]*#' "$HERE/desktop-patches.txt" | grep -v '^[[:space:]]*$'); do
  [ -f "$REPO/core-build/patches/$p" ] || { echo "missing core-build/patches/$p" >&2; exit 1; }
  cp "$REPO/core-build/patches/$p" "patches/Ice/desktop-$p"
  printf 'Ice/desktop-%s\n' "$p" >> patches/series
done

# 2a) generated patches: the Ice theme (colours from ice-palette.json, same as the desktop)
mkdir -p patches/Ice
python3 "$HERE/theme/gen-android-colors.py" --patch patches/Ice/ice-30-android-theme.patch
printf 'Ice/ice-30-android-theme.patch\n' >> patches/series

# 2b) Ice patches: patches/Ice/*.patch, applied after all upstream patches, in file name order
n=1
if compgen -G "$HERE/patches/*.patch" > /dev/null; then
  mkdir -p patches/Ice
  for p in $(ls "$HERE"/patches/*.patch | sort); do
    cp "$p" "patches/Ice/$(basename "$p")"
    printf 'Ice/%s\n' "$(basename "$p")" >> patches/series
    n=$((n + 1))
  done
fi
# 3) Ice files and the build hook: copied into src/ and the strings rebranded after all patches
rm -rf ice-files ice-android; mkdir -p ice-files ice-android
[ -d "$HERE/files" ] && cp -a "$HERE/files/." ice-files/
python3 "$HERE/builtins/gen-android-builtins.py" "$REPO" ice-files
cp "$HERE/hook.sh" "$HERE/compile-check.sh" "$REPO/core-build/ice-rebrand.py" ice-android/
grep -q '^  psa_dat=' build.sh || { echo "build.sh: psa_dat= marker missing, cannot insert the Ice hook" >&2; exit 1; }
sed -i 's|^  psa_dat=|  bash ice-android/hook.sh\n&|' build.sh
grep -q '^  bash ice-android/hook.sh$' build.sh || { echo "build.sh: Ice hook not inserted" >&2; exit 1; }
# compile check of the Ice C++ right after gn gen (in src/)
GN='  buildtools/linux64/gn gen "${output_folder}" --fail-on-unused-args'
[ "$(grep -cxF "$GN" build.sh)" = 1 ] || { echo "build.sh: gn gen line not found once, cannot insert the compile check" >&2; exit 1; }
sed -i "\\|^  buildtools/linux64/gn gen \"\${output_folder}\" --fail-on-unused-args\$|a\\  bash ../ice-android/compile-check.sh" build.sh
grep -q '^  bash ../ice-android/compile-check.sh$' build.sh || { echo "build.sh: compile check not inserted" >&2; exit 1; }

# 4) keep unfinished build trees 3 days instead of 1 (upstream build-stage action), so a failed
#    part can still be resumed the next day; not part of the build fingerprint
if [ -f .github/actions/build-stage/action.yml ]; then
  sed -i 's/^\(        retention-days: \)1$/\13/' .github/actions/build-stage/action.yml
fi

echo "Ice overlay applied: $n patch(es), $(wc -l < /tmp/ice-flags.gn) GN arg line(s)"
