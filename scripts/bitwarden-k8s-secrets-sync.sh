#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

cleanup_tmp_files() {
  rm -f "${secrets_json:-}" "${existing_json:-}" "${map_tsv:-}"
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
}

sanitize_dns_label() {
  local raw="$1"
  local out
  out="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  out="${out:0:63}"
  out="${out%-}"
  [[ -n "$out" ]] || out="bw-secret"
  printf '%s' "$out"
}

usage() {
  cat <<'EOF'
Usage:
  scripts/bitwarden-k8s-secrets-sync.sh

Description:
  Pushes selected Kubernetes secret keys into Bitwarden Secrets Manager,
  then renders BitwardenSecret CR manifests that pull those values back
  into Kubernetes.

Required environment variables:
  BWS_ACCESS_TOKEN       Bitwarden machine account access token
  BW_PROJECT_ID          Bitwarden project ID to store migrated secrets
  BW_ORGANIZATION_ID     Bitwarden organization ID for BitwardenSecret specs

Optional environment variables:
  OUTPUT_DIR                         Output path for generated manifests
                                     default: gitops/bitwarden-secrets/generated
  INCLUDE_NAMESPACES_REGEX           Namespaces to include (regex)
                                     default: .*
  EXCLUDE_NAMESPACES_REGEX           Namespaces to exclude (regex)
                                     default: ^(kube-system|kube-public|kube-node-lease)$
  EXCLUDE_SECRET_NAME_REGEX          Secret names to exclude (regex)
                                     default: ^(default-token-|sh\.helm\.release\.v1|kube-root-ca\.crt|bw-auth-token$)
  KUBECTL_REQUEST_TIMEOUT            kubectl request timeout
                                     default: 20s

Safety notes:
  - Service-account token secrets are always excluded.
  - Existing Bitwarden secrets with the same generated key are updated in place.
  - Generated key format: k8s__<namespace>__<secret-name>__<secret-key>
EOF
}

