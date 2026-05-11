# Decision: Technitium + Fleet + Git-Managed DNS Records

## Status

Selected: Phase 3+ implementation baseline (2026-05-10)

## Context

The platform has already selected Talos + vanilla Kubernetes, MetalLB, Traefik, and Rancher Fleet for GitOps reconciliation. DNS is authoritative on Technitium at `10.0.10.30`.

The remaining gap was DNS record lifecycle governance:
- Records were partially managed operationally through web/API actions.
- Fleet was selected architecturally, but no concrete Fleet/GitRepo objects existed in-repo.
- Drift protection for DNS records was not yet automated.

Project requirements for this decision:
- Repeatable deployments from Git
- Drift protection (auto-correction)
- One source of truth

## Decision

Adopt the following operating model:

1. Fleet reconciles Kubernetes manifests for DNS from this repository in phase 1 (`gitops/technitium`).
2. Technitium remains the authoritative DNS server for `owl.red`.
3. DNS records for `owl.red` are stored in Git as an RFC 1035 zone file.
4. A Fleet-managed CronJob imports the Git zone into Technitium on a schedule via Technitium API:
   - Creates zone if missing
   - Imports zone with `overwrite=true` and `overwriteZone=true`
5. Manual UI edits are treated as drift and will be overwritten by the next sync cycle.

## Ownership Boundaries

| Layer | Owner | In Scope |
|---|---|---|
| Hypervisor, VM lifecycle, network primitives | OpenTofu/Terraform | Proxmox VM lifecycle and infra primitives |
| Mutable host prep and OS-level tasks | Ansible | Host baseline, package/config tasks |
| Kubernetes objects and service configuration | Fleet (GitOps) | Namespaces, Services, StatefulSets, CronJobs, ConfigMaps |
| DNS authority and serving | Technitium | Authoritative answers for `owl.red` |
| DNS desired state (records) | Git zone file in repo | Canonical record data |

Fleet scope expansion:
- Phase 1: `gitops/technitium`
- Phase 2: `gitops/metallb`, `gitops/cert-manager`
- Phase 3: `gitops/traefik` via explicit Fleet Helm bundle (release `traefik`, chart `traefik` from `https://traefik.github.io/charts`, values from Git).

## Consequences

Positive:
- DNS changes are reviewable and auditable through PRs.
- Drift correction is automatic on schedule.
- Recovery is deterministic: restore cluster + apply GitRepo + secrets.

Trade-offs:
- API token secret is still out-of-band and must be managed securely.
- Zone file serial must be maintained when records change.
- Intentional emergency DNS UI changes are temporary unless committed back to Git.

## Risks And Mitigations

- Risk: Bad zone file commit could replace valid production records.
  - Mitigation: Require PR review + serial discipline + optional pre-merge zone lint.
- Risk: Missing API token secret blocks sync.
  - Mitigation: Explicit bootstrap gate in runbook and alert on CronJob failures.
- Risk: CronJob schedule creates drift window.
  - Mitigation: Short interval (15 minutes) and on-demand manual trigger job.

## Validation Gates

- Fleet GitRepo reports `Ready` for `gitops/technitium` bundle.
- CronJob `technitium-zone-sync` has successful run.
- `dig @10.0.10.30 <known-record>.owl.red` returns Git-defined value.
- UI-added test record not in Git disappears after sync interval.
