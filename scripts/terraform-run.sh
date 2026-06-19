#!/usr/bin/env bash
# scripts/terraform-run.sh — run Terraform with Proxmox credentials from Bitwarden SM
#
# Mirrors the pattern of scripts/ansible-run.sh.
# The Proxmox root@pam password is fetched from Bitwarden SM and exported as
# PROXMOX_VE_PASSWORD before the terraform command runs. API-token auth is NOT
# used: tokens cannot set feature flags on privileged LXCs
# (see docs/issues/003-proxmox-api-token-passthrough-restriction.md).
#
# Usage:
#   scripts/terraform-run.sh <terraform args...>
#
# Examples:
#   scripts/terraform-run.sh -chdir=terraform/proxmox/technitium init
#   scripts/terraform-run.sh -chdir=terraform/proxmox/technitium plan
#   scripts/terraform-run.sh -chdir=terraform/proxmox/technitium apply -target=proxmox_virtual_environment_container.technitium
#
# Required environment variables:
#   BWS_ACCESS_TOKEN                       Bitwarden SM machine account token
#   PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID    BWS secret UUID for the root@pam password
#
# Optional environment variables:
#   PROXMOX_VE_ENDPOINT    default: https://10.0.10.3:8006/  (edge.pve — always-on UPS-backed node)
#   PROXMOX_VE_INSECURE    default: true
#   PROXMOX_VE_PASSWORD    if set, BWS lookup is skipped
#   PROXMOX_ROOT_PASSWORD  alias accepted for PROXMOX_VE_PASSWORD (e.g. sourced from env.secret)

set -euo pipefail

log()  { printf '%s\n' "$*" >&2; }
die()  { log "ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

[[ $# -gt 0 ]] || { log "Usage: $0 <terraform args...>"; exit 1; }

require_cmd terraform
require_cmd jq

: "${PROXMOX_VE_ENDPOINT:=https://10.0.10.3:8006/}"
: "${PROXMOX_VE_INSECURE:=true}"

# ---------------------------------------------------------------------------
# Auth strategy:
#   API tokens cannot set feature flags on privileged containers
#   (Proxmox restriction: "only allowed for root@pam").
#   Use root@pam username+password auth so Terraform runs as root@pam directly.
#   Password is fetched from Bitwarden SM.
# ---------------------------------------------------------------------------

if [[ -z "${PROXMOX_VE_PASSWORD:-}" ]]; then
  # Accept password set directly in env (e.g. sourced from env.secret)
  if [[ -n "${PROXMOX_ROOT_PASSWORD:-}" ]]; then
    PROXMOX_VE_PASSWORD="${PROXMOX_ROOT_PASSWORD}"
  else
    require_cmd bws
    [[ -n "${BWS_ACCESS_TOKEN:-}" ]]                  || die "BWS_ACCESS_TOKEN is not set"
    [[ -n "${PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID:-}" ]] || \
      die "PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID is not set"

    log "Fetching Proxmox root password from Bitwarden SM..."
    PROXMOX_VE_PASSWORD="$(
      bws secret get "${PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID}" --output json \
        | jq -r '.value'
    )"
    [[ -n "${PROXMOX_VE_PASSWORD}" && "${PROXMOX_VE_PASSWORD}" != "null" ]] \
      || die "BWS returned an empty value for PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID"
  fi
fi

PROXMOX_VE_USERNAME="${PROXMOX_VE_USERNAME:-root@pam}"

export PROXMOX_VE_ENDPOINT
export PROXMOX_VE_INSECURE
export PROXMOX_VE_USERNAME
export PROXMOX_VE_PASSWORD
# Unset token to ensure password auth is used
unset PROXMOX_VE_API_TOKEN

exec terraform "$@"
