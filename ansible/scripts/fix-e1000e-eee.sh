#!/usr/bin/env bash
# Fix Intel I217-V e1000e EEE hardware unit hang on all Proxmox nodes.
# Deploys a systemd oneshot service that disables EEE advertisement and
# hardware NIC offloads at boot. Takes effect immediately (no reboot needed).
#
# Ref: notes/issues/001-e1000e-eee-hang.md
#
# Usage:
#   ansible/scripts/fix-e1000e-eee.sh [--hosts <ansible_host_pattern>]
#
# Examples:
#   ansible/scripts/fix-e1000e-eee.sh
#   ansible/scripts/fix-e1000e-eee.sh --hosts cp3_pve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAYBOOK="${ANSIBLE_DIR}/playbooks/fix-e1000e-eee.yml"
TARGET_HOSTS="cp1_pve:cp2_pve:cp3_pve:worker1_pve"

usage() {
  grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts) TARGET_HOSTS="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

cd "${ANSIBLE_DIR}"

echo "==> Applying e1000e EEE fix to: ${TARGET_HOSTS}"
ansible-playbook \
  -i inventory/hosts.yml \
  -e "target_hosts=${TARGET_HOSTS}" \
  "${PLAYBOOK}"
