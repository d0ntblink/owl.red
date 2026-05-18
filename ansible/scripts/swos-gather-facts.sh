#!/usr/bin/env bash
# scripts/swos-gather-facts.sh
# Run the SwOS facts-gathering playbook against the CSS326 switch.
#
# Usage:
#   ./scripts/swos-gather-facts.sh
#   ./scripts/swos-gather-facts.sh --hosts switch_swos

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

HOSTS="switches"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts) HOSTS="$2"; shift 2 ;;
    *) EXTRA_ARGS+=("$1"); shift ;;
  esac
done

cd "$REPO_DIR"

exec ansible-playbook \
  -l "$HOSTS" \
  playbooks/swos-gather-facts.yml \
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