main() {
  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd kubectl
  require_cmd jq
  require_cmd bws
  require_cmd base64
  require_cmd iconv

  [[ -n "${BWS_ACCESS_TOKEN:-}" ]] || die "BWS_ACCESS_TOKEN is required"
  [[ -n "${BW_PROJECT_ID:-}" ]] || die "BW_PROJECT_ID is required"
  [[ -n "${BW_ORGANIZATION_ID:-}" ]] || die "BW_ORGANIZATION_ID is required"

  local output_dir="${OUTPUT_DIR:-gitops/bitwarden-secrets/generated}"
  local include_ns_regex="${INCLUDE_NAMESPACES_REGEX:-.*}"
  local exclude_ns_regex="${EXCLUDE_NAMESPACES_REGEX:-^(kube-system|kube-public|kube-node-lease)$}"
  local exclude_secret_regex="${EXCLUDE_SECRET_NAME_REGEX:-^(default-token-|sh\\.helm\\.release\\.v1|kube-root-ca\\.crt|bw-auth-token$)}"
  local request_timeout="${KUBECTL_REQUEST_TIMEOUT:-20s}"

  rm -rf "$output_dir"
  mkdir -p "$output_dir"

  secrets_json="$(mktemp)"
  existing_json="$(mktemp)"
  map_tsv="$(mktemp)"

  trap cleanup_tmp_files EXIT

  log "Fetching Kubernetes secrets..."
  kubectl get secrets -A -o json --request-timeout="$request_timeout" > "$secrets_json"

  log "Fetching existing Bitwarden secrets in project ${BW_PROJECT_ID}..."
  bws secret list "$BW_PROJECT_ID" --output json > "$existing_json"

  declare -A existing_by_key
  while IFS=$'\t' read -r key id; do
    [[ -n "$key" && -n "$id" ]] || continue
    existing_by_key["$key"]="$id"
  done < <(jq -r '.. | objects | select(has("id") and has("key")) | [.key, .id] | @tsv' "$existing_json")

  declare -A manifest_map
  declare -A seen_secret

  local processed_secrets=0
  local processed_keys=0
  local skipped_keys=0

  while IFS= read -r item; do
    local ns name
    ns="$(jq -r '.metadata.namespace' <<<"$item")"
    name="$(jq -r '.metadata.name' <<<"$item")"

    processed_secrets=$((processed_secrets + 1))

    while IFS= read -r key_name; do
      local encoded decoded_file value bw_key bw_id create_json
      encoded="$(jq -r --arg k "$key_name" '.data[$k]' <<<"$item")"

      decoded_file="$(mktemp)"
      if ! printf '%s' "$encoded" | base64 -d > "$decoded_file" 2>/dev/null; then
        log "Skipping ${ns}/${name}:${key_name} (base64 decode failed)"
        rm -f "$decoded_file"
        skipped_keys=$((skipped_keys + 1))
        continue
      fi

      # Bitwarden Secrets Manager only accepts UTF-8 text values.
      if [[ "$(wc -c < "$decoded_file")" -ne "$(LC_ALL=C tr -d '\000' < "$decoded_file" | wc -c)" ]]; then
        log "Skipping ${ns}/${name}:${key_name} (contains null bytes)"
        rm -f "$decoded_file"
        skipped_keys=$((skipped_keys + 1))
        continue
      fi

      if ! iconv -f UTF-8 -t UTF-8 "$decoded_file" >/dev/null 2>&1; then
        log "Skipping ${ns}/${name}:${key_name} (invalid UTF-8)"
        rm -f "$decoded_file"
        skipped_keys=$((skipped_keys + 1))
        continue
      fi

      value="$(cat "$decoded_file")"
      rm -f "$decoded_file"

      bw_key="k8s__${ns}__${name}__${key_name}"

      if [[ -n "${existing_by_key[$bw_key]:-}" ]]; then
        bw_id="${existing_by_key[$bw_key]}"
        bws secret edit --value="$value" "$bw_id" --output none >/dev/null
      else
        create_json="$(bws secret create --output json -- "$bw_key" "$value" "$BW_PROJECT_ID")"
        bw_id="$(jq -r '.. | objects | select(has("id")) | .id' <<<"$create_json" | head -n 1)"
        [[ -n "$bw_id" && "$bw_id" != "null" ]] || die "Could not parse secret id for key: $bw_key"
        existing_by_key["$bw_key"]="$bw_id"
      fi

      printf '%s\t%s\t%s\t%s\n' "$ns" "$name" "$key_name" "$bw_id" >> "$map_tsv"

      local secret_ref
      secret_ref="${ns}/${name}"
      seen_secret["$secret_ref"]=1
      manifest_map["$secret_ref"]+="    - bwSecretId: ${bw_id}"$'\n'"      secretKeyName: ${key_name}"$'\n'

      processed_keys=$((processed_keys + 1))
    done < <(jq -r '.data | keys[]' <<<"$item")

  done < <(
    jq -c \
      --arg includeNs "$include_ns_regex" \
      --arg excludeNs "$exclude_ns_regex" \
      --arg excludeName "$exclude_secret_regex" \
      '.items[]
       | select(.type != "kubernetes.io/service-account-token")
       | select(.metadata.namespace | test($includeNs))
       | select((.metadata.namespace | test($excludeNs)) | not)
       | select((.metadata.name | test($excludeName)) | not)
       | select((.data // {} | length) > 0)' \
      "$secrets_json"
  )

  log "Rendering BitwardenSecret manifests to ${output_dir}..."
  while IFS= read -r secret_ref; do
    [[ -n "$secret_ref" ]] || continue

    local ns name ns_dir manifest_file resource_name
    ns="${secret_ref%%/*}"
    name="${secret_ref#*/}"

    ns_dir="${output_dir}/${ns}"
    mkdir -p "$ns_dir"

    resource_name="$(sanitize_dns_label "bw-${name}")"
    manifest_file="${ns_dir}/${name}-bitwardensecret.yaml"

    cat > "$manifest_file" <<EOF
apiVersion: k8s.bitwarden.com/v1
kind: BitwardenSecret
metadata:
  name: ${resource_name}
  namespace: ${ns}
spec:
  organizationId: "${BW_ORGANIZATION_ID}"
  secretName: ${name}
  onlyMappedSecrets: true
  map:
${manifest_map[$secret_ref]}  authToken:
    secretName: bw-auth-token
    secretKey: token
EOF
  done < <(printf '%s\n' "${!seen_secret[@]}" | sort)

  log "Sync complete."
  log "  Secrets processed: ${processed_secrets}"
  log "  Secret keys pushed: ${processed_keys}"
  log "  Secret keys skipped: ${skipped_keys}"
  log "  Mapping file: ${map_tsv} (temporary)"
  log "  Generated manifests: ${output_dir}"
  log "Ensure each target namespace has secret 'bw-auth-token' with machine account token."
}

main "$@"
