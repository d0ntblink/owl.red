# Platform Resilience

This bundle owns PodDisruptionBudgets, not another controller's generated
Bundles or Helm-managed Deployments. Replica counts and workload scheduling
belong to their owning releases.

## Scope

| File | Purpose |
|------|---------|
| `pdbs.yaml` | PodDisruptionBudgets for `cattle-system/rancher`, `cattle-fleet-local-system/fleet-agent`, `metallb-system/metallb-controller` |
| `fleet.yaml` | Adopts the existing PDBs into this release |

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
| Rancher | Rancher Helm values |
| Fleet agent | Supported Cluster settings in the [Fleet bootstrap lane](../rancher/fleet/README.md) |
| MetalLB | MetalLB Helm values |
| cert-manager | cert-manager Helm values |

## Fleet Agent

Fleet generates and reconciles `fleet-local/fleet-agent-local`. Do not copy
that Bundle or its embedded Deployment into this release. Configure its
control-plane toleration using the supported Cluster bootstrap patch.

The current agent has one replica. Its PDB permits one unavailable replica,
allowing a voluntary eviction and rescheduling instead of requiring two
healthy replicas that do not exist. Reconciliation can pause while the agent
restarts; existing application pods continue running. This is not agent HA.
Rancher and MetalLB retain their separate two-available-replica budgets.

Before retiring any previously Helm-managed generated resource, preserve it
with `helm.sh/resource-policy: keep` and verify that policy in the stored
release manifest. Confirm the generated resource survives the transition;
never delete the Bundle or uninstall the agent to repair ownership.

## Notes

- The old `technitium` StatefulSet PDB was removed: Technitium migrated from a k8s
  StatefulSet to an LXC on `edge.pve` (see ADR 013), so there is no in-cluster
  Technitium workload to protect.
- Stateful failover for stateful services is still governed by storage design, not
  by these scheduling/disruption primitives.
