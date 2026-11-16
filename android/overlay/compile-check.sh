#!/usr/bin/env bash
# Ice: run by the upstream build.sh (inserted by apply.sh) right after "gn gen", in src/.
# Compiles only the objects of the .cc files the Ice patches add or change, so a C++ error
# fails the prep job within minutes/hours instead of after the full 10+ h build. The objects
# are kept in out/Default, the full build reuses them.
# ICE_COMPILE_CHECK=0 skips it; ICE_COMPILE_CHECK_TIMEOUT (seconds, default 7200) bounds it:
# on timeout (generated headers not finished) the full build reports any error instead.
set -uo pipefail
[ "${ICE_COMPILE_CHECK:-1}" = 0 ] && { echo "[ice] compile check disabled"; exit 0; }
ninja=third_party/ninja/ninja; [ -x "$ninja" ] || ninja=ninja
targets=(); missing=0
for f in $(grep -h '^+++ b/.*\.cc$' ../patches/Ice/*.patch | sed 's|^+++ b/||' | sort -u); do
  if "$ninja" -C out/Default -t query "../../$f" >/dev/null 2>&1; then
    targets+=("../../$f^"); echo "[ice] compile check: $f"
  elif grep -q "^--- /dev/null" <(grep -h -B1 "^+++ b/$f$" ../patches/Ice/*.patch); then
    echo "[ice] ERROR: $f is added by an Ice patch but is not in the build graph" >&2; missing=1
  else
    echo "[ice] note: $f is not built in this configuration"
  fi
done
[ "$missing" = 0 ] || exit 1
[ "${#targets[@]}" -gt 0 ] || { echo "[ice] compile check: nothing to compile"; exit 0; }
rc=0
timeout -k 2m -s INT "${ICE_COMPILE_CHECK_TIMEOUT:-7200}" "$ninja" -k 0 -C out/Default "${targets[@]}" || rc=$?
if [ "$rc" = 124 ]; then echo "[ice] WARNING: compile check timed out, the full build will report errors"; exit 0; fi
[ "$rc" = 0 ] || { echo "[ice] ERROR: compile check failed (ninja exit $rc): fix the C++ in the Ice patches" >&2; exit "$rc"; }
echo "[ice] compile check passed"
