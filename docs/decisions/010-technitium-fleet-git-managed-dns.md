# Decision: Technitium + Fleet + Git-Managed DNS Records

## Status

Selected and implemented as part of the Phase 3 Kubernetes baseline.

## Quick Summary

| Area | Decision |
|------|----------|
| Authoritative DNS | Technitium at `10.0.10.30` |
| Desired-state source | Git-managed RFC 1035 zone file |
| Kubernetes reconciler | Rancher Fleet |
| Drift correction | Fleet-managed CronJob imports the zone through the Technitium API |
| Manual UI edits | Treated as drift and overwritten on the next sync |

## Context

The platform had already selected Talos, vanilla Kubernetes, MetalLB, Traefik, and Fleet. The remaining problem was DNS lifecycle governance: records could still drift through manual UI or API edits, and no in-repo GitOps path existed to enforce the zone consistently.

The requirements were simple:

- repeatable deployment from Git
- one source of truth for `owl.red`
- automatic drift correction

## Decision

Adopt this operating model:

1. Fleet reconciles the Technitium Kubernetes objects from `gitops/technitium` once the Kubernetes baseline exists.
2. Technitium remains authoritative for `owl.red`.
3. DNS records live in Git as an RFC 1035 zone file.
4. A Fleet-managed CronJob imports the Git zone into Technitium with overwrite enabled.
5. Emergency UI edits are temporary until committed back to Git.

## Ownership Boundaries

| Layer | Owner | In scope |
|------|-------|----------|
| Hypervisor, VM lifecycle, network primitives | OpenTofu/Terraform | Proxmox VM lifecycle and infra primitives |
| Mutable host prep and OS-level tasks | Ansible | Host baseline and package or config tasks |
| Kubernetes objects and service configuration | Fleet | Namespaces, Services, StatefulSets, CronJobs, ConfigMaps |
| DNS serving | Technitium | Authoritative answers for `owl.red` |
| DNS desired state | Git zone file in repo | Canonical record data |

## Consequences

| Type | Outcome |
|------|---------|
| Positive | DNS changes become reviewable and auditable through Git |
| Positive | Drift correction is automatic on schedule |
| Positive | Recovery is deterministic: restore cluster, reapply GitRepo, restore secrets |
| Trade-off | API token secret remains out-of-band and must be managed securely |
| Trade-off | Zone serial discipline is still required |
| Trade-off | Emergency UI edits are intentionally temporary |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Bad zone commit replaces valid records | PR review, serial discipline, optional zone lint |
| Missing API token blocks sync | Explicit bootstrap gate and CronJob monitoring |
| CronJob interval leaves a drift window | Short schedule and manual trigger job for immediate correction |

## Validation Gates

| Check | Expected result |
|------|-----------------|
| Fleet bundle readiness | `gitops/technitium` reports ready |
| CronJob health | `technitium-zone-sync` completes successfully |
| DNS lookup | `dig @10.0.10.30 <known-record>.owl.red` returns Git-defined value |
| Drift test | UI-added test record not in Git disappears after the next sync |
