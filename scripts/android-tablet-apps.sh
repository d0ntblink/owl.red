#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
manifest=${TABLET_MANIFEST:-$repo_dir/nix/android-tablet/apps.json}
cache_dir=${TABLET_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/owl-red/android-tablet}
adb_bin=${ADB_BIN:-adb}
adb_port=${ADB_PORT:-5037}
mode=${1:-install}

case "$mode" in
    install|download) ;;
    *) printf 'Usage: %s [install|download]\n' "$0" >&2; exit 2 ;;
esac

for dependency in jq curl gpg sha256sum; do
    command -v "$dependency" >/dev/null
done
umask 077
mkdir -p "$cache_dir/gnupg"
chmod 700 "$cache_dir/gnupg"
fingerprint=$(jq -er '.fdroidSigningKey' "$manifest")

if ! gpg --homedir "$cache_dir/gnupg" --batch --list-keys "$fingerprint" >/dev/null 2>&1; then
    gpg --homedir "$cache_dir/gnupg" --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys "$fingerprint"
fi
actual_fingerprint=$(gpg --homedir "$cache_dir/gnupg" --batch --with-colons --fingerprint "$fingerprint" | awk -F: '$1 == "fpr" { print $10; exit }')
[[ "$actual_fingerprint" = "$fingerprint" ]]

adb_command() {
    "$adb_bin" -P "$adb_port" "$@" </dev/null
}

if [[ "$mode" = install ]]; then
    command -v "$adb_bin" >/dev/null
    target=${ADB_TARGET:-$(jq -er '.device.adbTarget' "$manifest")}
    expected_serial=$(jq -er '.device.serial' "$manifest")
    if [[ "$target" = *:* ]]; then
        adb_command connect "$target"
    fi
    actual_serial=$(adb_command -s "$target" shell getprop ro.serialno | tr -d '\r')
    [[ "$actual_serial" = "$expected_serial" ]]
fi

while IFS=$'\t' read -r package version_code url; do
    if [[ "$mode" = install ]]; then
        installed_version=$(adb_command -s "$target" shell pm list packages --show-versioncode "$package" | tr -d '\r' | awk -v wanted="package:$package" '$1 == wanted { sub(/^versionCode:/, "", $2); print $2 }')
        if [[ "$installed_version" =~ ^[0-9]+$ ]] && (( installed_version >= version_code )); then
            printf 'Already installed: %s (%s)\n' "$package" "$installed_version"
            continue
        fi
    fi

    apk="$cache_dir/${package}_${version_code}.apk"
    if [[ ! -f "$apk" ]]; then
        curl --fail --location --retry 2 --connect-timeout 15 --max-time 600 --output "$apk.part" "$url"
        mv "$apk.part" "$apk"
    fi
    curl --fail --silent --show-error --location --retry 2 --connect-timeout 15 --max-time 60 --output "$apk.asc" "$url.asc"
    gpg --homedir "$cache_dir/gnupg" --batch --verify "$apk.asc" "$apk"
    sha256sum "$apk"

    if [[ "$mode" = install ]]; then
        install_path=$apk
        if [[ "$adb_bin" = *.exe ]]; then
            install_path=$(wslpath -w "$apk")
        fi
        adb_command -s "$target" install -r "$install_path"
        installed_version=$(adb_command -s "$target" shell pm list packages --show-versioncode "$package" | tr -d '\r' | awk -v wanted="package:$package" '$1 == wanted { sub(/^versionCode:/, "", $2); print $2 }')
        [[ "$installed_version" = "$version_code" ]]
        printf 'Verified installed: %s (%s)\n' "$package" "$installed_version"
    fi
done < <(jq -r '.apps[] | [.package, (.versionCode | tostring), .url] | @tsv' "$manifest")

if [[ "$mode" = install ]]; then
    browser_package=$(jq -r '.device.browserPackage // empty' "$manifest")
    if [[ -n "$browser_package" ]]; then
        adb_command -s "$target" shell cmd role add-role-holder --user 0 android.app.role.BROWSER "$browser_package"
    fi
    launcher_package=$(jq -r '.device.launcherPackage // empty' "$manifest")
    if [[ -n "$launcher_package" ]]; then
        adb_command -s "$target" shell cmd role add-role-holder --user 0 android.app.role.HOME "$launcher_package"
    fi
    input_method=$(jq -r '.device.inputMethod // empty' "$manifest")
    if [[ -n "$input_method" ]]; then
        adb_command -s "$target" shell ime enable "$input_method"
        adb_command -s "$target" shell ime set "$input_method"
    fi
fi