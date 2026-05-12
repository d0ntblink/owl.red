#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
}

# Configuration (override via environment)
PDM_CT_VMID="${PDM_CT_VMID:-231}"
PDM_CT_HOSTNAME="${PDM_CT_HOSTNAME:-pdm}"
PDM_CT_MEMORY_MB="${PDM_CT_MEMORY_MB:-4096}"
PDM_CT_CORES="${PDM_CT_CORES:-2}"
PDM_CT_DISK_GB="${PDM_CT_DISK_GB:-20}"
PDM_CT_BRIDGE="${PDM_CT_BRIDGE:-vmbr0}"
PDM_CT_IP_CIDR="${PDM_CT_IP_CIDR:-10.0.10.31/24}"
PDM_CT_GATEWAY="${PDM_CT_GATEWAY:-10.0.10.1}"
PDM_CT_UNPRIVILEGED="${PDM_CT_UNPRIVILEGED:-1}"
PDM_CT_ROOTFS_STORAGE="${PDM_CT_ROOTFS_STORAGE:-local-lvm}"
PDM_CT_OSTEMPLATE="${PDM_CT_OSTEMPLATE:-}"

PDM_REPO_SUITE="${PDM_REPO_SUITE:-trixie}"
PDM_INSTALL_DEFAULT_KERNEL="${PDM_INSTALL_DEFAULT_KERNEL:-false}"

PDM_REQUIRE_SHARED_STORAGE="${PDM_REQUIRE_SHARED_STORAGE:-true}"
PDM_HA_RULE="${PDM_HA_RULE:-pdm-node-affinity}"
PDM_HA_NODES="${PDM_HA_NODES:-cp1:3,cp2:2,cp3:1}"

[[ -n "$PDM_CT_OSTEMPLATE" ]] || die "Set PDM_CT_OSTEMPLATE (example: local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst)"

require_cmd pct
require_cmd pvesm
require_cmd pvecm
require_cmd ha-manager
require_cmd jq

log "Checking Proxmox quorum..."
pvecm status | grep -q "Quorate: Yes" || die "Cluster is not quorate."

if [[ "$PDM_REQUIRE_SHARED_STORAGE" == "true" ]]; then
  log "Validating shared storage for ${PDM_CT_ROOTFS_STORAGE}..."
  shared_flag="$(pvesm status --output-format json | jq -r --arg s "$PDM_CT_ROOTFS_STORAGE" '.[] | select(.storage==$s) | .shared' | head -n1)"
  [[ -n "$shared_flag" && "$shared_flag" != "null" ]] || die "Storage '${PDM_CT_ROOTFS_STORAGE}' not found."
  [[ "$shared_flag" == "1" ]] || die "Storage '${PDM_CT_ROOTFS_STORAGE}' is not shared; true HA failover requires shared storage."
fi

if pct status "$PDM_CT_VMID" >/dev/null 2>&1; then
  log "Container ${PDM_CT_VMID} already exists."
else
  log "Creating container ${PDM_CT_VMID}..."
  net0="name=eth0,bridge=${PDM_CT_BRIDGE},ip=${PDM_CT_IP_CIDR},gw=${PDM_CT_GATEWAY}"
  pct create "$PDM_CT_VMID" "$PDM_CT_OSTEMPLATE" \
    --hostname "$PDM_CT_HOSTNAME" \
    --memory "$PDM_CT_MEMORY_MB" \
    --cores "$PDM_CT_CORES" \
    --rootfs "${PDM_CT_ROOTFS_STORAGE}:${PDM_CT_DISK_GB}" \
    --net0 "$net0" \
    --unprivileged "$PDM_CT_UNPRIVILEGED" \
    --onboot 1 \
    --start 0

  pct set "$PDM_CT_VMID" --features nesting=1,keyctl=1
fi

if pct status "$PDM_CT_VMID" | grep -q "status: running"; then
  log "Container ${PDM_CT_VMID} is already running."
else
  log "Starting container ${PDM_CT_VMID}..."
  pct start "$PDM_CT_VMID"
fi

if pct exec "$PDM_CT_VMID" -- bash -lc 'command -v proxmox-datacenter-manager-admin >/dev/null 2>&1'; then
  log "PDM package already installed in CT ${PDM_CT_VMID}."
else
  log "Installing PDM packages inside CT ${PDM_CT_VMID}..."
  pct exec "$PDM_CT_VMID" -- bash -lc "set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl gpg
wget -qO /usr/share/keyrings/proxmox-archive-keyring.gpg https://enterprise.proxmox.com/debian/proxmox-archive-keyring-trixie.gpg
cat >/etc/apt/sources.list.d/proxmox.sources <<'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pdm
Suites: ${PDM_REPO_SUITE}
Components: pdm-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF
apt-get update
apt-get install -y proxmox-datacenter-manager proxmox-datacenter-manager-ui
if [[ '${PDM_INSTALL_DEFAULT_KERNEL}' == 'true' ]]; then
  apt-get install -y proxmox-default-kernel
fi
systemctl enable --now proxmox-datacenter-api proxmox-datacenter-privileged-api
"
fi

if ha-manager config | grep -Eq "(^|[[:space:]])ct:${PDM_CT_VMID}($|[[:space:]])"; then
  log "Updating existing HA resource ct:${PDM_CT_VMID}..."
  ha-manager set "ct:${PDM_CT_VMID}" --state started --max_relocate 3 --max_restart 3 --failback 0
else
  log "Adding HA resource ct:${PDM_CT_VMID}..."
  ha-manager add "ct:${PDM_CT_VMID}" --state started --max_relocate 3 --max_restart 3 --failback 0
fi

if ha-manager rules config --output-format json 2>/dev/null | jq -e --arg r "$PDM_HA_RULE" '.[] | select(.rule==$r and .type=="node-affinity")' >/dev/null; then
  log "Updating HA node-affinity rule ${PDM_HA_RULE}..."
  ha-manager rules set node-affinity "$PDM_HA_RULE" --resources "ct:${PDM_CT_VMID}" --nodes "$PDM_HA_NODES" --strict 1
else
  log "Creating HA node-affinity rule ${PDM_HA_RULE}..."
  ha-manager rules add node-affinity "$PDM_HA_RULE" --resources "ct:${PDM_CT_VMID}" --nodes "$PDM_HA_NODES" --strict 1
fi

log "Done."
log "PDM endpoint expected at https://${PDM_CT_IP_CIDR%%/*}:8443"
log "Verify with:"
log "  ha-manager status"
log "  ha-manager config"
log "  ha-manager rules config"
