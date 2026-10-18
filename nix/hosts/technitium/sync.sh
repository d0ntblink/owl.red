#!/usr/bin/env bash
# Technitium full-sync — applies ALL GitOps config from the owl.red repo.
# Covers: server settings, DNS zones, DHCP scopes, DHCP reservations.
#
# DHCP serving state is checked even when the Git SHA has not changed.
# Triggered by: systemd timer (every 15 min) + manual: systemctl start technitium-sync
#
# Requires: /etc/technitium/sync.token (API token written by Ansible bootstrap).
# State:    /var/lib/technitium-sync/last-sha  (tracks last applied commit)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/d0ntblink/owl.red.git}"
REPO_DIR="${REPO_DIR:-/opt/owl.red}"
STATE_DIR="${STATE_DIR:-/var/lib/technitium-sync}"
TOKEN_FILE="${TOKEN_FILE:-/etc/technitium/sync.token}"
DHCP_ENABLE_ALLOWED="${DHCP_ENABLE_ALLOWED:-false}"
API_BASE="http://localhost:5380/api"
GITOPS_DIR="${REPO_DIR}/gitops/technitium"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { log "ERROR: $*" >&2; exit 1; }

# POST to Technitium API with form data. Token is injected automatically.
# Additional curl args (--data-urlencode key=val, -d key=val) via "$@".
api_json() {
  local endpoint="$1"; shift
  local resp
  resp=$(curl -sf -X POST "${API_BASE}/${endpoint}" -d "token=${TOKEN}" "$@") \
    || die "HTTP error calling ${endpoint}"
  local status msg
  status=$(printf '%s' "${resp}" | jq -r '.status // "error"')
  msg=$(printf '%s' "${resp}" | jq -r '.errorMessage // ""')
  [[ "${status}" == "ok" ]] || die "${endpoint} — ${msg}"
  printf '%s\n' "${resp}"
}

