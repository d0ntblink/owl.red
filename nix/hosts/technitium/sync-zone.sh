#!/bin/sh
# Technitium zone sync — runs inside the NixOS LXC via systemd timer.
# Clones (first run) or pulls the owl.red repo, then imports the zone
# file via the Technitium API.
#
# Required: /etc/technitium/sync.token (written by Ansible bootstrap.yml)
# systemd ConditionPathExists guards against running before bootstrap.
set -eu

REPO_DIR="${REPO_DIR:-/opt/owl.red}"
ZONE_FILE="${ZONE_FILE:-${REPO_DIR}/gitops/technitium/owl.red.zone}"
ZONE_NAME="${DNS_ZONE_NAME:-owl.red}"
API_URL="${TECHNITIUM_API_URL:-http://localhost:5380}"
TOKEN_FILE="${TECHNITIUM_TOKEN_FILE:-/etc/technitium/sync.token}"

if [ ! -s "${TOKEN_FILE}" ]; then
  echo "ERROR: missing Technitium API token at ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(tr -d '\r\n' < "${TOKEN_FILE}")"
AUTH_HEADER="Authorization: Bearer ${TOKEN}"

# Clone on first run, pull on subsequent runs
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "INFO: cloning owl.red repo to ${REPO_DIR}"
  git clone "https://github.com/d0ntblink/owl.red.git" "${REPO_DIR}"
else
  if ! git -C "${REPO_DIR}" pull --ff-only --quiet 2>&1; then
    echo "ERROR: git pull failed in ${REPO_DIR}" >&2
    exit 1
  fi
fi

if [ ! -s "${ZONE_FILE}" ]; then
  echo "ERROR: zone file missing at ${ZONE_FILE}" >&2
  exit 1
fi

api_request() {
  RESPONSE="$(curl -fsS "$@")"
  RESPONSE_COMPACT="$(printf '%s' "${RESPONSE}" | tr -d '\n\r\t ')"

  if printf '%s' "${RESPONSE_COMPACT}" | grep -Fq '"status":"invalid-token"'; then
    echo "ERROR: Technitium API rejected the configured token" >&2
    printf '%s\n' "${RESPONSE}" >&2
    exit 1
  fi

  if printf '%s' "${RESPONSE_COMPACT}" | grep -Fq '"status":"error"'; then
    echo "ERROR: Technitium API returned an error response" >&2
    printf '%s\n' "${RESPONSE}" >&2
    exit 1
  fi

  printf '%s' "${RESPONSE}"
}

zone_exists() {
  ZONE_LIST_COMPACT="$(printf '%s' "$1" | tr -d '\n\r\t ')"
  printf '%s' "${ZONE_LIST_COMPACT}" | grep -Fq "\"name\":\"${ZONE_NAME}\""
}

ZONE_LIST_JSON="$(api_request -H "${AUTH_HEADER}" "${API_URL}/api/zones/list")"

if ! zone_exists "${ZONE_LIST_JSON}"; then
  echo "INFO: zone ${ZONE_NAME} does not exist; creating Primary zone"
  api_request -X POST -H "${AUTH_HEADER}" \
    "${API_URL}/api/zones/create?zone=${ZONE_NAME}&type=Primary" >/dev/null
fi

api_request -X POST \
  -H "${AUTH_HEADER}" \
  -H "Content-Type: text/plain" \
  --data-binary @"${ZONE_FILE}" \
  "${API_URL}/api/zones/import?zone=${ZONE_NAME}&overwrite=true&overwriteZone=true&overwriteSoaSerial=false" >/dev/null

ZONE_LIST_JSON="$(api_request -H "${AUTH_HEADER}" "${API_URL}/api/zones/list")"

if ! zone_exists "${ZONE_LIST_JSON}"; then
  echo "ERROR: zone ${ZONE_NAME} is still missing after import" >&2
  exit 1
fi

echo "INFO: synchronized zone ${ZONE_NAME} from ${ZONE_FILE}"
