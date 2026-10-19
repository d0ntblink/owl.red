# Shared storage — NAS as central storage for HA workloads

`nas.owl.red` (Unraid) is the central shared store. **Authenticated SMB** is
selected for Kubernetes PVCs and PC access; **NFS** remains the proposed
Proxmox/infrastructure lane, subject to its separate activation gates. Reuse
one shared `appdata` share for NAS-local and Kubernetes applications.

**No fallback or destructive changes:** follow the owner's
[operating constraint](unraid-making-changes.md#no-fallback-operating-constraint).
Routine work continues without repeated permission prompts. Temporary scoped
service interruptions are acceptable; data/hardware destruction is not. Keep
production media files, placement and access/export policy unchanged.

> **Trade-off you accepted:** one Unraid box backing *all* HA workloads makes the NAS a **single point
> of failure** for everything HA — if it's down, cluster PVCs and any Proxmox guest on NFS storage stall.
> Short-term that's fine (simple, works today); medium-term, cluster-native HA storage (Longhorn) removes
> the SPOF. See [ADR 018](../decisions/018-storage-backend.md).

## Observed NAS Baseline (2026-10-18)

Read-only SSH inspection at `2026-10-18T18:50:53Z` reached `nas` at
`10.0.10.5`, running Unraid `7.3.3`. Private evidence is under
`~/.local/state/owl-red/nas-storage-audit-TWufLT/`. No NAS configuration,
service, array, disk or power changes were made.

- NFS is globally disabled in saved and runtime settings. `exportfs -v` is
   empty and no TCP 2049 listener was found. Saved exports below are not active.
- `/mnt/ssd` is XFS on one block device, about 500 GB total with 351 GB
   available. Pool redundancy and backup coverage were not verified.
- `/mnt/user` reports about 46.0 TB total, 7.29 TB available and 85% used.
- The proposed `/mnt/ssd/appdata/k8s` directory does not exist.
- Local `apcaccess status` returns connection refused, with no `apcupsd`
   process or TCP 3551 listener. Other UPS implementations, external monitoring
   and staged shutdown remain unverified; no power test was run.

| Share | Configured placement | Saved NFS export | Saved NFS security | Host list |
|-------|----------------------|------------------|--------------------|-----------|
| `appdata` | `ssd`, pool-only | Disabled (`-`) | `private` | Empty |
| `vms` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |
| `isos` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |
| `backups` | Array | Enabled (`e`) | `public` | Empty |
| `media` | Array | Enabled (`e`) | `public` | Empty |
| `sharefiles` | Array | Enabled (`e`) | `public` | Empty |
| `system` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |

Subsequent accepted change at `2026-10-18T19:25:11Z`: the owner declared all
`sharefiles` contents disposable. Fresh checks found no SMB handles, container
references or nested mounts, and only an empty `.Recycle.Bin` directory.
That directory and the share were retired through Unraid's native handler;
zero files were deleted. The path/config and SMB advertisement are absent.
All other share configs, media, disk/array/network/global config hashes remain
unchanged; NFS is still disabled. Private evidence:
`~/.local/state/owl-red/retire-sharefiles-HQj9wV/`.

Do not enable NFS with these saved public exports. Restrict intended exports
and disable unneeded exports, especially `system`, first. The Ansible file
lane is still a no-write scaffold. The owner amendments below govern the target;
they do not authorize live activation or deletion.

## Owner Amendments (2026-10-18)

- Use one shared `appdata` share for NAS-local and Kubernetes applications,
   not a separate `appdata-k8s` share. Inventory and cleanup are roadmap work;
   no live directory is renamed, moved or deleted now. Final per-app/PVC paths
   remain to be agreed; the earlier `appdata/k8s` directory is only a proposal.
- Keep distinct application/PVC ownership and avoid old NAS and new Kubernetes
   instances writing the same single-writer state during migration. Shared
   storage enables restarts elsewhere, not automatic active-active application HA.
- Production `media` is protected: no content, path, placement, share-security
   or export changes in this work. Do not merge it into a new bulk-data share.
- `sharefiles` is retired after the owner confirmed no contents were needed
   and the bounded no-consumer/empty-content checks passed. Do not recreate it.
- Keep NAS boot and essential recovery infrastructure independent of its own
   exports. Qualify database/filesystem compatibility and backups per application.
- The owner selected **SMB with a dedicated `k8s` account** instead of NFS for
   Kubernetes. Use upstream `csi-driver-smb` after qualifying the existing Talos
   CIFS/SMB3 support, with Bitwarden-backed provisioning/node-stage secrets and
   retained per-PVC directories. This is selected design, not a deployed driver.
- Plan backup and scanner identities, creating them when their consumers exist.
   Reuse existing `root` and `d0ntblink`; no accounts or credentials have changed.

**Activation blocker:** globally enabling NFS would activate media's saved
public export even without editing its configuration. Keep NFS off until a
separately agreed approach avoids exposing or changing protected media.
This is a blocker for the future NFS lane, not SMB CSI preparation. Existing
SMB media access is guest-readable and unchanged, so strict denial of media
reads to a new account cannot currently be claimed.

## Share → consumer → protocol map (reusing existing shares)

| Share | Pool | Serves | Proto | Notes |
|-------|------|--------|-------|-------|
| `appdata` | ssd | NAS-local apps + **k8s PVCs** | Local + authenticated SMB | One share with distinct app/PVC paths. Planned private access and `k8s` write grants; qualify ownership, locking and database storage rather than assuming SMB fixes network-filesystem constraints. |
| `vms` | ssd | **Proxmox** HA VM/LXC disk images | NFS | shared disks = real CT/VM failover (e.g. PDM); Unraid's own VM manager is disabled, so the share is free to reuse. |
| `isos` | ssd | **Proxmox** ISOs / CT templates | NFS | |
| `backups` | array | **Proxmox** vzdump + PBS + personal backups | NFS + SMB | |
| `media` | array | Existing production consumers | Existing access unchanged | Protected; no files, paths, placement, security or export changes in this work. |
| `sharefiles` | Retired | None | Not exported | Owner-authorized retirement accepted 2026-10-18; zero files and one empty recycle-bin directory removed. |
| `system` | ssd | Unraid internal (libvirt/docker img) | none | **never export.** |

## Security model (do this before flipping NFS on)

- Enable NFS only after every effective export is safe; the protected-media
   activation blocker above is not an implicit exception. Restrict intended
   exports to explicit Kubernetes/Proxmox client IPs, not the whole management
   subnet. Document each approved host rule before activation.
- Map UID/GID: Unraid shares are owned by `d0ntblink`; k8s/Proxmox write as root, so the export needs the
  right squash. Use `no_root_squash` **only** on the cluster/Proxmox-restricted exports (PVCs/VM disks),
  never on `media`/personal exports. Document the exact `shareHostListNFS` rule string per share.
- NFS is plaintext on the LAN — acceptable inside VLAN 10; do **not** expose it across VLANs or the WAN.

## Accounts And Access Roles

Read-only account inspection on 2026-10-18 found `root` (UID/GID `0:0`) and
the existing file-access user `d0ntblink` (`1000:100`, `/bin/false`). Effective
Samba configuration for `appdata`, `vms`, `backups`, `media` and `system` reports
`guest ok=Yes`, `read only=Yes`, no `valid users` restriction and
`write list=d0ntblink`. These settings permit guest read access; creating more
users alone does not restrict it. Do not change protected media in response.

| Identity / Role | Intended Access | Status |
|-----------------|-----------------|--------|
| `root` | WebUI administration and controlled break-glass SSH; not application/PC SMB credentials | Existing; preserve access |
| `d0ntblink` | Owner's PC over authenticated SMB; explicit per-share permissions | Existing; reuse, no password rotation |
| `k8s` | SMB read/write grant on shared appdata for CSI provisioning/mounting; no management login | Created, UID/GID `1001:100`, shell `/bin/false`; NAS-local SMB3 write/read and guest denial accepted |
| `svc-backup` | A named SMB backup client, limited to its backup destination | Planned; confirm consumer/grants before creation; not immutable backup protection |
| Proxmox | Its own NFS host allowlist, with only required export privileges | Not an SMB account by default |
| `svc-media-ro` | Optional future read-only SMB media consumer | Deferred; no permission change to production media |
| `svc-scanner` | Scanner restricted to a dedicated inbox, not appdata | Planned; create when consumer/path is selected; validate write-only semantics |
| Harbor robots | Registry project pull/push permissions, not NAS-wide permissions | Harbor identities if that service is selected, not Unraid users |

For intended private SMB shares, require authentication and explicit read/write
grants; do not mistake Unraid's `secure` guest-readable mode for private access.
Review existing clients before changing access. Do not recursively reset appdata
ownership or apply blanket `777` permissions: container UIDs and database files
must retain compatible ownership. Shared AUTH_SYS NFS trusts allowed hosts;
per-app directories and SMB users do not isolate files from a privileged NFS
client. Kubernetes SMB is now the selected protocol; its shared `k8s` credential
does not strongly isolate application directories from one another. Existing
guest-readable media is also an explicit exception to any appdata-only read
claim. Appdata is now private with explicit `d0ntblink,k8s` write grants;
other shares retain their previous policy. No existing appdata ownership or
application contents were reset or migrated.

Account creation remains in the Unraid-supported manual lane from
[ADR 021](../decisions/021-unraid-hybrid-iac.md), not generic `useradd` or direct
edits to password databases. Store new credentials privately in Bitwarden and
map them only to the selected consumer; never record passwords in Git or tool
output.

The [SMB CSI bundle](../../gitops/csi-smb/README.md) is active through Fleet,
with two controllers, node plugins on all four nodes and the non-default
`nas-appdata-smb` StorageClass. The Bitwarden operator supplies the private
two-field credential secret. Appdata remains private to its existing
`d0ntblink,k8s` grants; NFS remains disabled.

A disposable PVC passed authenticated writes, UID/GID `1001:100` and
file/directory mode checks, and persistence after pod recreation from
`worker1-talos` to `cp3-talos`. Claim deletion left its NAS files intact under
the Retain policy. Only the uniquely identified test files and Kubernetes
resources were cleaned up. Other shares, media and protected NAS system/account
configuration remained unchanged. This qualifies the storage path, not an
application's database, multi-writer layout or backup strategy.

The SDK incident and continuing logging controls remain documented in the
[SDK logging safeguard](controller-setup.md#sdk-logging-safety-and-smb-checkpoint).
Talos 1.8.1 CIFS support and Kubernetes cross-node mounts are confirmed.

## Who configures what (which IaC lane)

| Piece | Lane | Where |
|-------|------|-------|
| Enable NFS + per-share export/security | **Ansible file-lane** (`unraid_settings`, Phase 2) | `share.cfg` (`shareNFSEnabled="yes"`) + `shares/*.cfg` (`shareExportNFS`, `shareSecurityNFS`, `shareHostListNFS`) |
| Array/disk/pool layout | **Manual** ⛔ | Unraid UI — never IaC |
| k8s PVCs (CSI + StorageClass) | **GitOps/Fleet** | Pinned upstream `csi-driver-smb`; source `//nas.owl.red/appdata`, private provisioning/node-stage secret references, retained per-PVC directories and qualified Talos/CIFS support. No passwords in manifests. |
| Proxmox NFS storage (disks/ISO/backup) | **Ansible** (or manual) | `pvesm add nfs …` per content type; bpg/proxmox has no storage resource, so script/Ansible it (codify in a role/playbook) |
| Personal SMB mounts | **Manual / documented** | already exported; fstab/Finder/Explorer |

## Phased rollout (safe order)

1. Inventory application ownership, current consumers and intended grants;
   implement and check the guarded Ansible file lane. Schedule appdata cleanup
   without touching production media. The completed `sharefiles` retirement
   must not be replayed or recreated by inventory/recapture.
2. Qualify power/shutdown and restrict intended exports, excluding `system`.
   Resolve the protected-media activation blocker before enabling NFS; global
   enable is not approved while it would activate that public export.
3. **Kubernetes workloads:** use the accepted SMB StorageClass, qualifying each
   application's ownership, locking, database placement and restore procedure
   before migration. Do not reuse production media for tests. Global NFS
   activation is not required for Kubernetes.
4. **Proxmox shared storage:** `pvesm add nfs nas-vms … --content images,rootdir` (+ `isos`, `backup`) on each node;
   verify a CT can migrate/HA-failover between nodes (unblocks PDM HA — ROADMAP 11/13).
5. **Personal:** confirm SMB mounts; (optional) NFS for Linux desktops.
6. **Document the StorageClass name, NFS paths, and mount rules** back into this guide + README.

## Open items
- Final per-app/PVC layout and safe cleanup within the selected shared appdata.
- Protected media's saved public export versus global NFS activation.
- Keep retired `sharefiles` absent from the Ansible share inventory and snapshot.
- Confirm SMB service-account consumers and private-share grants before creation.
- `no_root_squash` scope per export (PVCs/VM-disks need it; personal must not have it).
- Longhorn evaluation post Unraid→VM migration (removes the NAS SPOF) — ADR 018 / ROADMAP §4.
