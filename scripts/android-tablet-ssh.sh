#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
config_dir="$repo_dir/nix/android-tablet"
adb_bin=${ADB_BIN:-adb}
adb_port=${ADB_PORT:-5037}
target=${ADB_TARGET:-$(jq -er '.device.adbTarget' "$config_dir/apps.json")}
public_key=${SSH_PUBLIC_KEY:-$HOME/.ssh/id_ed25519_owl_ansible.pub}
stage=/data/local/tmp/owl-tablet-ssh
termux_home=/data/data/com.termux/files/home
termux_prefix=/data/data/com.termux/files/usr

adb_device() {
    "$adb_bin" -P "$adb_port" -s "$target" "$@" </dev/null
}

push_file() {
    local source=$1 destination=$2
    if [[ "$adb_bin" = *.exe ]]; then
        source=$(wslpath -w "$source")
    fi
    adb_device push "$source" "$destination"
}

ssh-keygen -lf "$public_key"
actual_serial=$(adb_device shell getprop ro.serialno | tr -d '\r')
[[ "$actual_serial" = "$(jq -er '.device.serial' "$config_dir/apps.json")" ]]
adb_device shell su -c "test -x $termux_prefix/bin/bash"
termux_uid=$(adb_device shell su -c 'stat -c %u /data/data/com.termux' | tr -d '\r')
[[ "$termux_uid" =~ ^[0-9]+$ ]] && (( termux_uid >= 10000 ))

adb_device shell mkdir -p "$stage"
push_file "$public_key" "$stage/public-key.pub"
push_file "$config_dir/sshd_config" "$stage/sshd_config"
push_file "$config_dir/start-sshd" "$stage/start-sshd"
push_file "$config_dir/setup-termux-ssh" "$stage/setup-termux-ssh"
adb_device shell "su -c 'mkdir -p $termux_home/.cache/owl-ssh && cp $stage/public-key.pub $stage/sshd_config $stage/start-sshd $stage/setup-termux-ssh $termux_home/.cache/owl-ssh/ && chown -R $termux_uid:$termux_uid $termux_home/.cache/owl-ssh && chmod 700 $termux_home/.cache/owl-ssh && chmod 600 $termux_home/.cache/owl-ssh/*'"
restore_termux_labels() {
    adb_device shell su -c 'restorecon -RF /data/data/com.termux'
}
trap restore_termux_labels EXIT
restore_termux_labels
adb_device shell "su --drop-cap -g $termux_uid -G 3003 $termux_uid -c 'HOME=$termux_home PREFIX=$termux_prefix TMPDIR=$termux_prefix/tmp PATH=$termux_prefix/bin:/system/bin $termux_prefix/bin/bash $termux_home/.cache/owl-ssh/setup-termux-ssh $termux_home/.cache/owl-ssh'"
restore_termux_labels
trap - EXIT
adb_device shell dumpsys deviceidle whitelist +com.termux
adb_device shell am start -n com.termux.boot/.BootActivity
printf 'Configuration ready. Run ~/.termux/boot/00-sshd once inside Termux to start SSH in its normal app sandbox.\n'