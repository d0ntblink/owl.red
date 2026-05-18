#!/usr/bin/env bash
# Harden Proxmox node GRUB kernel parameters for Haswell/M73 stability.
# Applies: pcie_aspm=off intel_idle.max_cstate=3 intel_iommu=on iommu=pt
# Idempotent: safe to re-run.
#
# NOTE: Changes require a reboot to take effect. Reboot nodes one at a time
# to maintain etcd quorum (always keep 2/3 control-plane nodes running).
# Suggested order: worker1 -> cp3 -> cp2 -> cp1
#
# Ref: notes/issues/001-e1000e-eee-hang.md
#
# Usage:
#   ansible/scripts/fix-grub-kernel-params.sh [--hosts <ansible_host_pattern>]
#
# Examples:
#   ansible/scripts/fix-grub-kernel-params.sh
#   ansible/scripts/fix-grub-kernel-params.sh --hosts worker1_pve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAYBOOK="${ANSIBLE_DIR}/playbooks/fix-grub-kernel-params.yml"
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

echo "==> Applying GRUB kernel param hardening to: ${TARGET_HOSTS}"
echo "    (Reboot each node after for changes to take effect)"
ansible-playbook \
  -i inventory/hosts.yml \
  -e "target_hosts=${TARGET_HOSTS}" \
  "${PLAYBOOK}"
