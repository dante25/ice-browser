#!/bin/bash
# Ice hook for ungoogled-chromium-portablelinux 156.0.8078.79-1.
#
# core-build/build.sh copies this file to <portablelinux>/ice/ice-hook.sh and appends
#   . "$(repo_root)/ice/ice-hook.sh"
# to <portablelinux>/scripts/shared.sh. Both of their entry points (scripts/build.sh
# for local builds, .github/scripts/build.sh for CI) source shared.sh, so the two
# wrappers below take effect everywhere without editing their function bodies:
#
#   apply_patches = upstream apply_patches (prune + ungoogled + portablelinux series)
#                   + ice_apply_patches (core-build/patches/ice-*.patch, sorted)
#                   -> runs BEFORE apply_domsub, like every ungoogled patch.
#   gn_gen        = upstream gn_gen + ice_compile_check (compile only the objects of
#                   the .cc files our patches touch, so C++ errors fail early).
#
# Runs inside their Docker image (bash, patch, ninja available), with /repo = portablelinux.

if [ -n "${_ICE_HOOK_LOADED:-}" ]; then
    return 0
fi
_ICE_HOOK_LOADED=1

# Settings written by core-build/build.sh (docker-build.sh does not forward ICE_* env vars).
if [ -f "$(repo_root)/ice/env.sh" ]; then
    . "$(repo_root)/ice/env.sh"
fi

ice_patch_files() {
    local d="${_root}/ice/patches"
    [ -d "$d" ] || return 0
    find "$d" -maxdepth 1 -type f -name 'ice-*.patch' | LC_ALL=C sort
}

