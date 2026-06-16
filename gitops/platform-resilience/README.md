# Platform Resilience

This bundle holds resilience primitives for critical platform workloads that are
**not owned by another Helm release** — currently PodDisruptionBudgets and the
fleet-agent HA override.

## Scope

| File | Purpose |
|------|---------|
| `pdbs.yaml` | PodDisruptionBudgets for `cattle-system/rancher`, `cattle-fleet-local-system/fleet-agent`, `metallb-system/metallb-controller` |
| `fleet-agent-local-bundle-override.yaml` | Patches the Fleet-managed `fleet-local/fleet-agent-local` Bundle to run `fleet-agent` at 3 replicas with control-plane tolerations |
| `fleet.yaml` | `helm.takeOwnership: true` so the bundle adopts the pre-existing PDBs and Bundle in place |

## Why no Deployment overrides here

A previous `critical-deployments.yaml` redefined Deployments (`rancher`,
`cert-manager`, `metallb-controller`, etc.) that are **owned by their own Helm
releases** (verified: `metallb`, `cert-manager`). Shipping them in this separate
Fleet/Helm release caused an ownership conflict and the bundle failed to install
(`invalid ownership metadata ... must be set to "Helm"`).

It was also redundant: those workloads already run HA from their own charts
(e.g. `rancher` and `metallb-controller` are already 3/3 across the cluster).

**Resilience tuning for chart-managed workloads belongs in the owning chart's
values**, where it survives upgrades and does not fight Helm ownership:

| Workload | Where to set tolerations / replicas / resources |
|----------|--------------------------------------------------|
| Traefik | `gitops/traefik/values.yaml` |
| Rancher / Fleet | Rancher Helm values (incl. `fleet-agent` count) |
| MetalLB | MetalLB Helm values |
| cert-manager | cert-manager Helm values |

## What This Bundle Still Enforces

- PodDisruptionBudgets for the critical deployments above (voluntary-disruption safety).
- `fleet-agent` replica/toleration HA via the owning Bundle override (the correct
  mechanism — it patches the Fleet-generated Bundle, not a competing Helm release).

## Notes

- The old `technitium` StatefulSet PDB was removed: Technitium migrated from a k8s
  StatefulSet to an LXC on `edge.pve` (see ADR 013), so there is no in-cluster
  Technitium workload to protect.
- Stateful failover for stateful services is still governed by storage design, not
  by these scheduling/disruption primitives.
