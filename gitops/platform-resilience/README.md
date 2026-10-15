# Platform Resilience

This bundle holds resilience primitives for critical platform workloads that are
intended not to compete with another release. The source currently includes
PodDisruptionBudgets and a legacy Fleet-agent Bundle override; that override is
not a successfully enforced HA configuration.

**Observed 2026-10-14:** the bundle was blocked by a Bundle ownership conflict.
The live Fleet agent had one replica and no control-plane toleration, while its
PDB required two available replicas. Reconcile tuning through the owning Rancher/
Fleet release and verify live Deployment/PDB behavior before dependent node
maintenance. See [G3](../../ROADMAP.md#stabilization-gates) and the
[audit](../../docs/issues/008-live-state-vs-repository.md). This work is independent
of VLAN preparation unless a specific operation depends on it.

## Scope

| File | Purpose |
|------|---------|
| `pdbs.yaml` | PodDisruptionBudgets for `cattle-system/rancher`, `cattle-fleet-local-system/fleet-agent`, `metallb-system/metallb-controller` |
| `fleet-agent-local-bundle-override.yaml` | Desired three-replica/toleration workaround; conflicts with Fleet's ownership and remains pending relocation to the owning release |
| `fleet.yaml` | Requests `helm.takeOwnership: true`; source intent does not prove adoption or resolve cross-controller ownership |

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

## Intended Enforcement And Remaining Work

- Reconcile legitimate PodDisruptionBudget ownership and verify live desired/
  current availability. A PDB does not create replicas or prove failover.
- Put Fleet-agent replicas/tolerations in the owning release, then retire the
  conflicting workaround after a reviewed ownership transition. Do not claim HA
  from the override file or `takeOwnership` flag alone.

## Notes

- The old `technitium` StatefulSet PDB was removed: Technitium migrated from a k8s
  StatefulSet to an LXC on `edge.pve` (see ADR 013), so there is no in-cluster
  Technitium workload to protect.
- Stateful failover for stateful services is still governed by storage design, not
  by these scheduling/disruption primitives.
