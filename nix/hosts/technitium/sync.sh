#!/usr/bin/env bash
# Technitium full-sync — applies ALL GitOps config from the owl.red repo.
# Covers: server settings, DNS zones, DHCP scopes, DHCP reservations.
#
# Idempotent: skips run entirely if git SHA has not changed since last sync.
# Triggered by: systemd timer (every 15 min) + manual: systemctl start technitium-sync
#
# Requires: /etc/technitium/sync.token (API token written by Ansible bootstrap).
# State:    /var/lib/technitium-sync/last-sha  (tracks last applied commit)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/d0ntblink/owl.red.git}"
REPO_DIR="/opt/owl.red"
STATE_DIR="/var/lib/technitium-sync"
TOKEN_FILE="/etc/technitium/sync.token"
API_BASE="http://localhost:5380/api"
GITOPS_DIR="${REPO_DIR}/gitops/technitium"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

# POST to Technitium API with form data. Token is injected automatically.
# Additional curl args (--data-urlencode key=val, -d key=val) via "$@".
api() {
  local endpoint="$1"; shift
  local resp
  resp=$(curl -sf -X POST "${API_BASE}/${endpoint}" -d "token=${TOKEN}" "$@") \
    || die "HTTP error calling ${endpoint}"
  local status msg
  status=$(printf '%s' "${resp}" | jq -r '.status // "error"')
  msg=$(printf '%s' "${resp}" | jq -r '.errorMessage // ""')
  [[ "${status}" == "ok" ]] || die "${endpoint} — ${msg}"
}

# Zone import: zone data is the raw POST body so token must be in the query string.
api_zone_import() {
  local zone="$1" zonefile="$2"
  local resp
  resp=$(curl -sf -X POST \
    "${API_BASE}/zones/import?token=${TOKEN}&zone=${zone}&overwrite=true&overwriteZone=true&overwriteSoaSerial=false" \
    -H "Content-Type: text/plain" \
    --data-binary @"${zonefile}") || die "Zone import failed: ${zone}"
  local status msg
  status=$(printf '%s' "${resp}" | jq -r '.status // "error"')
  msg=$(printf '%s' "${resp}" | jq -r '.errorMessage // ""')
  [[ "${status}" == "ok" ]] || die "zones/import (${zone}) — ${msg}"
}

# Soft API call: logs a warning on error instead of aborting the whole sync.
# Used for reservations where an existing entry is not a fatal condition.
api_soft() {
  local label="$1" endpoint="$2"; shift 2
  local resp
  resp=$(curl -sf -X POST "${API_BASE}/${endpoint}" -d "token=${TOKEN}" "$@") || {
    log "  WARN: HTTP error for ${label}" >&2
    return 0
  }
  local status msg
  status=$(printf '%s' "${resp}" | jq -r '.status // "error"')
  msg=$(printf '%s' "${resp}" | jq -r '.errorMessage // ""')
  if [[ "${status}" != "ok" ]]; then
    log "  WARN: ${label} — ${msg}" >&2
  fi
}

# Convert a JSON object to a bash array of --data-urlencode key=value pairs.
# Outputs null-delimited strings for safe consumption via readarray -d ''.
json_to_form_args() {
  local json="$1"
  local -a args=()
  while IFS= read -r kv; do
    args+=("--data-urlencode" "${kv}")
  done < <(printf '%s' "${json}" \
    | jq -r 'to_entries[] | select(.key | startswith("_") | not) | "\(.key)=\(.value | tostring)"')
  printf '%s\0' "${args[@]}"
}

# ── Preflight ─────────────────────────────────────────────────────────────────

[[ -s "${TOKEN_FILE}" ]] || die "API token missing at ${TOKEN_FILE} — run Ansible bootstrap first"
TOKEN=$(tr -d '[:space:]' < "${TOKEN_FILE}")
mkdir -p "${STATE_DIR}"

# ── Git sync ──────────────────────────────────────────────────────────────────

if [[ -d "${REPO_DIR}/.git" ]]; then
  git -C "${REPO_DIR}" fetch --quiet origin
  git -C "${REPO_DIR}" reset --hard origin/main --quiet
else
  git clone --quiet "${REPO_URL}" "${REPO_DIR}"
fi

CURRENT_SHA=$(git -C "${REPO_DIR}" rev-parse HEAD)
LAST_SHA=$(cat "${STATE_DIR}/last-sha" 2>/dev/null || echo "")

if [[ "${CURRENT_SHA}" == "${LAST_SHA}" ]]; then
  log "No changes since ${CURRENT_SHA:0:8} — skipping sync."
  exit 0
