# Decision 018: NAS-Backed Shared Storage

## Status

Accepted (2026-06-18). NFS not yet enabled on the box — see the rollout in
[`docs/guides/shared-storage.md`](../guides/shared-storage.md).

Owner amendment (2026-10-18): keep one mixed NAS/Kubernetes `appdata` share;
schedule inventory/cleanup instead of creating a separate Kubernetes share.
Retire `sharefiles` only after consumer/data-retention review. Production
`media` is protected, including paths, data, share security and exports; no
merge, relocation or permission change is authorized. These boundaries govern
the earlier rollout below. Global NFS activation remains blocked because it
would activate media's saved public export. No live changes have been made.

The owner selected authenticated **SMB for Kubernetes**, with a dedicated
`k8s` account and upstream `csi-driver-smb`; this supersedes the earlier
Kubernetes NFS proposal. Retain per-PVC data and keep credentials in the private
Bitwarden/Kubernetes secret lane. Backup/scanner identities are planned until
their consumers exist. Reuse current root/PC identities. Follow the
[no-fallback data-protection constraint](../guides/unraid-making-changes.md#no-fallback-operating-constraint);
no driver, user, share permission or NAS service change is claimed.

## Context

Owner amendment (2026-10-21): Longhorn is selected now for database-safe
single-writer block volumes, subject to node/disk qualification and tested
reattachment. Ordinary application configuration files remain live in the NAS
`appdata` share over SMB. Database files use Longhorn only where the application
supports a separate database directory or a qualified mount layout. Do not
silently move all configuration away from `appdata`, or present Longhorn
backups as an editable live configuration tree. Applications that cannot safely
separate these paths require an explicit per-app decision before migration.

Longhorn replicas must use suitable node-local storage on different physical
Proxmox hosts, not SMB-mounted replica directories. Talos system extensions,
mount propagation, resource capacity and safe single-writer failover must be
qualified before moving production databases. Existing NAS config/data and
media access remain unchanged during preparation. Node reboots and new-disk
formatting require a scoped rollout review; they are not implicit app moves.

HA / stateful workloads need shared storage: k8s PVCs (Home Assistant, *arr config, etc.),
Proxmox CT/VM disks on shared storage so guests can **fail over between nodes** (e.g. PDM HA,
ADR 011/§13), and general data. `nas.owl.red` (Unraid) is already the data hub (HBAs, ~42 TB).

## Decision

Use **NAS-backed storage with shared appdata**. **SMB** serves Kubernetes PVCs
and authenticated PC access. **NFS** remains proposed for Proxmox and reviewed
infrastructure consumers, not Kubernetes. NFS exports are host-restricted
(`shareSecurityNFS="private"` + `shareHostListNFS`), never `public`; `no_root_squash` only on the
cluster/Proxmox exports. Unraid NFS enable + export config is owned by the **Ansible file-lane**
(`unraid_settings`); array/disk layout stays **manual**.

Accept the NAS as a **short-term single point of failure** for HA workloads. Plan **Longhorn**
(cluster-native, replicated) medium-term — after the Unraid→VM migration — to remove that SPOF for
cluster PVCs; the NAS would then back media/backups/bulk rather than live HA state.

## Alternatives rejected

- **Longhorn now** — the better long-term answer (no SPOF), but wants the Unraid→VM migration done and
  more cluster capacity first; deferred, not dropped.
- **Ceph** — resilient but operationally heavy for four small ThinkCentre nodes.
- **Per-node local storage only** — no failover; defeats the HA goal.
- **A new dedicated share scheme** — rejected in favor of reusing existing shares (less churn); a dedicated
  `cluster` share remains an option if reuse proves messy (mixing cluster PVCs with Unraid docker `appdata`).

## Consequences

- Simple and works today; unblocks k8s stateful apps and Proxmox CT/VM HA failover.
- **The NAS is a SPOF for everything HA** until Longhorn — documented and accepted short-term.
- NFS is plaintext and host-restricted. Resolve protected media's latent public
  export through a separately agreed approach before enabling NFS; do not
  silently activate it or change media permissions under the storage work.
- SMB CSI, private secret mappings and the StorageClass become Fleet-managed
  cluster dependencies, subject to qualification on the existing Talos baseline.
- Mixed `appdata` is the owner's selected model. Final per-app/PVC paths and
  database compatibility require review; avoid simultaneous old/new writers.
- SMB users govern authenticated SMB access; shared Kubernetes credentials are
  not a strong per-application isolation boundary. Proxmox NFS has a separate
  host/UID policy. Untouched media remains guest-readable under its current
  SMB policy; do not claim denial without changing that explicit exception.

See [`docs/guides/shared-storage.md`](../guides/shared-storage.md) and ROADMAP §4.
