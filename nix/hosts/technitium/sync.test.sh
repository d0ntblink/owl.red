#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(cd -- "${SCRIPT_DIR}/../../.." && pwd)
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "${TEST_ROOT}"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

git() {
  case "$*" in
    *"fetch --quiet origin"|*"reset --hard origin/main --quiet") ;;
    *"rev-parse HEAD") printf 'new-revision\n' ;;
    *) printf 'Unexpected Git operation\n' >&2; return 1 ;;
  esac
}

curl() {
  local endpoint='' scope='' argument field data_pending=false invalid_field=false
  for argument in "$@"; do
    if [[ "${data_pending}" == true ]]; then
      field=${argument%%=*}
      [[ "${field}" != name ]] || scope=${argument#*=}
      [[ "${field}" != enabled && "${field}" != _* ]] || invalid_field=true
      data_pending=false
    else
      case "${argument}" in
        http://localhost:5380/api/*)
          endpoint=${argument#http://localhost:5380/api/}
          endpoint=${endpoint%%\?*}
          ;;
        -d|--data-urlencode) data_pending=true ;;
      esac
    fi
  done
  jq -cn --arg endpoint "${endpoint}" --arg scope "${scope}" \
    '{endpoint: $endpoint, scope: $scope}' >> "${MOCK_LOG}"
  if [[ "${MOCK_FAIL_ENDPOINT:-}" == "${endpoint}" ]]; then
    [[ "${MOCK_HTTP_FAILURE:-false}" != true ]] || return 22
    printf '{"status":"error","errorMessage":"Deliberate API failure"}\n'
    return 0
  fi
  case "${endpoint}" in
    dhcp/scopes/get)
      jq -n --argjson reserved "${MOCK_MIGRATION_RESERVED:-[]}" '{status: "ok", response: {reservedLeases: $reserved}}'
      return 0
      ;;
    dhcp/leases/list)
      jq -n --argjson leases "${MOCK_MIGRATION_LEASES:-[]}" '{status: "ok", response: {leases: $leases}}'
      return 0
      ;;
    dhcp/scopes/list)
      if [[ "${MOCK_INVALID_LIST:-false}" == true ]]; then
        printf '{"status":"ok","response":{}}\n'
      else
        jq '{status: "ok", response: {scopes: .}}' "${MOCK_STATE}"
      fi
      return 0
      ;;
    dhcp/scopes/disable|dhcp/scopes/enable)
      if [[ "${MOCK_IGNORE_STATE:-}" != "${endpoint}" ]]; then
        jq --arg name "${scope}" --argjson enabled "$([[ "${endpoint}" == */enable ]] && printf true || printf false)" \
          'map(if .name == $name then .enabled = $enabled else . end)' \
          "${MOCK_STATE}" > "${MOCK_STATE}.next"
        mv -- "${MOCK_STATE}.next" "${MOCK_STATE}"
      fi
      ;;
    dhcp/scopes/set)
      if [[ "${invalid_field}" == true ]] || \
          ! jq -e --arg name "${scope}" 'any(.[]; .name == $name and .enabled == false)' "${MOCK_STATE}" > /dev/null; then
        printf '{"status":"error","errorMessage":"Unsafe scope-settings update"}\n'
        return 0
      fi
      if [[ "${MOCK_SET_ENABLES:-false}" == true ]]; then
        jq --arg name "${scope}" 'map(if .name == $name then .enabled = true else . end)' \
          "${MOCK_STATE}" > "${MOCK_STATE}.next"
        mv -- "${MOCK_STATE}.next" "${MOCK_STATE}"
      fi
      ;;
    settings/set|zones/create|zones/import|dhcp/scopes/removeReservedLease|dhcp/scopes/addReservedLease|dhcp/leases/convertToDynamic) ;;
    *) printf '{"status":"error","errorMessage":"Unexpected API operation"}\n'; return 0 ;;
  esac
  printf '{"status":"ok"}\n'
}
export -f git curl

setup_case() {
  local label="$1"
  CASE_DIR="${TEST_ROOT}/${label}"
  mkdir -p "${CASE_DIR}/repo/.git" "${CASE_DIR}/repo/gitops/technitium/dhcp" "${CASE_DIR}/state"
  export REPO_DIR="${CASE_DIR}/repo" STATE_DIR="${CASE_DIR}/state" TOKEN_FILE="${CASE_DIR}/token"
  export MOCK_STATE="${CASE_DIR}/scopes.json" MOCK_LOG="${CASE_DIR}/requests.jsonl"
  export DHCP_ENABLE_ALLOWED=false MOCK_FAIL_ENDPOINT='' MOCK_IGNORE_STATE='' MOCK_INVALID_LIST=false
  export MOCK_SET_ENABLES=false MOCK_HTTP_FAILURE=false
  export MOCK_MIGRATION_RESERVED='[]' MOCK_MIGRATION_LEASES='[]'
  printf 'offline-test-token\n' > "${TOKEN_FILE}"
  printf 'old-revision\n' > "${STATE_DIR}/last-sha"
  : > "${MOCK_LOG}"
  jq '.[0:2] | map(.enabled = false)' "${PROJECT_DIR}/gitops/technitium/dhcp/scopes.json" > "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
  jq '[.[] | {name, enabled: true}]' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${MOCK_STATE}"
  jq -n '{scopes: {vlan10_network_devices: {reservations: [
    {status: "confirmed", hardwareAddress: "02:00:00:00:00:10", ipAddress: "10.0.10.10", hostName: "test.owl.red"},
    {status: "pending", hardwareAddress: "TBD", ipAddress: "10.0.10.11", hostName: "pending.owl.red"}
  ]}}}' > "${REPO_DIR}/gitops/technitium/dhcp-reservations.json"
  printf '{}\n' > "${REPO_DIR}/gitops/technitium/settings.json"
}

