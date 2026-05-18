# Decision 002: Plex on Kubernetes with QuickSync

## Status

Proposed for post-platform implementation review.

## Quick Summary

| Area | Direction |
|------|-----------|
| Preferred placement | Kubernetes on QuickSync-capable ThinkCentre nodes |
| GPU requirement | Intel iGPU exposed through the Intel GPU plugin |
| Scheduling control | Explicit node label such as `owl.red/plex-capable=true` |
| Media storage | NFS from `nas.owl.red` |
| Metadata storage | Persistent storage separate from media path |

## Context

Plex needs real hardware transcoding for 4K workloads. The ThinkCentre nodes provide Intel QuickSync; the storage server does not unless a discrete GPU is added and passed through.

## Placement Options

| Option | Pros | Cons |
|--------|------|------|
| Kubernetes on ThinkCentres | QuickSync available, GitOps-managed, consistent with cluster direction | Requires Intel GPU plugin and careful scheduling |
| VM on `storage.pve` | Close to media files | No QuickSync without discrete GPU passthrough |
| VM on ThinkCentre | QuickSync available | Falls outside the GitOps and Kubernetes operating model |

## Preferred Direction

Run Plex as a Kubernetes Deployment on designated ThinkCentre nodes with the Intel GPU plugin.

## Scheduling And Storage Policy

| Area | Policy |
|------|--------|
| GPU scheduling | Request `gpu.intel.com/i915: 1` |
| Node selection | Use an explicit tested-node label such as `owl.red/plex-capable=true` |
| Placement rule | Do not use AVX as a proxy for GPU capability |
| Media path | Mount media over NFS from `nas.owl.red` |
| Metadata path | Keep config and metadata on persistent storage so rescheduling is survivable |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Pod lands on a node without usable `/dev/dri` | Label only validated nodes and verify with a known 4K hardware transcode |
| NFS latency affects scans or metadata work | Keep metadata on faster persistent storage and use NFS primarily for media reads |

## Validation Gates

- Intel plugin advertises `gpu.intel.com/i915` on intended nodes.
- One real hardware transcode succeeds from the Plex dashboard.
- Plex survives a node drain with acceptable recovery and playback behavior.

## Consequences

- The Intel GPU plugin becomes a cluster dependency.
- Plex can remain GitOps-managed and portable across validated nodes.