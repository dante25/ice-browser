#!/usr/bin/env bash
# Ice core build: ungoogled-chromium 156.0.8078.79-1 (Linux x86_64) + core-build/patches/ice-*.patch
#
# Wraps ungoogled-chromium-portablelinux at tag 156.0.8078.79-1 (cloned into $ICE_PL_DIR,
# default core-build/.work/portablelinux) and hooks Ice into its scripts/shared.sh
# (see core-build/ice-hook.sh). Everything else (Docker image, download, prune, ungoogled +
# portablelinux patches, domain substitution, GN args, toolchain, gn gen, ninja) is theirs.
#
# Usage:
#   core-build/build.sh [all]   local: setup + full build in their Docker image
#                               (ICE_NO_DOCKER=1: run their scripts/build.sh on this host instead)
#   core-build/build.sh setup   clone portablelinux + submodule, install hook, sync patches
#   core-build/build.sh prep    CI: prepare tree (download, patch, gn gen, compile check); image must be loaded
#   core-build/build.sh part    CI: one ninja part (5h timeout); _gha_final=true for the last part
#   core-build/build.sh sources list the C++ files the compile check will build
#
# Environment:
#   ICE_PL_DIR                 portablelinux checkout (relative paths are relative to the repo root)
#   ICE_COMPILE_CHECK=0        skip the early compile check after gn gen
#   ICE_COMPILE_CHECK_TIMEOUT  seconds for the compile check (default 9000; timeout = warning only)
#   ICE_ALLOW_NO_PATCHES=1     allow building without any ice-*.patch
#
# Build output: $ICE_PL_DIR/build/src/out/Default (chrome, chrome_sandbox, chromedriver, ...).
set -euo pipefail

PL_REPO="https://github.com/ungoogled-software/ungoogled-chromium-portablelinux.git"
PL_TAG="156.0.8078.79-1"
PL_COMMIT="6f0aa178c2394fc0a177edc0fd64e41f402a0418"     # portablelinux tag 156.0.8078.79-1
UC_COMMIT="28a211ab4ab6b83d919966a4f58a6df23cf4fb29"     # ungoogled-chromium tag 156.0.8078.79-1 (peeled)
CHROMIUM_VERSION="156.0.8078.79"
UC_REVISION="1"
BUILD_TARGETS_OLD="ninja -C out/Default chrome chromedriver"
BUILD_TARGETS_NEW="ninja -C out/Default chrome chrome_sandbox chromedriver"
HOOK_MARKER="# >>> ice-core-build hook >>>"

ICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PL="${ICE_PL_DIR:-core-build/.work/portablelinux}"
case "$PL" in /*) ;; *) PL="$ICE/$PL" ;; esac

export ARCH=x86_64

log() { echo "[ice-build] $*"; }
die() { echo "[ice-build] ERROR: $*" >&2; exit 1; }

check_arch() {
    [ "$(uname -m)" = x86_64 ] || die "only x86_64 hosts are supported (this is $(uname -m))"
}

clone_portablelinux() {
    if [ -d "$PL/.git" ]; then
        local head
        head="$(git -C "$PL" rev-parse HEAD)"
        [ "$head" = "$PL_COMMIT" ] || die "$PL is at $head, expected $PL_COMMIT ($PL_TAG); remove it"
        log "portablelinux already present at $PL"
    else
        log "cloning portablelinux $PL_TAG into $PL"
        mkdir -p "$(dirname "$PL")"
        git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$PL_TAG" "$PL_REPO" "$PL"
        [ "$(git -C "$PL" rev-parse HEAD)" = "$PL_COMMIT" ] \
            || die "tag $PL_TAG no longer points to $PL_COMMIT"
    fi

    if [ ! -f "$PL/ungoogled-chromium/chromium_version.txt" ]; then
        git -C "$PL" submodule update --init --depth 1 ungoogled-chromium
    fi
    local uc
    uc="$(git -C "$PL/ungoogled-chromium" rev-parse HEAD)"
    [ "$uc" = "$UC_COMMIT" ] || die "ungoogled-chromium submodule is at $uc, expected $UC_COMMIT"
    [ "$(cat "$PL/ungoogled-chromium/chromium_version.txt")" = "$CHROMIUM_VERSION" ] || die "unexpected chromium_version.txt"
    [ "$(cat "$PL/ungoogled-chromium/revision.txt")" = "$UC_REVISION" ] || die "unexpected revision.txt"
}

install_hook() {
    local shared="$PL/scripts/shared.sh"
    grep -q '^apply_patches() {' "$shared" || die "apply_patches() not found in $shared"
    grep -q '^gn_gen() {' "$shared" || die "gn_gen() not found in $shared"
    if ! grep -qF "$HOOK_MARKER" "$shared"; then
        {
            echo ""
            echo "$HOOK_MARKER"
            echo '. "$(repo_root)/ice/ice-hook.sh"'
            echo "# <<< ice-core-build hook <<<"
        } >> "$shared"
        log "hooked ice/ice-hook.sh into scripts/shared.sh"
    fi

    # Also build chrome_sandbox (setuid sandbox for the .deb); upstream builds chrome chromedriver.
    local f
    for f in "$PL/scripts/shared.sh" "$PL/.github/scripts/build.sh"; do
        if ! grep -qF "$BUILD_TARGETS_NEW" "$f"; then
            [ "$(grep -cF "$BUILD_TARGETS_OLD" "$f")" = 1 ] || die "ninja line not found exactly once in $f"
            sed -i "s|$BUILD_TARGETS_OLD|$BUILD_TARGETS_NEW|" "$f"
        fi
        grep -qF "$BUILD_TARGETS_NEW" "$f" || die "failed to add chrome_sandbox to $f"
    done
}

sync_patches() {
    local -a patches
    # Only core-build/patches/ice-*.patch (never core-build/patches-gui/).
    mapfile -t patches < <(find "$ICE/core-build/patches" -maxdepth 1 -type f -name 'ice-*.patch' 2>/dev/null | LC_ALL=C sort)
    if [ "${#patches[@]}" -eq 0 ] && [ "${ICE_ALLOW_NO_PATCHES:-0}" != 1 ]; then
        die "no core-build/patches/ice-*.patch found (set ICE_ALLOW_NO_PATCHES=1 to build without)"
    fi
    local p
    for p in "${patches[@]}"; do
        grep -q '^+++ b/' "$p" || die "$(basename "$p") has no '+++ b/' lines (expected unified diff with a/ b/ prefixes)"
        ! grep -q $'\r$' "$p" || die "$(basename "$p") has CRLF line endings"
    done

    rm -rf "$PL/ice"
    mkdir -p "$PL/ice/patches"
    cp "$ICE/core-build/ice-hook.sh" "$PL/ice/ice-hook.sh"
    [ "${#patches[@]}" -eq 0 ] || cp "${patches[@]}" "$PL/ice/patches/"
    python3 "$ICE/core-build/gen-ice-builtins-files.py" "$ICE" "$PL/ice/ice_builtins_files.inc" \
        || die "gen-ice-builtins-files.py failed"
    log "generated ice_builtins_files.inc ($(grep -c '^    {' "$PL/ice/ice_builtins_files.inc") files)"
    {
        printf 'ICE_COMPILE_CHECK=%q\n' "${ICE_COMPILE_CHECK:-1}"
        printf 'ICE_COMPILE_CHECK_TIMEOUT=%q\n' "${ICE_COMPILE_CHECK_TIMEOUT:-9000}"
        printf 'ICE_ALLOW_NO_PATCHES=%q\n' "${ICE_ALLOW_NO_PATCHES:-0}"
    } > "$PL/ice/env.sh"
    log "Ice patches (applied in this order after ungoogled + portablelinux patches):"
    for p in "${patches[@]}"; do log "  $(basename "$p")"; done
}

setup() {
    check_arch
    clone_portablelinux
    install_hook
    sync_patches
}

list_sources() {
    # Same derivation as ice_compile_check, without the build graph filter.
    _root="$PL" bash -c '
        repo_root() { echo "$_root"; }
        apply_patches() { :; }; gn_gen() { :; }
        . "$_root/ice/ice-hook.sh"
        ice_patched_sources'
}

cmd="${1:-all}"
case "$cmd" in
    setup)
        setup
        ;;
    sources)
        setup >/dev/null
        list_sources
        ;;
    prep)
        setup
        export _use_existing_image=true _prepare_only=true _gha_final=false
        bash "$PL/scripts/docker-build.sh"
        ;;
    part)
        setup
        export _use_existing_image=true _prepare_only=false _gha_final="${_gha_final:-false}"
        bash "$PL/scripts/docker-build.sh"
        ;;
    all)
        setup
        if [ "${ICE_NO_DOCKER:-0}" = 1 ]; then
            bash "$PL/scripts/build.sh"
        else
            # Without CI set, docker-build.sh builds their image and runs scripts/build.sh
            # (which clears out/ first, then does every step including ninja).
            env -u CI bash "$PL/scripts/docker-build.sh"
        fi
        log "build output: $PL/build/src/out/Default"
        ;;
    *)
        die "unknown command '$cmd' (all|setup|prep|part|sources)"
        ;;
esac
