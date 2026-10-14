#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
manifest=${TABLET_MANIFEST:-$repo_dir/nix/android-tablet/apps.json}
adb_bin=${ADB_BIN:-adb}
adb_port=${ADB_PORT:-5037}
target=${ADB_TARGET:-$(jq -er '.device.adbTarget' "$manifest")}
source_file="$repo_dir/nix/android-tablet/start-wifi-adb.sh"
stage=/data/local/tmp/owl-start-wifi-adb.sh
boot_script=/data/adb/service.d/90-owl-wifi-adb.sh

adb_device() {
    "$adb_bin" -P "$adb_port" -s "$target" "$@" </dev/null
}

jq -e '.device.persistentWifiAdb == true and .device.wifiAdbPort == 5555' "$manifest" >/dev/null
actual_serial=$(adb_device shell getprop ro.serialno | tr -d '\r')
[[ "$actual_serial" = "$(jq -er '.device.serial' "$manifest")" ]]

if [[ "$adb_bin" = *.exe ]]; then
    source_file=$(wslpath -w "$source_file")
fi
adb_device push "$source_file" "$stage"
adb_device shell sh -n "$stage"
adb_device shell "su -c 'mkdir -p /data/adb/service.d && cp $stage $boot_script && chown 0:0 $boot_script && chmod 700 $boot_script && $boot_script'"
printf 'Persistent Wi-Fi ADB configured on port 5555; Android authorization remains required.\n'