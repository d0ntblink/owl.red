#!/usr/bin/env bash
# owl-controller-bootstrap.sh — prepare this control node to run owl.red Ansible.
#
# Idempotent and non-mutating to infrastructure: installs Ansible (pipx), pulls the
# ansible SSH private key from Bitwarden Password Manager (bw) to ~/.ssh, and checks
# the environment. Safe to re-run.
#
# Usage:
#   export BW_SESSION="$(bw unlock --raw)"     # unlock bw first (to read the key)
#   ./scripts/owl-controller-bootstrap.sh
#
# Env:
#   BW_SSH_KEY_ITEM   bw item holding the ansible SSH private key
#                     (default: "owl-red ansible ssh key"). Override to match your vault.
#   BWS_ACCESS_TOKEN  Bitwarden SM token (only checked here; used by api_enabled runs).
set -euo pipefail

KEY_PATH="${HOME}/.ssh/id_ed25519_owl_ansible"
BW_SSH_KEY_ITEM="${BW_SSH_KEY_ITEM:-id_ed25519_owl_ansible}"

log() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

# 1) Ansible
if command -v ansible-playbook >/dev/null 2>&1; then
  log "ansible present: $(ansible --version | head -n1)"
else
  command -v pipx >/dev/null 2>&1 || die "pipx not found; 'sudo apt install -y pipx' (or 'pip install --user pipx') then re-run"
  log "installing ansible via pipx ..."
  pipx install --include-deps ansible
fi

# 2) SSH key from bw
if [[ -f "$KEY_PATH" ]]; then
  log "ssh key already present: $KEY_PATH"
else
  command -v bw >/dev/null 2>&1 || die "bw (Bitwarden CLI) not found"
  command -v jq >/dev/null 2>&1 || die "jq not found"
  [[ -n "${BW_SESSION:-}" ]] || die "bw is locked; run: export BW_SESSION=\$(bw unlock --raw)"
  log "retrieving ansible SSH key from bw item: '$BW_SSH_KEY_ITEM'"
  mkdir -p "${HOME}/.ssh"; chmod 700 "${HOME}/.ssh"
  # SSH-key item type exposes .sshKey.privateKey; secure notes fall back to .notes.
  bw get item "$BW_SSH_KEY_ITEM" 2>/dev/null \
    | jq -r '.sshKey.privateKey // .notes // empty' > "$KEY_PATH" || true
  [[ -s "$KEY_PATH" ]] || die "could not extract a private key from bw item '$BW_SSH_KEY_ITEM' (check the item name/type)"
  chmod 600 "$KEY_PATH"
  log "wrote $KEY_PATH"
fi

# 3) Environment sanity
[[ -n "${NODE_EXTRA_CA_CERTS:-}" ]] || log "WARN: NODE_EXTRA_CA_CERTS unset — bw/bws may fail TLS behind Zscaler"
[[ -n "${BWS_ACCESS_TOKEN:-}" ]] || log "NOTE: BWS_ACCESS_TOKEN unset — needed only for api_enabled=true runs"

log "done. NOTE: this repo is on a world-writable mount, so set ANSIBLE_CONFIG explicitly:"
log "  export ANSIBLE_CONFIG=ansible/ansible.cfg"
log "smoke test:"
log "  ANSIBLE_CONFIG=ansible/ansible.cfg ansible -i ansible/inventory/hosts.yml nas_unraid -m raw -a 'uname -a'"
