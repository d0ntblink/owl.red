# Issue 006 — Fleet bundle stuck on server-side-apply field-ownership conflict

**Date:** 2026-06-15
**Affected bundle:** `owl-red-gitops-metallb` (object `metallb-system/owl-l2-advert`)
**Severity:** Medium — bundle stuck `WaitApplied`; blocks GitOps prune/updates. No data-plane impact (existing VIPs kept announcing).
**Status:** Fixed (object adopted into Fleet SSA ownership); broader pattern Open

---

## Symptoms

After the Technitium k8s→LXC migration (ADR 013) removed `technitium-vip-pool`
from `gitops/metallb/ippool.yaml`, the metallb bundle never converged:

- `kubectl get bundle -A` → `owl-red-gitops-metallb 0/1 WaitApplied(1)`
- The deleted `technitium-vip-pool` IPAddressPool (`10.0.10.30/32`) was **never
  pruned** from the cluster, and `owl-l2-advert` still referenced it.
- `BundleDeployment` reported the **old** revision healthy
  (`Installed/Deployed/Ready/Monitored = True`) while `spec.deploymentID` ≠
  `status.appliedDeploymentID` — i.e. Fleet had a newer desired state it could not apply.

fleet-agent logs (the real error, not visible in `kubectl get bundle`):

```
failed deploying bundle: conflict occurred while applying object
metallb-system/owl-l2-advert metallb.io/v1beta1, Kind=L2Advertisement:
Apply failed with 1 conflict: conflict with "kubectl-client-side-apply"
using metallb.io/v1beta1: .spec.ipAddressPools
```

---

## Root Cause

A **server-side-apply (SSA) field-manager conflict**.

Fleet's agent applies bundle objects with SSA under the field manager
`fleetagent`. The live `owl-l2-advert` had its `.spec.ipAddressPools` field
**co-owned by a different manager**, `kubectl-client-side-apply`, left behind by a
manual `kubectl apply -f ...` during initial bootstrap (the
`gitops/rancher/fleet/README.md` "break-glass manual apply" path, and the
`kubectl.kubernetes.io/last-applied-configuration` annotation it writes).

SSA refuses to let one manager overwrite a field owned by another unless it forces
the conflict. So `fleetagent` could not change `.spec.ipAddressPools` to drop
`technitium-vip-pool`. Helm prune only runs after a successful apply of the new
release revision — which never happened — so the orphaned IPAddressPool persisted.

Confirmed via `managedFields`:

```
$ kubectl -n metallb-system get l2advertisement owl-l2-advert \
    -o jsonpath='{range .metadata.managedFields[*]}{.manager}/{.operation} {end}'
fleetagent/Apply  kubectl-client-side-apply/Update  kubectl-annotate/Update  kubectl-label/Update
```

### What did NOT work (and why)

| Attempt | Result |
|---------|--------|
| `kubectl delete bundledeployment owl-red-gitops-metallb` (let Fleet recreate) | Recreated, same conflict — the conflict is on the live object, not the BundleDeployment. |
| `kubectl patch ... managedFields:[{}]` to wipe owners | Field became **unowned**; API server then attributed it to the synthetic `before-first-apply` manager → conflict persisted with a new name. |
| `kubectl annotate ... last-applied-configuration-` | Removed one source of `before-first-apply`, but the field was still unowned → still conflicted. |

---

## Resolution (Applied)

Give `fleetagent` sole ownership of the field at its **desired** value, forcing the
conflict. This only sets `.spec.ipAddressPools` to the Git-desired list
(`owl-vip-pool`); it does not touch any other field.

```bash
cat > /tmp/owl-l2-advert.yaml <<'EOF'
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: owl-l2-advert
  namespace: metallb-system
spec:
  ipAddressPools:
    - owl-vip-pool
EOF

kubectl apply --server-side --force-conflicts \
  --field-manager=fleetagent -f /tmp/owl-l2-advert.yaml
```

Then force a Fleet re-sync:

