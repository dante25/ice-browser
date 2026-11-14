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

# 2) Ice patches: patches/Ice/*.patch, applied after all upstream patches, in file name order
n=0
if compgen -G "$HERE/patches/*.patch" > /dev/null; then
  mkdir -p patches/Ice
  for p in $(ls "$HERE"/patches/*.patch | sort); do
    cp "$p" "patches/Ice/$(basename "$p")"
    printf 'Ice/%s\n' "$(basename "$p")" >> patches/series
    n=$((n + 1))
  done
fi
echo "Ice overlay applied: $n patch(es), $(wc -l < /tmp/ice-flags.gn) GN arg line(s)"
