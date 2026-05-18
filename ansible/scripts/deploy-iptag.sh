#!/usr/bin/env bash
# Deploy IP-Tag service on all Proxmox nodes.
# Tags each QEMU VM and LXC container in the PVE web UI with its IP address.
# Runs as a persistent systemd service, updates every 5 minutes.
#
# Usage:
#   ansible/scripts/deploy-iptag.sh [--hosts <pattern>]
#
# Examples:
#   ansible/scripts/deploy-iptag.sh
#   ansible/scripts/deploy-iptag.sh --hosts cp1_pve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAYBOOK="${ANSIBLE_DIR}/playbooks/deploy-iptag.yml"
TARGET_HOSTS="cp1_pve:cp2_pve:cp3_pve:worker1_pve"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts) TARGET_HOSTS="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

cd "${ANSIBLE_DIR}"
echo "==> Deploying IP-Tag service to: ${TARGET_HOSTS}"
ansible-playbook \
  -i inventory/hosts.yml \
  -e "target_hosts=${TARGET_HOSTS}" \
  "${PLAYBOOK}"
