#!/usr/bin/env bash
# opnsense-terraform-run.sh — run terraform for terraform/opnsense with the dedicated
# least-privilege OPNsense "terraform" API key/secret pulled from Bitwarden.
# Mirrors scripts/unraid-terraform-run.sh. The provider talks to the OPNsense API over
# HTTPS with allow_unverified=true, so NO CA bundle is required (unlike the NAS lane).
#
# Read-only commands (init, validate, plan) are safe; `apply` changes the ROUTER.
# Per the standing directive, never apply against OPNsense without explicit go, and
# IMPORT existing aliases/overrides before the first apply (see docs/guides/proxmox-* / ADR).
#
# Usage:  scripts/opnsense-terraform-run.sh <plan|apply|init|import|...>
# Env:    BW_SESSION (bw unlocked); optional OPNSENSE_KEY_BW_ITEM,
#         TF_VAR_opnsense_api_key / TF_VAR_opnsense_api_secret (skip the bw fetch)
set -euo pipefail
log() { printf '[opnsense-tf] %s\n' "$*" >&2; }
die() { printf '[opnsense-tf] ERROR: %s\n' "$*" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOD="$HERE/../terraform/opnsense"
# bw item "OPNsense — terraform": key=/secret= live in the item NOTES field.
OPNSENSE_KEY_BW_ITEM="${OPNSENSE_KEY_BW_ITEM:-6c8c8a36-c16e-4e02-8d8e-b46e00685e7f}"

command -v terraform >/dev/null 2>&1 || die "terraform not found"

# API key + secret from Bitwarden (unless both already provided)
if [ -z "${TF_VAR_opnsense_api_key:-}" ] || [ -z "${TF_VAR_opnsense_api_secret:-}" ]; then
  [ -n "${BW_SESSION:-}" ] || die "BW_SESSION not set (run: export BW_SESSION=\$(bw unlock --raw))"
  NOTES="$(bw get item "$OPNSENSE_KEY_BW_ITEM" --session "$BW_SESSION" | jq -r '.notes // ""')"
  TF_VAR_opnsense_api_key="$(printf '%s\n' "$NOTES" | sed -n 's/^[[:space:]]*[Kk]ey[[:space:]]*[=:][[:space:]]*//p' | head -1 | tr -d '\r"')"
  TF_VAR_opnsense_api_secret="$(printf '%s\n' "$NOTES" | sed -n 's/^[[:space:]]*[Ss]ecret[[:space:]]*[=:][[:space:]]*//p' | head -1 | tr -d '\r"')"
  export TF_VAR_opnsense_api_key TF_VAR_opnsense_api_secret
  [ -n "$TF_VAR_opnsense_api_key" ]    || die "could not parse 'key=' from bw item notes ($OPNSENSE_KEY_BW_ITEM)"
  [ -n "$TF_VAR_opnsense_api_secret" ] || die "could not parse 'secret=' from bw item notes ($OPNSENSE_KEY_BW_ITEM)"
fi

exec terraform -chdir="$MOD" "$@"
