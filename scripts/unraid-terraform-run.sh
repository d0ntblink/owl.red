#!/usr/bin/env bash
# unraid-terraform-run.sh — run terraform for terraform/unraid with the Unraid GraphQL
# API key from Bitwarden and a CA bundle that trusts the self-signed nas.owl.red cert.
# Mirrors scripts/terraform-run.sh. Read-only commands (plan) are safe; apply changes the NAS.
#
# Usage:  scripts/unraid-terraform-run.sh <plan|apply|init|...>
# Env:    BW_SESSION (bw unlocked); optional UNRAID_KEY_BW_ITEM, TF_VAR_unraid_api_key
set -euo pipefail
log() { printf '[unraid-tf] %s\n' "$*" >&2; }
die() { printf '[unraid-tf] ERROR: %s\n' "$*" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOD="$HERE/../terraform/unraid"
BUNDLE="$HOME/.certs/owl-bundle.pem"
UNRAID_KEY_BW_ITEM="${UNRAID_KEY_BW_ITEM:-56ea6570-7420-4172-a600-b46e00397fde}"

command -v terraform >/dev/null 2>&1 || die "terraform not found"

# 1) hostname must resolve to the LAN IP (cert CN match)
if ! getent hosts nas.owl.red 2>/dev/null | grep -q '10.0.10.5'; then
  log "WARN: nas.owl.red does not resolve to 10.0.10.5. Add it: echo '10.0.10.5 nas.owl.red' | sudo tee -a /etc/hosts"
fi

# 2) CA bundle trusting the self-signed nas.owl.red cert
if [ ! -s "$BUNDLE" ]; then
  log "building CA bundle $BUNDLE"
  mkdir -p "$(dirname "$BUNDLE")"; : > "$BUNDLE"
  [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt >> "$BUNDLE"
  [ -f "$HOME/.certs/zscaler.pem" ] && cat "$HOME/.certs/zscaler.pem" >> "$BUNDLE"
  echo | openssl s_client -connect 10.0.10.5:443 -servername nas.owl.red 2>/dev/null | openssl x509 >> "$BUNDLE" 2>/dev/null || true
fi
export SSL_CERT_FILE="$BUNDLE"

# 3) API key from Bitwarden (unless already provided)
if [ -z "${TF_VAR_unraid_api_key:-}" ]; then
  [ -n "${BW_SESSION:-}" ] || die "BW_SESSION not set (run: export BW_SESSION=\$(bw unlock --raw))"
  export TF_VAR_unraid_api_key="$(bw get password "$UNRAID_KEY_BW_ITEM" --session "$BW_SESSION")"
  [ -n "$TF_VAR_unraid_api_key" ] || die "could not fetch Unraid API key from bw"
fi

exec terraform -chdir="$MOD" "$@"