api() {
  api_json "$@" > /dev/null
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

read_scope_states() {
  SCOPE_STATES=$(api_json "dhcp/scopes/list")
  printf '%s' "${SCOPE_STATES}" | jq -e '
    .response.scopes | type == "array" and
    all(.[]; (.name | type == "string") and (.enabled | type == "boolean"))
  ' > /dev/null || die "Invalid DHCP scope-state response"
}

scope_state_matches() {
  printf '%s' "${SCOPE_STATES}" | jq -e --arg name "$1" --argjson enabled "$2" '
    any(.response.scopes[]; .name == $name and .enabled == $enabled)
  ' > /dev/null
}

disable_scope() {
  local name="$1"
  if scope_state_matches "${name}" true; then
    api "dhcp/scopes/disable" --data-urlencode "name=${name}"
    read_scope_states
    scope_state_matches "${name}" false || die "DHCP scope did not disable: ${name}"
    log "  Disabled DHCP: ${name}"
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

[[ -f "${GITOPS_DIR}/dhcp/scopes.json" ]] || die "DHCP scope manifest is missing"
SCOPES_JSON=$(jq -ce '
  if type == "array" and length > 0 and
     all(.[]; (.name | type == "string" and length > 0) and
              (.enabled | type == "boolean")) and
     ([.[].name] | length == (unique | length))
  then . else error("Expected unique named DHCP scopes with boolean enabled values") end
' "${GITOPS_DIR}/dhcp/scopes.json") || die "Invalid DHCP scope manifest"

[[ "${DHCP_ENABLE_ALLOWED}" == "true" || "${DHCP_ENABLE_ALLOWED}" == "false" ]] \
  || die "DHCP_ENABLE_ALLOWED must be true or false"
if [[ "${DHCP_ENABLE_ALLOWED}" != "true" ]] && \
    printf '%s' "${SCOPES_JSON}" | jq -e 'any(.[]; .enabled)' > /dev/null; then
  die "DHCP activation is locked by host configuration"
fi

read_scope_states
printf '%s' "${SCOPE_STATES}" | jq -e --argjson desired "${SCOPES_JSON}" '
  .response.scopes as $live |
  all($desired[]; .name as $name | any($live[]; .name == $name))
' > /dev/null || die "A declared DHCP scope is missing; isolated bootstrap is required before attaching clients"
printf '%s' "${SCOPE_STATES}" | jq -e --argjson desired "${SCOPES_JSON}" '
  all(.response.scopes[];
    . as $live | (.enabled | not) or any($desired[]; .name == $live.name))
' > /dev/null || die "An unmanaged DHCP scope is enabled; review ownership before proceeding"

while IFS= read -r name; do
  disable_scope "${name}"
done < <(printf '%s' "${SCOPES_JSON}" | jq -r '.[] | select(.enabled == false) | .name')

MIGRATION_LEASES='[]'
if [[ -f "${GITOPS_DIR}/dhcp/migration-leases.json" ]]; then
  MIGRATION_LEASES=$(jq -ce --argjson scopes "${SCOPES_JSON}" '
    if type == "array" and all(.[];
      (.scope | type == "string") and (.hardwareAddress | type == "string") and
      (.ipAddress | type == "string") and (.hostName | type == "string") and
      (.expires | type == "number" and . > 0) and
      (.scope as $name | any($scopes[]; .name == $name)))
    then . else error("Invalid expiring DHCP migration leases") end
  ' "${GITOPS_DIR}/dhcp/migration-leases.json") || die "Invalid DHCP migration lease manifest"
  while IFS= read -r lease; do
    name=$(printf '%s' "${lease}" | jq -r '.scope')
    hw=$(printf '%s' "${lease}" | jq -r '.hardwareAddress')
    marker=$(printf '%s' "${lease}" | jq -r '"OWL-DHCP-MIGRATION expires=\(.expires)"')
    details=$(api_json "dhcp/scopes/get" --data-urlencode "name=${name}")
    if printf '%s' "${details}" | jq -e --arg hw "${hw}" --arg marker "${marker}" '
      any(.response.reservedLeases[]?; .hardwareAddress == $hw and .comments == $marker)
    ' > /dev/null; then
      leases=$(api_json "dhcp/leases/list")
      if printf '%s' "${leases}" | jq -e --arg name "${name}" --arg hw "${hw}" '
        any(.response.leases[]?; .scope == $name and .hardwareAddress == $hw and .type == "Reserved")
      ' > /dev/null; then
        api "dhcp/leases/convertToDynamic" --data-urlencode "name=${name}" --data-urlencode "hardwareAddress=${hw}"
      else
        api "dhcp/scopes/removeReservedLease" --data-urlencode "name=${name}" --data-urlencode "hardwareAddress=${hw}"
      fi
    fi
  done < <(printf '%s' "${MIGRATION_LEASES}" | jq -c --argjson now "$(date +%s)" '.[] | select(.expires <= $now)')
fi

if [[ "${CURRENT_SHA}" == "${LAST_SHA}" ]] && \
    printf '%s' "${SCOPE_STATES}" | jq -e --argjson desired "${SCOPES_JSON}" '
      .response.scopes as $live |
      all($desired[]; . as $scope |
        any($live[]; .name == $scope.name and .enabled == $scope.enabled))
    ' > /dev/null; then
  log "DHCP state verified; no changes since ${CURRENT_SHA:0:8} — skipping full sync."
  exit 0
fi

log "Syncing ${LAST_SHA:0:8} → ${CURRENT_SHA:0:8}"

while IFS= read -r name; do
  disable_scope "${name}"
done < <(printf '%s' "${SCOPES_JSON}" | jq -r '.[].name')

RESERVATIONS_JSON='[]'
if [[ -f "${GITOPS_DIR}/dhcp-reservations.json" ]]; then
  RESERVATIONS_JSON=$(jq -ce '[
    .scopes | to_entries[] |
    (.key | gsub("_"; "-")) as $scope |
    .value.reservations[] |
    select(.hardwareAddress != "TBD" and .status == "confirmed") |
    {
      scope: $scope,
      hardwareAddress: .hardwareAddress,
      ipAddress: .ipAddress,
      hostName: .hostName,
      comments: (.comments // "")
    }
  ]' "${GITOPS_DIR}/dhcp-reservations.json") || die "Invalid DHCP reservation manifest"
elif printf '%s' "${SCOPES_JSON}" | jq -e 'any(.[]; .enabled)' > /dev/null; then
  die "DHCP reservation manifest is required before activation"
fi

RESERVATIONS_JSON=$(jq -cn --argjson canonical "${RESERVATIONS_JSON}" \
  --argjson migrations "${MIGRATION_LEASES}" --argjson now "$(date +%s)" '
  $canonical + [$migrations[] | select(.expires > $now) |
    . + {comments: "OWL-DHCP-MIGRATION expires=\(.expires)"} | del(.expires)]
')

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
# Existing scopes are updated while disabled; lifecycle uses separate API calls.

if [[ -f "${GITOPS_DIR}/dhcp/scopes.json" ]]; then
  log "→ DHCP scopes"
  while IFS= read -r scope_json; do
    name=$(printf '%s' "${scope_json}" | jq -r '.name')
    readarray -d '' form_args < <(json_to_form_args "$(printf '%s' "${scope_json}" | jq 'del(.enabled)')")
    api "dhcp/scopes/set" "${form_args[@]}"
    read_scope_states
    if ! scope_state_matches "${name}" false; then
      disable_scope "${name}"
      die "DHCP scope was not disabled after settings update: ${name}"
    fi
    log "  ${name}"
  done < <(printf '%s' "${SCOPES_JSON}" | jq -c '.[]')
fi

# ── DHCP reservations ─────────────────────────────────────────────────────────
# gitops/technitium/dhcp-reservations.json — rich MAC registry.
# Sync applies entries where status=="confirmed" and hardwareAddress!="TBD".
# Scope name derived from JSON key (underscores → dashes).

if [[ -f "${GITOPS_DIR}/dhcp-reservations.json" ]]; then
  log "→ DHCP reservations"
  while IFS= read -r retired; do
    scope=$(printf '%s' "${retired}" | jq -r '.scope')
    hw=$(printf '%s' "${retired}" | jq -r '.hardwareAddress')
    ip=$(printf '%s' "${retired}" | jq -r '.ipAddress')
    details=$(api_json "dhcp/scopes/get" --data-urlencode "name=${scope}")
    if printf '%s' "${details}" | jq -e --arg hw "${hw}" --arg ip "${ip}" '
      any(.response.reservedLeases[]?; .hardwareAddress == $hw and .address != $ip)
    ' > /dev/null; then
      die "Retired DHCP reservation changed; refusing removal"
    fi
    if printf '%s' "${details}" | jq -e --arg hw "${hw}" --arg ip "${ip}" '
      any(.response.reservedLeases[]?; .hardwareAddress == $hw and .address == $ip)
    ' > /dev/null; then
      api "dhcp/scopes/removeReservedLease" --data-urlencode "name=${scope}" --data-urlencode "hardwareAddress=${hw}"
    fi
  done < <(jq -c '.retiredReservations[]?' "${GITOPS_DIR}/dhcp-reservations.json")
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
    api "dhcp/scopes/addReservedLease" \
      -d "name=${scope}" \
      --data-urlencode "hardwareAddress=${hw}" \
      --data-urlencode "ipAddress=${ip}" \
      --data-urlencode "hostName=${hostname}" \
      --data-urlencode "comments=${comments}"
    log "  ${hostname} → ${ip}"
  done < <(printf '%s' "${RESERVATIONS_JSON}" | jq -c '.[]')
fi

while IFS= read -r name; do
  api "dhcp/scopes/enable" --data-urlencode "name=${name}"
  read_scope_states
  scope_state_matches "${name}" true || die "DHCP scope did not enable: ${name}"
  log "  Enabled DHCP: ${name}"
done < <(printf '%s' "${SCOPES_JSON}" | jq -r '.[] | select(.enabled) | .name')

read_scope_states
printf '%s' "${SCOPE_STATES}" | jq -e --argjson desired "${SCOPES_JSON}" '
  .response.scopes as $live |
  all($desired[]; . as $scope |
    any($live[]; .name == $scope.name and .enabled == $scope.enabled))
' > /dev/null || die "DHCP serving state does not match the manifest"

# ── Save state ────────────────────────────────────────────────────────────────

printf '%s\n' "${CURRENT_SHA}" > "${STATE_DIR}/last-sha"
log "Sync complete — commit ${CURRENT_SHA:0:8}"
