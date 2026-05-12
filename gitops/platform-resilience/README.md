# Platform Resilience Overlays

This bundle applies reliability-focused overlays to critical platform workloads so they can run on any node (including control-plane nodes), spread across hosts, and survive voluntary disruptions better.

## Scope

This folder patches these workloads:

- `traefik/traefik` (via chart values in `gitops/traefik/values.yaml`)
- `technitium-namespace/technitium` (StatefulSet in `gitops/technitium`)
- `cattle-system/rancher`
- `cattle-system/rancher-webhook`
- `cattle-fleet-system/fleet-controller`
- `cattle-fleet-local-system/fleet-agent`
- `cattle-fleet-system/gitjob`
- `cattle-fleet-system/helmops`
- `metallb-system/metallb-controller`
- `cert-manager/cert-manager`
- `cert-manager/cert-manager-cainjector`
- `cert-manager/cert-manager-webhook`

## What It Enforces

- Control-plane fallback tolerations (`node-role.kubernetes.io/control-plane:NoSchedule`)
- Topology spread and anti-affinity hints across `kubernetes.io/hostname`
- Explicit container CPU/memory requests and limits for critical services
- PodDisruptionBudgets for critical deployments/statefulsets

## Important Notes

- These overlays intentionally patch some Helm-managed deployments (Rancher/Fleet/cert-manager).
- During chart upgrades, upstream chart defaults may overwrite these fields temporarily; Fleet reconciliation will re-apply this bundle.
- `fleet-agent` is generated from the `fleet-local/fleet-agent-local` Bundle. To make replica/toleration changes persistent, this folder includes `fleet-agent-local-bundle-override.yaml`, which updates that Bundle's embedded `agent.yaml` content.
- This improves scheduling resilience, but stateful storage design still determines true failover for stateful services.
