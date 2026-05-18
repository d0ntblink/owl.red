#!/usr/bin/env bash
# Deploy monitor-all QEMU watchdog on the cluster primary node (cp1).
# Restarts QEMU VMs that stop responding to QEMU guest agent ping.
# LXC containers are excluded. Opt-in via the 'mon-restart' tag.
#
# WARNING: Only run on ONE node. Running on multiple nodes causes duplicate restarts.
#
# Usage:
#   ansible/scripts/deploy-monitor-all.sh [--host <single_host>]
#
# Examples:
#   ansible/scripts/deploy-monitor-all.sh
#   ansible/scripts/deploy-monitor-all.sh --host cp1_pve

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANSIBLE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLAYBOOK="${ANSIBLE_DIR}/playbooks/deploy-monitor-all.yml"
TARGET_HOST="cp1_pve"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) TARGET_HOST="$2"; shift 2 ;;
    -h|--help) grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

cd "${ANSIBLE_DIR}"
echo "==> Deploying monitor-all watchdog to: ${TARGET_HOST}"
echo "    (QEMU VMs only — LXC excluded. Opt-in via: qm set <vmid> -tags mon-restart)"
ansible-playbook \
  -i inventory/hosts.yml \
  -e "target_host=${TARGET_HOST}" \
  "${PLAYBOOK}"
