# Shared storage — NAS as central storage for HA workloads

`nas.owl.red` (Unraid) is the central shared store. **NFS** serves the HA/infra consumers
(k8s cluster, Proxmox hosts, other LXC/VMs); **SMB** stays for personal devices. We **reuse the
existing shares** (no new share scheme) and turn on NFS per-share with host-restricted exports.

> **Trade-off you accepted:** one Unraid box backing *all* HA workloads makes the NAS a **single point
> of failure** for everything HA — if it's down, cluster PVCs and any Proxmox guest on NFS storage stall.
> Short-term that's fine (simple, works today); medium-term, cluster-native HA storage (Longhorn) removes
> the SPOF. See [ADR 018](../decisions/018-storage-backend.md).

## Share → consumer → protocol map (reusing existing shares)

| Share | Pool | Serves | Proto | Notes |
|-------|------|--------|-------|-------|
| `appdata` | ssd | **k8s PVCs** (under a `/k8s` subpath) + other LXC/VM config | NFS | SSD = good for app config/DBs. Keep cluster data in a `k8s/` subdir so it doesn't collide with Unraid's own docker appdata. |
| `vms` | ssd | **Proxmox** HA VM/LXC disk images | NFS | shared disks = real CT/VM failover (e.g. PDM); Unraid's own VM manager is disabled, so the share is free to reuse. |
| `isos` | ssd | **Proxmox** ISOs / CT templates | NFS | |
| `backups` | array | **Proxmox** vzdump + PBS + personal backups | NFS + SMB | |
| `media` | array | Plex/*arr + personal | SMB (NFS only if a cluster media app needs it) | **fix the current `shareSecurityNFS="public"`** — restrict before enabling NFS. |
| `sharefiles` | array | personal "fast cloud" files | SMB | |
| `system` | ssd | Unraid internal (libvirt/docker img) | none | **never export.** |

## Security model (do this before flipping NFS on)

- **Enable NFS globally** only with per-share exports locked down. For each exported share set
  `shareSecurityNFS="private"` and `shareHostListNFS` to the allowed consumers — **VLAN 10**
  (`10.0.10.0/24`, tighten to `/24` post-migration) or explicit node IPs. **Never leave `public`.**
- Map UID/GID: Unraid shares are owned by `d0ntblink`; k8s/Proxmox write as root, so the export needs the
  right squash. Use `no_root_squash` **only** on the cluster/Proxmox-restricted exports (PVCs/VM disks),
  never on `media`/personal exports. Document the exact `shareHostListNFS` rule string per share.
- NFS is plaintext on the LAN — acceptable inside VLAN 10; do **not** expose it across VLANs or the WAN.

## Who configures what (which IaC lane)

| Piece | Lane | Where |
|-------|------|-------|
| Enable NFS + per-share export/security | **Ansible file-lane** (`unraid_settings`, Phase 2) | `share.cfg` (`shareNFSEnabled="yes"`) + `shares/*.cfg` (`shareExportNFS`, `shareSecurityNFS`, `shareHostListNFS`) |
| Array/disk/pool layout | **Manual** ⛔ | Unraid UI — never IaC |
| k8s PVCs (CSI + StorageClass) | **GitOps/Fleet** | `gitops/<nfs-csi>/` — `nfs-subdir-external-provisioner` (or democratic-csi) pointing at `nas.owl.red:/mnt/user/appdata/k8s`; add the path to the GitRepo |
| Proxmox NFS storage (disks/ISO/backup) | **Ansible** (or manual) | `pvesm add nfs …` per content type; bpg/proxmox has no storage resource, so script/Ansible it (codify in a role/playbook) |
| Personal SMB mounts | **Manual / documented** | already exported; fstab/Finder/Explorer |

## Phased rollout (safe order)

1. **Lock exports (no-op until enabled):** set `shareSecurityNFS="private"` + `shareHostListNFS` (VLAN 10) on the
   shares to be exported; fix `media`'s `public`. (Ansible file-lane, `--check` first.)
2. **Enable NFS globally** (`shareNFSEnabled="yes"`) — array stays untouched; this only starts the NFS daemon.
3. **k8s smoke test:** deploy the NFS CSI provisioner (Fleet) → `StorageClass nfs-nas` → a 1Gi test PVC →
   confirm a pod writes and data persists across reschedule. Then point a real stateful app (Home Assistant) at it.
4. **Proxmox shared storage:** `pvesm add nfs nas-vms … --content images,rootdir` (+ `isos`, `backup`) on each node;
   verify a CT can migrate/HA-failover between nodes (unblocks PDM HA — ROADMAP 11/13).
5. **Personal:** confirm SMB mounts; (optional) NFS for Linux desktops.
6. **Document the StorageClass name, NFS paths, and mount rules** back into this guide + README.

## Open items
- Exact `appdata/k8s` subpath vs a future dedicated `cluster` share (revisit if reuse gets messy).
- `no_root_squash` scope per export (PVCs/VM-disks need it; personal must not have it).
- Longhorn evaluation post Unraid→VM migration (removes the NAS SPOF) — ADR 018 / ROADMAP §4.
