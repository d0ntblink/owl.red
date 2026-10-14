#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
manifest=${TABLET_MANIFEST:-$repo_dir/nix/android-tablet/apps.json}
output_dir=${TABLET_INVENTORY_DIR:-$repo_dir/nix/android-tablet/installed-apps}
host=${TABLET_HOST:-$(jq -er '.device.adbTarget | split(":")[0]' "$manifest")}
login=${SSH_USER:-$(jq -er '.device.sshUser' "$manifest")}
port=${SSH_PORT:-$(jq -er '.device.sshPort' "$manifest")}
identity=${SSH_IDENTITY_FILE:-$HOME/.ssh/id_ed25519_owl_ansible}
known_hosts=${SSH_KNOWN_HOSTS:-${XDG_CACHE_HOME:-$HOME/.cache}/owl-red/android-tablet/known_hosts}
expected_serial=$(jq -er '.device.serial' "$manifest")
[[ "$expected_serial" =~ ^[A-Za-z0-9_-]+$ ]]

ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o IdentitiesOnly=yes
    -o StrictHostKeyChecking=yes -i "$identity" -p "$port")
if [[ -f "$known_hosts" ]]; then
    ssh_options+=(-o "UserKnownHostsFile=$known_hosts")
fi

raw=$(ssh "${ssh_options[@]}" "$login@$host" \
    '/sbin/su -c "getprop ro.serialno && getprop ro.build.display.id && pm list packages -f --show-versioncode --user 0"' | tr -d '\r')
serial=$(printf '%s\n' "$raw" | sed -n '1p')
firmware=$(printf '%s\n' "$raw" | sed -n '2p')
[[ "$serial" = "$expected_serial" && -n "$firmware" ]]
captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
filename="$serial.json"

umask 077
mkdir -p "$output_dir"
temporary=$(mktemp "$output_dir/.inventory.XXXXXX")
trap 'rm -f "$temporary"' EXIT

printf '%s\n' "$raw" | sed '1,2d' | jq -Rn \
    --arg capturedAt "$captured_at" --arg serial "$serial" \
    --arg firmware "$firmware" --arg host "$host" '
    "^package:(?<apkPath>.+)=(?<package>[^=[:space:]]+) versionCode:(?<versionCode>[0-9]+)$" as $pattern |
    [inputs | select(length > 0) |
      if test($pattern) then capture($pattern) | .versionCode |= tonumber
      else error("Unrecognized package-manager output: " + .) end
    ] | sort_by(.package) as $packages |
    if ($packages | length) == 0 then error("Empty package inventory")
    elif ($packages | length) != ($packages | unique_by(.package) | length) then error("Duplicate package IDs")
    else {
      schemaVersion: 1, capturedAt: $capturedAt, serial: $serial,
      firmware: $firmware, observedHost: $host, androidUser: 0,
      source: "pm list packages -f --show-versioncode --user 0",
      packageCount: ($packages | length), packages: $packages
    } end' > "$temporary"

jq -e '.packageCount == (.packages | length) and .packageCount > 0' "$temporary" >/dev/null

mv -fT -- "$temporary" "$output_dir/$filename"
trap - EXIT
printf 'Recorded %s packages: %s\n' "$(jq -r '.packageCount' "$output_dir/$filename")" "$output_dir/$filename"