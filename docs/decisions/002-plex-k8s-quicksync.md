# Proposal: Plex on Kubernetes with QuickSync

## Status

Proposed (pre-implementation review)

## Context

Plex requires hardware transcoding for 4K streams. Current hardware options:

| Node | GPU | QuickSync |
|------|-----|-----------|
| ThinkCentre M73 (x4) | Intel HD Graphics 4600 | Yes |
| RSV-L4500U (X10SRi-F, E5 Xeon) | Future discrete GPU (planned) | No (without Intel iGPU) |

Placement options:

| Option | Pros | Cons |
|--------|------|------|
| Kubernetes on ThinkCentres | QuickSync available, Fleet-managed | Requires Intel GPU plugin and scheduling controls |
| VM on storage.pve | Close to media files | No QuickSync unless discrete GPU passthrough |
| VM on ThinkCentre | QuickSync available | Outside GitOps/Kubernetes workflow |

## Proposed Decision

Run Plex as a Kubernetes Deployment on designated ThinkCentre nodes with Intel GPU plugin.

Scheduling policy:
- Do not use AVX as a proxy for GPU capability.
- Request Intel GPU extended resource (`gpu.intel.com/i915: 1`).
- Constrain placement using an explicit homelab label such as `owl.red/plex-capable=true` on tested nodes.

Storage policy:
- Mount media over NFS from `nas.owl.red`.
- Keep Plex config and metadata on persistent storage to survive pod rescheduling.

## Risks And Mitigations

- Risk: pod can land on a node without usable `/dev/dri` if labels are wrong.
	Mitigation: label only validated nodes and verify transcoding with a known 4K sample.
- Risk: NFS latency can affect library scans and metadata ops.
	Mitigation: keep metadata on fast PVC and use NFS primarily for media reads.

## Review Gates Before Approval

- Validate Intel plugin advertises `gpu.intel.com/i915` on intended nodes.
- Validate one real hardware transcode from Plex dashboard.
- Validate reschedule behavior (drain node, confirm recovery and playback).

## Consequences If Approved

- Intel GPU plugin DaemonSet is required in cluster base services.
- Plex becomes GitOps-managed and easier to relocate between eligible nodes.