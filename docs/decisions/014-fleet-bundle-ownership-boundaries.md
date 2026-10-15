# Decision 014: Fleet Bundle Ownership Boundaries

## Status

Accepted ownership policy. The June implementation history below is not proof
of current convergence: the 2026-10-14 audit found `platform-resilience` blocked
by Fleet Bundle ownership, and its agent replica/toleration override unapplied.
Follow the existing owning-release direction below and verify runtime state
under [G3](../../ROADMAP.md#stabilization-gates); this is not a blanket prerequisite
for network preparation.

## Quick Summary

| Area | Decision |
|------|----------|
| Chart-owned workloads | Never redefined in a separate Fleet/Helm bundle; tuned in the owning chart's values |
| Out-of-band resources | Adopted into their Fleet/Helm release with `helm.takeOwnership: true` |
| `platform-resilience` scope | Legitimate unowned PDBs; the legacy Bundle override is pending relocation to the owning Rancher/Fleet release, not enforced HA |
| Stale k8s Technitium objects | Removed (Technitium is now an LXC, ADR 013) |
| GitRepo path for Technitium ingress | `gitops/technitium-ingress` (the bundle with manifests), not `gitops/technitium` (data only) |

## Context

The Fleet `GitRepo` (`owl-red`, namespace `fleet-local`) reconciles a fixed list of
`gitops/*` paths. After the Technitium migration (ADR 013), `kubectl apply` of the
GitRepo surfaced several bundles stuck `NotReady`. Investigation against the live
cluster found three distinct root causes — not one bug:

1. **Wrong path.** `gitops/technitium` contains only desired-state data consumed by
   the LXC (zone file + DHCP/settings JSON) and **no** Kubernetes manifests, so it
   produced a resourceless bundle. The real ingress bundle,
   `gitops/technitium-ingress` (namespace, Service/Endpoints → `10.0.10.30:5380`,
   Traefik IngressRoute for `dns.owl.red`, LE cert), was **never** in the GitRepo
   paths and therefore was never deployed.

2. **Ownership metadata conflicts.** `bitwarden-secrets`, `pdm`, and
   `platform-resilience` each tried to install resources that already existed in the
   cluster from out-of-band `kubectl apply` (BitwardenSecret CRs, the
   `infra-services` namespace, and 30+ day-old PDBs). Helm refused to adopt them:
   `invalid ownership metadata ... missing key "app.kubernetes.io/managed-by": must
   be set to "Helm"`.

3. **Cross-release Deployment redefinition.** `platform-resilience/critical-deployments.yaml`
   redefined Deployments (`rancher`, `cert-manager`, `metallb-controller`,
   `fleet-controller`, etc.) that are **owned by their own Helm releases** (verified
   on-cluster: `metallb`, `cert-manager`). A second Fleet/Helm release cannot own
   another release's objects, so the bundle could never install. The override was
   also redundant — those workloads already run HA from their own charts
   (`rancher` and `metallb-controller` were already 3/3 across the cluster).

## Decision

Establish a clear ownership boundary for Fleet bundles:

1. **A Fleet/Helm bundle must not redefine resources owned by another Helm release.**
   Resilience tuning (replicas, tolerations, anti-affinity, resource requests/limits)
   for chart-managed workloads belongs in that chart's values, where it survives
   chart upgrades and does not fight Helm ownership.

   | Workload | Tuning location |
   |----------|-----------------|
   | Traefik | `gitops/traefik/values.yaml` |
   | Rancher / Fleet (incl. `fleet-agent` count) | Rancher Helm values |
   | MetalLB | MetalLB Helm values |
   | cert-manager | cert-manager Helm values |

2. **Resources created out-of-band that a bundle legitimately owns are adopted with
   `helm.takeOwnership: true`** in that bundle's `fleet.yaml`, rather than deleting
   and recreating them. Applied to `bitwarden-secrets`, `pdm`, and
   `platform-resilience`.

3. **`platform-resilience` must keep only primitives it legitimately owns.**
   `critical-deployments.yaml` was removed. The remaining `fleet-agent-local`
   Bundle override is a historical workaround, not an ownership-safe exception:
   October evidence shows it still conflicts with Fleet's objectset controller.
   Move tuning into the owning Rancher/Fleet release and retire the workaround
   through a reviewed transition; verify Deployment/PDB state rather than
   assuming `helm.takeOwnership` resolves competing controllers.

4. **GitRepo paths reference bundles that contain manifests.** `gitops/technitium`
   (LXC data) is replaced by `gitops/technitium-ingress` in both
   `gitrepo-owl-red-fleet-local.yaml` and `gitrepo-owl-red-fleet-default.yaml`.

5. **Stale k8s Technitium objects are removed.** The `technitium` /
   `technitium-namespace` StatefulSet PDB no longer has a backing workload (ADR 013).

## Scope Of Changes

| Path | Change |
|------|--------|
| `gitops/rancher/fleet/gitrepo-owl-red-fleet-local.yaml` | `gitops/technitium` → `gitops/technitium-ingress` |
| `gitops/rancher/fleet/gitrepo-owl-red-fleet-default.yaml` | `gitops/technitium` → `gitops/technitium-ingress` |
| `gitops/rancher/fleet/README.md` | Path list updated |
| `gitops/platform-resilience/critical-deployments.yaml` | Removed |
| `gitops/platform-resilience/pdbs.yaml` | Removed stale `technitium` PDB |
| `gitops/platform-resilience/fleet.yaml` | Added `helm.takeOwnership: true` |
| `gitops/platform-resilience/README.md` | Rewritten to narrowed scope |
| `gitops/pdm/fleet.yaml` | Added `helm.takeOwnership: true` |
| `gitops/bitwarden-secrets/fleet.yaml` | New: `helm.takeOwnership: true` |

## Consequences

| Type | Outcome |
|------|---------|
| Intended | Bundles converge without cross-release ownership conflicts; Technitium ingress is deployed, but the resilience Bundle conflict remains open |
| Intended | Owning-chart tuning survives upgrades without competing controllers; runtime evidence is required |
| Positive | Single, documented rule for where resilience config lives |
| Trade-off | `takeOwnership` makes Helm adopt and subsequently manage/prune the matching pre-existing resources — acceptable because each had no prior Helm owner |
| Trade-off | The Bundle override did not establish fleet-agent HA; replicas/tolerations/PDB need owning-release reconciliation |
| Follow-up | Move `fleet-agent` replica/toleration config into Rancher's Fleet values so the `fleet-agent-local-bundle-override.yaml` workaround can eventually be retired |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| `takeOwnership` adopts an unintended pre-existing object | Bundles are scoped to specific namespaces/resources; each adopted resource was verified on-cluster before enabling |
| `fleet-agent-local` Bundle is also claimed by Fleet's objectset controller | This remains an observed blocker, not harmless noise. Relocate tuning to the owning release and verify convergence before dependent maintenance. |
| Resilience tuning lost by deleting `critical-deployments.yaml` | None at current state — rancher/metallb already run HA from their charts; remaining tuning is relocated to chart values |
| Changes do not take effect | Fleet reconciles from `origin/main`; changes must be committed and pushed, then optionally force-synced |

## Validation Gates

| Check | Command | Expected |
|-------|---------|----------|
| Bundles healthy | `kubectl get bundle -A \| rg owl-red` | All `owl-red-gitops-*` report ready, no `invalid ownership metadata` |
| Ingress deployed | `kubectl -n technitium get ingressroute,svc,endpoints` | `technitium` IngressRoute + Service/Endpoints present |
| TLS issued | `kubectl -n technitium get certificate technitium-tls` | `Ready=True` |
| PDBs adopted | `kubectl get pdb -A \| rg 'rancher\|fleet-agent\|metallb'` | Present, no install conflict |
| No stale Technitium PDB | `kubectl get pdb -A \| rg technitium` | No result |
| Force re-sync (if needed) | `kubectl -n fleet-local patch gitrepo owl-red --type=merge -p '{"spec":{"forceSyncGeneration":1}}'` | GitRepo re-reconciles |

## Related

- ADR 010 — Technitium + Fleet + Git-managed DNS
- ADR 013 — Technitium LXC as single DNS/DHCP authority (the migration that orphaned the stale k8s objects)
- ADR 003 — Secrets management with Bitwarden (BitwardenSecret CRs adopted here)
- ADR 011 — PDM on Proxmox LXC (the `infra-services`/`pdm` bundle adopted here)