run_sync() {
  bash "${SCRIPT_DIR}/sync.sh" > "${CASE_DIR}/output" 2>&1
}

expect_failure() {
  if run_sync; then fail 'Sync unexpectedly succeeded'; fi
  [[ "$(< "${STATE_DIR}/last-sha")" == old-revision ]] || fail 'Failed sync recorded a revision'
}

setup_case migration_hold
jq -n --argjson expires "$(($(date +%s) + 600))" '[{
  scope: "vlan10-network-devices", hardwareAddress: "02-00-00-00-00-99",
  ipAddress: "10.0.10.199", hostName: "migration", expires: $expires
}]' > "${REPO_DIR}/gitops/technitium/dhcp/migration-leases.json"
run_sync || { cat "${CASE_DIR}/output"; fail 'Migration hold sync failed'; }
jq -se '([.[] | select(.endpoint == "dhcp/scopes/addReservedLease")] | length == 2)' "${MOCK_LOG}" > /dev/null \
  || fail 'Unexpired migration hold was not applied with canonical reservations'
printf 'PASS: unexpired migration hold preserves its address\n'

setup_case expired_migration
printf 'new-revision\n' > "${STATE_DIR}/last-sha"
jq 'map(.enabled = false)' "${MOCK_STATE}" > "${MOCK_STATE}.next"
mv "${MOCK_STATE}.next" "${MOCK_STATE}"
jq -n '[{scope: "vlan10-network-devices", hardwareAddress: "02-00-00-00-00-99",
  ipAddress: "10.0.10.199", hostName: "migration", expires: 1}]' \
  > "${REPO_DIR}/gitops/technitium/dhcp/migration-leases.json"
export MOCK_MIGRATION_RESERVED='[{"hardwareAddress":"02-00-00-00-00-99","comments":"OWL-DHCP-MIGRATION expires=1"}]'
export MOCK_MIGRATION_LEASES='[{"scope":"vlan10-network-devices","hardwareAddress":"02-00-00-00-00-99","type":"Reserved"}]'
run_sync || { cat "${CASE_DIR}/output"; fail 'Expired migration cleanup failed'; }
jq -se 'any(.[]; .endpoint == "dhcp/leases/convertToDynamic") and
  all(.[]; .endpoint != "dhcp/scopes/addReservedLease" and .endpoint != "dhcp/scopes/enable")' "${MOCK_LOG}" > /dev/null \
  || fail 'Expired hold was not made dynamic on an unchanged revision'
printf 'PASS: expired hold returns to dynamic without a new revision or full sync\n'

setup_case disabled
run_sync || { cat "${CASE_DIR}/output"; fail 'Disabled-state sync failed'; }
jq -e 'all(.[]; .enabled == false)' "${MOCK_STATE}" > /dev/null || fail 'Scope remained enabled'
[[ "$(< "${STATE_DIR}/last-sha")" == new-revision ]] || fail 'Successful sync did not record revision'
jq -se 'all(.[]; .endpoint != "dhcp/scopes/enable") and
  ([.[] | select(.endpoint == "dhcp/scopes/addReservedLease")] | length == 1)' "${MOCK_LOG}" > /dev/null \
  || fail 'Activation occurred or pending reservation was applied'
printf 'PASS: disabled scope updates and confirmed-only reservations\n'

: > "${MOCK_LOG}"
run_sync || fail 'Converged repeated sync failed'
jq -se 'length == 1 and .[0].endpoint == "dhcp/scopes/list"' "${MOCK_LOG}" > /dev/null \
  || fail 'Converged repeated sync performed writes'
printf 'PASS: converged repeated sync performs no API writes\n'

setup_case unchanged
printf 'new-revision\n' > "${STATE_DIR}/last-sha"
run_sync || fail 'Unchanged-revision guard failed'
jq -e 'all(.[]; .enabled == false)' "${MOCK_STATE}" > /dev/null || fail 'Unchanged revision left DHCP drift'
jq -se 'all(.[]; .endpoint == "dhcp/scopes/list" or .endpoint == "dhcp/scopes/disable")' "${MOCK_LOG}" > /dev/null \
  || fail 'Unchanged revision performed a full sync'