ice_apply_patches() {
    local stamp="${_src_dir}/.ice-patched.stamp"
    local -a patches
    mapfile -t patches < <(ice_patch_files)
    local digest
    digest="$( { [ "${#patches[@]}" -eq 0 ] || cat "${patches[@]}"; ice_branding_digest; } | sha256sum | cut -d' ' -f1)"

    if [ -f "${stamp}" ]; then
        if [ "$(cat "${stamp}")" = "${digest}" ]; then
            echo "[ice] Ice patches already applied, skipping"
            return 0
        fi
        echo "[ice] ERROR: ${_src_dir} was patched with a different set of Ice patches." >&2
        echo "[ice] Delete ${_src_dir} (it is re-extracted from the download cache) and rebuild." >&2
        exit 1
    fi
    if [ "${#patches[@]}" -eq 0 ]; then
        if [ "${ICE_ALLOW_NO_PATCHES:-0}" = 1 ]; then
            echo "[ice] WARNING: no ice-*.patch files, building plain ungoogled-chromium"
            echo "${digest}" > "${stamp}"
            return 0
        fi
        echo "[ice] ERROR: no ice-*.patch files in ${_root}/ice/patches" >&2
        exit 1
    fi

    local marker="${_src_dir}/.ice-patching.marker"
    touch "${marker}"
    local p n=0
    for p in "${patches[@]}"; do
        n=$((n + 1))
        echo "[ice] * Applying $(basename "$p") (${n}/${#patches[@]})"
        if ! patch -p1 --forward --batch --no-backup-if-mismatch -d "${_src_dir}" -i "$p"; then
            echo "[ice] ERROR: patch $(basename "$p") did not apply cleanly (see FAILED hunks above)." >&2
            local rej
            find "${_src_dir}" -name '*.rej' -newer "${marker}" -print 2>/dev/null | head -20 | while read -r rej; do
                echo "----- ${rej#"${_src_dir}"/}" >&2
                head -100 "$rej" >&2
            done
            echo "[ice] The tree is now partially patched; delete ${_src_dir} before retrying." >&2
            exit 1
        fi
    done

    # A hunk applied with fuzz is accepted by patch(1); a leftover .rej never is.
    local rejects
    rejects="$(find "${_src_dir}" -name '*.rej' -newer "${marker}" -print 2>/dev/null)"
    if [ -n "${rejects}" ]; then
        echo "[ice] ERROR: .rej files found after applying Ice patches:" >&2
        echo "${rejects}" | head -50 >&2
        exit 1
    fi
    rm -f "${marker}"

    ice_install_builtins_inc
    ice_install_branding
    ice_rebrand_strings

    echo "${digest}" > "${stamp}"
    echo "[ice] Applied ${#patches[@]} Ice patch(es)"
}

# chrome/browser/extensions/ice_builtins_files.inc (SHA-256 list of every built-in file,
# compiled into ice_builtins.cc). core-build/build.sh generates it on the host with
#   python3 core-build/gen-ice-builtins-files.py <repo root> <portablelinux>/ice/ice_builtins_files.inc
# because the Ice repo (extension sources) is not mounted in the container; here it is
# copied into the patched tree, before domain substitution and gn gen.
ice_install_builtins_inc() {
    local inc="${_root}/ice/ice_builtins_files.inc"
    local dst="${_src_dir}/chrome/browser/extensions/ice_builtins_files.inc"
    [ -s "${inc}" ] || { echo "[ice] ERROR: ${inc} missing (run core-build/build.sh setup)" >&2; exit 1; }
    [ -d "$(dirname "${dst}")" ] || { echo "[ice] ERROR: $(dirname "${dst}") missing" >&2; exit 1; }
    cp "${inc}" "${dst}"
    echo "[ice] installed ice_builtins_files.inc ($(grep -c '^    {' "${dst}") files)"
}

# Branding inputs, part of the "already patched" digest.
ice_branding_digest() {
    local d="${_root}/ice/branding"
    [ ! -d "$d" ] || (cd "$d" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0r sha256sum)
    [ ! -f "${_root}/ice/ice-rebrand.py" ] || sha256sum < "${_root}/ice/ice-rebrand.py"
}

# Binary branding (Ice logos) can't go in a text patch: core-build/build.sh copies
# core-build/branding/ (same relative paths as under src/) to <portablelinux>/ice/branding,
# copied here over the patched tree. Only existing files are replaced.
ice_install_branding() {
    local d="${_root}/ice/branding"
    [ -d "$d" ] || { echo "[ice] ERROR: $d missing (run core-build/build.sh setup)" >&2; exit 1; }
    local f n=0
    while IFS= read -r -d '' f; do
        f="${f#./}"
        [ -f "${_src_dir}/${f}" ] || { echo "[ice] ERROR: branding file has no original in src/: ${f}" >&2; exit 1; }
        cp "$d/$f" "${_src_dir}/${f}"
        n=$((n + 1))
    done < <(cd "$d" && find . -type f -print0)
    echo "[ice] installed ${n} branding file(s)"
}

# "Chromium" -> "Ice" in the UI strings (English + translations), see core-build/ice-rebrand.py.
ice_rebrand_strings() {
    local py="${_root}/ice/ice-rebrand.py"
    [ -f "${py}" ] || { echo "[ice] ERROR: ${py} missing (run core-build/build.sh setup)" >&2; exit 1; }
    python3 -I "${py}" "${_src_dir}" || { echo "[ice] ERROR: ice-rebrand.py failed" >&2; exit 1; }
}

# Prints "<new|mod> <path>" for every C++ source our patches add/modify, plus
# the sibling .cc of every modified header. Paths are relative to src/.
ice_patched_sources() {
    local -a patches
    mapfile -t patches < <(ice_patch_files)
    [ "${#patches[@]}" -gt 0 ] || return 0
    awk '
        /^--- /   { old = $2 }
        /^\+\+\+ / {
            p = $2; sub(/^b\//, "", p)
            if (p ~ /\.(cc|cpp|cxx)$/) {
                if (old == "/dev/null") print 0, "new", p; else print 1, "mod", p
            } else if (p ~ /\.h$/) { sub(/\.h$/, ".cc", p); print 2, "hdr", p }
        }' "${patches[@]}" | sort -k3,3 -k1,1n | awk '!seen[$3]++ { print $2, $3 }'
}

ice_compile_check() {
    if [ "${ICE_COMPILE_CHECK:-1}" = 0 ]; then
        echo "[ice] compile check disabled (ICE_COMPILE_CHECK=0)"
        return 0
    fi
    cd "${_src_dir}"

    local -a targets=()
    local kind f missing=0
    while read -r kind f; do
        [ -n "$f" ] || continue
        if [ "$kind" = hdr ] && [ ! -f "$f" ]; then
            continue
        fi
        if ninja -C out/Default -t query "../../$f" >/dev/null 2>&1; then
            targets+=("../../$f^")
            echo "[ice] compile check: $f"
        elif [ "$kind" = new ]; then
            echo "[ice] ERROR: $f is added by an Ice patch but is not part of the build graph (missing from BUILD.gn sources?)" >&2
            missing=1
        elif [ "$kind" = mod ]; then
            echo "[ice] note: $f is not built in this configuration, skipping"
        fi
    done < <(ice_patched_sources)

    if [ "$missing" -ne 0 ]; then
        exit 1
    fi
    # Extra ninja targets (e.g. WebUI type checks), space separated.
    local t
    for t in ${ICE_CHECK_TARGETS:-}; do
        targets+=("$t")
        echo "[ice] compile check: target $t"
    done
    if [ "${#targets[@]}" -eq 0 ]; then
        echo "[ice] compile check: no C++ sources touched by Ice patches"
        return 0
    fi

    local timeout_s="${ICE_COMPILE_CHECK_TIMEOUT:-9000}"
    echo "[ice] compile check: building ${#targets[@]} object(s) (timeout ${timeout_s}s)"
    local rc=0
    timeout -k 2m -s INT "${timeout_s}" ninja -C out/Default "${targets[@]}" || rc=$?
    if [ "$rc" -eq 124 ]; then
        echo "[ice] WARNING: compile check timed out after ${timeout_s}s (generated-header dependencies not finished); the full build will report errors instead"
        return 0
    elif [ "$rc" -ne 0 ]; then
        echo "[ice] ERROR: compile check failed (ninja exit ${rc}) - fix the C++ in core-build/patches" >&2
        exit "$rc"
    fi
    echo "[ice] compile check passed"
}

eval "_ice_upstream_$(declare -f apply_patches)"
eval "_ice_upstream_$(declare -f gn_gen)"

apply_patches() {
    _ice_upstream_apply_patches
    ice_apply_patches
}

gn_gen() {
    _ice_upstream_gn_gen
    ice_compile_check
}