fi

log "Syncing ${LAST_SHA:0:8} → ${CURRENT_SHA:0:8}"

# ── Server settings ───────────────────────────────────────────────────────────
# gitops/technitium/settings.json — keys map 1:1 to /api/settings/set params.
# Fields prefixed with _ are comments and are ignored by json_to_form_args.

if [[ -f "${GITOPS_DIR}/settings.json" ]]; then
  log "→ settings"
  readarray -d '' form_args < <(json_to_form_args "$(cat "${GITOPS_DIR}/settings.json")")
  api "settings/set" "${form_args[@]}"
fi

# ── DNS zones ─────────────────────────────────────────────────────────────────
# gitops/technitium/zones/*.zone — standard BIND zone files.
# Each file basename (without .zone) is the zone name.

for zonefile in "${GITOPS_DIR}/zones/"*.zone; do
  [[ -f "${zonefile}" ]] || continue
  zone=$(basename "${zonefile}" .zone)
  log "→ zone: ${zone}"

  zone_exists=$(curl -sf "${API_BASE}/zones/list?token=${TOKEN}" \
    | jq -r --arg z "${zone}" '.response.zones[]? | select(.name == $z) | .name')

  if [[ -z "${zone_exists}" ]]; then
    api "zones/create" -d "zone=${zone}&type=Primary"
    log "  Created primary zone: ${zone}"
  fi

  api_zone_import "${zone}" "${zonefile}"
  log "  Imported: ${zonefile##*/}"
done

# ── DHCP scopes ───────────────────────────────────────────────────────────────
# gitops/technitium/dhcp/scopes.json — array of scope objects.
# /api/dhcp/scopes/set is idempotent: creates if new, updates if exists by name.

if [[ -f "${GITOPS_DIR}/dhcp/scopes.json" ]]; then
  log "→ DHCP scopes"
  while IFS= read -r scope_json; do
    name=$(printf '%s' "${scope_json}" | jq -r '.name')
    readarray -d '' form_args < <(json_to_form_args "${scope_json}")
    api "dhcp/scopes/set" "${form_args[@]}"
    log "  ${name}"
  done < <(jq -c '.[]' "${GITOPS_DIR}/dhcp/scopes.json")
fi

# ── DHCP reservations ─────────────────────────────────────────────────────────
# gitops/technitium/dhcp-reservations.json — rich MAC registry.
# Sync applies entries where status=="confirmed" and hardwareAddress!="TBD".
# Scope name derived from JSON key (underscores → dashes).

if [[ -f "${GITOPS_DIR}/dhcp-reservations.json" ]]; then
  log "→ DHCP reservations"
  while IFS= read -r res; do
    scope=$(printf '%s' "${res}" | jq -r '.scope')
    hw=$(printf '%s' "${res}" | jq -r '.hardwareAddress')
    ip=$(printf '%s' "${res}" | jq -r '.ipAddress')
    hostname=$(printf '%s' "${res}" | jq -r '.hostName')
    comments=$(printf '%s' "${res}" | jq -r '.comments')

    # Upsert: remove any existing reservation for this MAC first (no-op if absent),
    # then add with the desired IP. This handles both new entries and IP/hostname changes.
    curl -sf -X POST "${API_BASE}/dhcp/scopes/removeReservedLease" \
      -d "token=${TOKEN}" -d "name=${scope}" \
      --data-urlencode "hardwareAddress=${hw}" > /dev/null 2>&1 || true
    api_soft "${hostname}" "dhcp/scopes/addReservedLease" \
      -d "name=${scope}" \
      --data-urlencode "hardwareAddress=${hw}" \
      --data-urlencode "ipAddress=${ip}" \
      --data-urlencode "hostName=${hostname}" \
      --data-urlencode "comments=${comments}"
    log "  ${hostname} → ${ip}"
  done < <(jq -c '
    .scopes | to_entries[] |
    .key as $key |
    ($key | gsub("_"; "-")) as $scope |
    .value.reservations[] |
    select(.hardwareAddress != "TBD" and .status == "confirmed") |
    {
      scope:           $scope,
      hardwareAddress: .hardwareAddress,
      ipAddress:       .ipAddress,
      hostName:        .hostName,
      comments:        (.comments // "")
    }
  ' "${GITOPS_DIR}/dhcp-reservations.json")
fi

# ── Save state ────────────────────────────────────────────────────────────────

printf '%s\n' "${CURRENT_SHA}" > "${STATE_DIR}/last-sha"
log "Sync complete — commit ${CURRENT_SHA:0:8}"