printf 'PASS: disabled-state drift repaired without a new Git revision\n'

setup_case activation_locked
jq '.[0].enabled = true' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next"
mv -- "${CASE_DIR}/desired.next" "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
expect_failure
[[ ! -s "${MOCK_LOG}" ]] || fail 'Activation lock allowed API operations'
printf 'PASS: host activation lock rejects enabled desired state before API writes\n'

setup_case activation_allowed
export DHCP_ENABLE_ALLOWED=true
jq '.[0].enabled = true' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next"
mv -- "${CASE_DIR}/desired.next" "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
run_sync || { cat "${CASE_DIR}/output"; fail 'Approved activation failed'; }
jq -e '.[0].enabled == true and .[1].enabled == false' "${MOCK_STATE}" > /dev/null || fail 'Wrong scopes activated'
jq -se 'to_entries as $calls |
  ([$calls[] | select(.value.endpoint == "dhcp/scopes/addReservedLease") | .key] | max) <
  ([$calls[] | select(.value.endpoint == "dhcp/scopes/enable") | .key] | min)' "${MOCK_LOG}" > /dev/null \
  || fail 'Scope enabled before reservations completed'
printf 'PASS: explicitly allowed activation follows settings and reservations\n'

setup_case missing_scope
jq '.[0:1]' "${MOCK_STATE}" > "${CASE_DIR}/live.next"
mv -- "${CASE_DIR}/live.next" "${MOCK_STATE}"
expect_failure
jq -se 'all(.[]; .endpoint == "dhcp/scopes/list")' "${MOCK_LOG}" > /dev/null || fail 'Missing scope caused API writes'
printf 'PASS: missing scopes are not created enabled\n'

setup_case unmanaged_scope
jq '. + [{name: "unmanaged", enabled: true}]' "${MOCK_STATE}" > "${CASE_DIR}/live.next"
mv -- "${CASE_DIR}/live.next" "${MOCK_STATE}"
expect_failure
jq -se 'all(.[]; .endpoint == "dhcp/scopes/list")' "${MOCK_LOG}" > /dev/null || fail 'Unmanaged scope caused API writes'
printf 'PASS: unmanaged enabled scopes require ownership review\n'

for endpoint in dhcp/scopes/disable dhcp/scopes/set dhcp/scopes/addReservedLease dhcp/scopes/enable; do
  setup_case "failure_${endpoint//\//_}"
  export DHCP_ENABLE_ALLOWED=true MOCK_FAIL_ENDPOINT="${endpoint}"
  jq '.[0].enabled = true' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next"
  mv -- "${CASE_DIR}/desired.next" "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
  expect_failure
  printf 'PASS: API failure blocks success state: %s\n' "${endpoint}"
done

setup_case ignored_disable
export MOCK_IGNORE_STATE=dhcp/scopes/disable
expect_failure
jq -se 'all(.[]; .endpoint == "dhcp/scopes/list" or .endpoint == "dhcp/scopes/disable")' "${MOCK_LOG}" > /dev/null \
  || fail 'Failed disable read-back allowed configuration writes'
printf 'PASS: disable acknowledgement without state change is rejected\n'

setup_case ignored_enable
export DHCP_ENABLE_ALLOWED=true MOCK_IGNORE_STATE=dhcp/scopes/enable
jq '.[0].enabled = true' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next"
mv -- "${CASE_DIR}/desired.next" "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
expect_failure
printf 'PASS: enable acknowledgement without state change is rejected\n'

setup_case invalid_response
export MOCK_INVALID_LIST=true
expect_failure
printf 'PASS: invalid scope-state response is rejected\n'

setup_case unexpected_activation
export MOCK_SET_ENABLES=true
expect_failure
jq -e 'all(.[]; .enabled == false)' "${MOCK_STATE}" > /dev/null \
  || fail 'Unexpected settings activation was not disabled'
printf 'PASS: unexpected settings activation is disabled and fails the sync\n'

setup_case http_failure
export MOCK_FAIL_ENDPOINT=dhcp/scopes/list MOCK_HTTP_FAILURE=true
expect_failure
printf 'PASS: HTTP failure prevents a successful sync marker\n'

for invalid in missing_enabled string_enabled duplicate_name malformed_json; do
  setup_case "${invalid}"
  case "${invalid}" in
    missing_enabled) jq '.[0] |= del(.enabled)' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next" ;;
    string_enabled) jq '.[0].enabled = "false"' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next" ;;
    duplicate_name) jq '. + [.[0]]' "${REPO_DIR}/gitops/technitium/dhcp/scopes.json" > "${CASE_DIR}/desired.next" ;;
    malformed_json) printf '{\n' > "${CASE_DIR}/desired.next" ;;
  esac
  mv -- "${CASE_DIR}/desired.next" "${REPO_DIR}/gitops/technitium/dhcp/scopes.json"
  expect_failure
  [[ ! -s "${MOCK_LOG}" ]] || fail 'Invalid manifest reached the API'
  printf 'PASS: invalid manifest rejected: %s\n' "${invalid}"
done