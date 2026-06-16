#!/usr/bin/env bash
#
# check-bitwarden-placeholders.sh — guard against the issue-007 trap.
#
# A BitwardenSecret whose bwSecretId is a placeholder (or otherwise not a real
# Secrets-Manager UUID) syncs an EMPTY Kubernetes Secret while the operator still
# reports SuccessfulSync — which previously caused a Cloudflare-token / TLS outage
# (see docs/issues/007-bitwarden-secrets-swept-controller-managed.md). This check
# fails if any committed BitwardenSecret CR carries a bwSecretId that is empty, a
# known placeholder, or not UUID-shaped.
#
# NOTE: this is a repo-side guard only. It cannot detect a well-formed UUID that
# does not exist in Bitwarden — that requires Secrets-Manager access at sync time.
#
# Usage: scripts/check-bitwarden-placeholders.sh [dir]   (dir defaults below)
#
set -euo pipefail

dir="${1:-gitops/bitwarden-secrets}"
if [[ ! -d "$dir" ]]; then
  echo "check-bitwarden-placeholders: directory not found: $dir (nothing to check)"
  exit 0
fi

uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
# Known placeholder values that must never reach a committed manifest.
placeholders='00000000-0000-0000-0000-000000000000 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

fail=0
checked=0

while IFS= read -r file; do
  while IFS= read -r line; do
    val="$(printf '%s\n' "$line" \
      | sed -E 's/^[[:space:]]*-?[[:space:]]*bwSecretId:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//; s/^"//; s/"$//; s/^'\''//; s/'\''$//')"
    checked=$((checked + 1))
    lc="$(printf '%s' "$val" | tr '[:upper:]' '[:lower:]')"

    if [[ -z "$val" ]]; then
      echo "FAIL ${file}: empty bwSecretId" >&2
      fail=1
      continue
    fi
    if ! printf '%s\n' "$val" | grep -qE "$uuid_re"; then
      echo "FAIL ${file}: bwSecretId '${val}' is not a UUID (placeholder/typo?)" >&2
      fail=1
      continue
    fi
    for p in $placeholders; do
      if [[ "$lc" == "$p" ]]; then
        echo "FAIL ${file}: bwSecretId '${val}' is a known placeholder" >&2
        fail=1
      fi
    done
  done < <(grep -E '^[[:space:]]*-?[[:space:]]*bwSecretId:' "$file" 2>/dev/null || true)
done < <(find "$dir" -type f \( -name '*.yaml' -o -name '*.yml' \))

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "ERROR: placeholder/invalid bwSecretId would sync an EMPTY secret (see docs/issues/007)." >&2
  exit 1
fi

echo "OK: ${checked} bwSecretId value(s) checked, all well-formed UUIDs."
