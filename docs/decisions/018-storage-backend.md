# Decision 018: Shared storage — NFS from the NAS now, Longhorn later

## Status

Accepted (2026-06-18). NFS not yet enabled on the box — see the rollout in
[`docs/guides/shared-storage.md`](../guides/shared-storage.md).

## Context

HA / stateful workloads need shared storage: k8s PVCs (Home Assistant, *arr config, etc.),
Proxmox CT/VM disks on shared storage so guests can **fail over between nodes** (e.g. PDM HA,
ADR 011/§13), and general data. `nas.owl.red` (Unraid) is already the data hub (HBAs, ~42 TB).

## Decision

Use **NFS exports from `nas.owl.red`** as the shared store now, **reusing the existing shares**
(no new share scheme). **NFS** serves the HA/infra consumers — k8s (via an NFS CSI driver +
`StorageClass`), Proxmox (`pvesm` NFS storage for `images`/`rootdir`/`iso`/`backup`), and other
LXC/VMs — while **SMB** stays for personal devices. NFS exports are **host-restricted to VLAN 10**
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
- NFS is plaintext, so exports are LAN/VLAN-10-only and host-restricted; the current `media` `public`
  export must be tightened before enabling NFS.
- The NFS CSI driver + `StorageClass` become a Fleet-managed cluster dependency.
- Reusing `appdata` for PVCs (under a `/k8s` subpath) blurs Unraid's own docker appdata vs cluster data —
  mitigated by the subpath; revisit a dedicated share if needed.

See [`docs/guides/shared-storage.md`](../guides/shared-storage.md) and ROADMAP §4.