```bash
kubectl -n fleet-local patch gitrepo owl-red --type=merge \
  -p '{"spec":{"forceSyncGeneration":'"$(date +%s)"'}}'
```

### Verified after fix

```
owl-red-gitops-metallb            1/1   Ready=True
ipaddresspool: owl-vip-pool only   (technitium-vip-pool pruned)
owl-l2-advert.spec.ipAddressPools: ["owl-vip-pool"]
traefik svc EXTERNAL-IP 10.0.10.201 still allocated/announced  (no ingress impact)
```

No data-plane disruption: `technitium-vip-pool` (`10.0.10.30`) was the old k8s
Technitium VIP, unused since Technitium became an LXC (ADR 013). The Traefik
ingress VIP `10.0.10.201` lives in `owl-vip-pool` and was unaffected throughout.

---

## Why It Happened — Broader Pattern (Open)

The conflicting manager originated from **bootstrapping bundle objects with manual
`kubectl apply`** before/alongside Fleet. Any object created that way carries a
competing field manager (`kubectl-client-side-apply` / `before-first-apply`). It
stays dormant until Fleet next needs to **modify** (not just re-apply) one of those
fields — then the bundle wedges exactly like this.

Other bundles bootstrapped via the README's manual `kubectl apply` path are
susceptible. Symptoms to watch for: a bundle stuck `WaitApplied` with
`status.appliedDeploymentID` lagging `spec.deploymentID`, and a `conflict ...
.spec.<field>` error only visible in fleet-agent logs.

This is also the likely class of the separate, still-open
`owl-red-gitops-traefik` `hash mismatch between secret and bundledeployment` error.

---

## Correct Fix (Durable)

1. **Stop bootstrapping with client-side `kubectl apply`.** Use Fleet/SSA from the
   start, or `kubectl apply --server-side --field-manager=fleetagent` for any
   break-glass manual apply so ownership matches what Fleet uses.
2. **Migrate already-affected objects** to `fleetagent` SSA ownership using the
   `--server-side --force-conflicts --field-manager=fleetagent` adoption shown above
   (set to the Git-desired spec), then let Fleet reconcile.
3. **Update `gitops/rancher/fleet/README.md`** so the "break-glass manual apply"
   instructions use `--server-side --field-manager=fleetagent` rather than plain
   `kubectl apply -f`.
4. **Detection:** add a check that flags bundles where
   `status.appliedDeploymentID != spec.deploymentID` for longer than one sync
   interval (candidate for the recurring validation jobs in setup.md Phase 7).

---

## Diagnostic Commands

```bash
# Bundle vs applied revision (wedge indicator)
kubectl -n cluster-fleet-local-local-<id> get bundledeployment owl-red-gitops-metallb \
  -o jsonpath='want={.spec.deploymentID}{"\n"}have={.status.appliedDeploymentID}{"\n"}'

# Real apply error (not shown by 'get bundle')
kubectl -n cattle-fleet-local-system logs <fleet-agent-pod> --since=10m \
  | rg 'conflict|failed deploying'

# Who owns the contested field
kubectl -n metallb-system get l2advertisement owl-l2-advert \
  -o jsonpath='{range .metadata.managedFields[*]}{.manager}/{.operation} {end}'
```

---

## Environment

- Fleet agent: `rancher/fleet-agent:v0.15.1`, controller-runtime v0.23.1
- Cluster: Talos + vanilla Kubernetes v1.31.1 (cp1–cp3 control-plane, worker1)
- MetalLB via Fleet/Helm release `owl-red-gitops-metallb`, namespace `metallb-system`
- Controller: Ubuntu WSL2

---

## References

- ADR 013 — Technitium LXC as single DNS/DHCP authority (removed `technitium-vip-pool`)
- ADR 014 — Fleet bundle ownership boundaries
- `gitops/metallb/ippool.yaml` — desired state (only `owl-vip-pool`)
- `gitops/rancher/fleet/README.md` — break-glass manual apply instructions (to be updated, see Correct Fix #3)
- Kubernetes SSA conflicts: https://kubernetes.io/docs/reference/using-api/server-side-apply/#conflicts
