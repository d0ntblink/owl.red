#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
}

usage() {
  cat <<'EOF'
Usage:
  scripts/ansible-run.sh <command> [args...]

Description:
  Resolves PROXMOX_ROOT_PASSWORD from Bitwarden before executing the command.
  Secret source order is controlled by PROXMOX_PASSWORD_SOURCE:
    - auto (default): try bws, then bw
    - bws: Bitwarden Secrets Manager CLI only
    - bw:  Bitwarden Password Manager CLI only

Environment variables:
  PROXMOX_PASSWORD_SOURCE              auto|bws|bw
  PROXMOX_ROOT_PASSWORD                If set, secret lookup is skipped
  PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID  Secret UUID for bws lookup
  BWS_ACCESS_TOKEN                     Access token for bws
  PROXMOX_ROOT_PASSWORD_BW_ITEM        Vault item ID or unique name for bw get password
  BW_PASSWORD                          Optional master password env for non-interactive unlock

Examples:
  export PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID="<secret-uuid>"
  scripts/ansible-run.sh ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/02-proxmox-prep.yml

  export PROXMOX_PASSWORD_SOURCE=bw
  export PROXMOX_ROOT_PASSWORD_BW_ITEM="proxmox-root-password"
  scripts/ansible-run.sh ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/02-proxmox-prep.yml
EOF
}

get_secret_from_bws() {
  local secret_id="${PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID:-}"
  [[ -n "${BWS_ACCESS_TOKEN:-}" ]] || return 1
  [[ -n "$secret_id" ]] || return 1

  require_cmd bws
  require_cmd jq

  local value
  value="$(bws secret get "$secret_id" --output json | jq -r '.value')"
  [[ -n "$value" && "$value" != "null" ]] || return 1
  printf '%s' "$value"
}

bw_status() {
  bw status | jq -r '.status'
}

ensure_bw_session() {
  require_cmd bw
  require_cmd jq

  local status
  status="$(bw_status)"

  if [[ "$status" == "unauthenticated" ]]; then
    log "Bitwarden CLI is unauthenticated. Running 'bw login --apikey'."
    bw login --apikey >/dev/null
    status="$(bw_status)"
  fi

  if [[ -z "${BW_SESSION:-}" ]]; then
    if [[ -n "${BW_PASSWORD:-}" ]]; then
      BW_SESSION="$(bw unlock --passwordenv BW_PASSWORD --raw)"
    else
      BW_SESSION="$(bw unlock --raw)"
    fi
    export BW_SESSION
  fi

  [[ -n "${BW_SESSION:-}" ]] || die "Unable to unlock Bitwarden vault and obtain BW_SESSION."
}

get_secret_from_bw() {
  local item_ref="${PROXMOX_ROOT_PASSWORD_BW_ITEM:-proxmox-root-password}"
  [[ -n "$item_ref" ]] || return 1

  ensure_bw_session

  local value
  value="$(bw get password "$item_ref" --session "$BW_SESSION" | tr -d '\r\n')"
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  local source="${PROXMOX_PASSWORD_SOURCE:-auto}"
  local password="${PROXMOX_ROOT_PASSWORD:-}"

  if [[ -z "$password" ]]; then
    case "$source" in
      bws)
        password="$(get_secret_from_bws)" || die "Failed to retrieve secret using bws."
        ;;
      bw)
        password="$(get_secret_from_bw)" || die "Failed to retrieve secret using bw."
        ;;
      auto)
        if ! password="$(get_secret_from_bws 2>/dev/null)"; then
          password="$(get_secret_from_bw)" || die "Failed to retrieve secret from bws and bw."
        fi
        ;;
      *)
        die "Invalid PROXMOX_PASSWORD_SOURCE: $source (expected auto|bws|bw)"
        ;;
    esac
  fi

  [[ -n "$password" ]] || die "PROXMOX_ROOT_PASSWORD is empty after lookup."

  export PROXMOX_ROOT_PASSWORD="$password"
  export ANSIBLE_PASSWORD="${ANSIBLE_PASSWORD:-$password}"

  local cmd_basename
  cmd_basename="$(basename -- "$1")"

  if [[ "$cmd_basename" == "ansible" || "$cmd_basename" == "ansible-playbook" ]]; then
    exec "$@"
  fi

  exec "$@"
}

main "$@"