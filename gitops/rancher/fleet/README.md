# Fleet Bootstrap Manifests

This directory contains the bootstrap `GitRepo` manifests for Rancher Fleet.

## Quick Reference

| Item | Value |
|------|-------|
| Repo URL | `https://github.com/d0ntblink/owl.red.git` |
| Branch | `main` |
| Secret name | `owl-red-github-auth` |
| Namespace detection | `kubectl get ns | rg '^fleet-(local|default)$'` |
| Apply one of | `gitrepo-owl-red-fleet-local.yaml` or `gitrepo-owl-red-fleet-default.yaml` |

## Bootstrap Steps

| Step | Action | Expected result |
|------|--------|-----------------|
| 1 | Detect whether `fleet-local` or `fleet-default` exists | One Fleet namespace is confirmed |
| 2 | Create `owl-red-github-auth` in that same namespace | Fleet can authenticate to the private repo |
| 3 | Apply the matching `GitRepo` manifest | Fleet starts reconciling repo paths |
| 4 | Verify `GitRepo`, `Bundle`, and `BundleDeployment` health | Bundles move to ready state |

## Create The Git Credential Secret

```bash
kubectl -n fleet-local create secret generic owl-red-github-auth \
  --type=kubernetes.io/basic-auth \
  --from-literal=username='<github-username>' \
  --from-literal=password='<github-personal-access-token>'

kubectl -n fleet-default create secret generic owl-red-github-auth \
  --type=kubernetes.io/basic-auth \
  --from-literal=username='<github-username>' \
  --from-literal=password='<github-personal-access-token>'
```

Use only the command for the namespace that actually exists in the cluster.

## Apply

> **Always apply break-glass manifests with server-side apply under the
> `fleetagent` field manager.** Plain `kubectl apply -f` uses the
> `kubectl-client-side-apply` field manager, which later conflicts with Fleet's
> own server-side apply and wedges the bundle (`conflict ... .spec.<field>`,
> bundle stuck `WaitApplied`). See [issue 006](../../../docs/issues/006-fleet-ssa-field-ownership-conflict.md).

```bash
kubectl apply --server-side --field-manager=fleetagent \
  -f gitops/rancher/fleet/gitrepo-owl-red-fleet-local.yaml
# or
kubectl apply --server-side --field-manager=fleetagent \
  -f gitops/rancher/fleet/gitrepo-owl-red-fleet-default.yaml
```

## Verify

```bash
kubectl get gitrepo -A
kubectl get bundle -A | rg owl-red
kubectl get bundledeployment -A | rg owl-red
```

Fleet should begin reconciling:

- `gitops/technitium-ingress`
- `gitops/metallb`
- `gitops/cert-manager`
- `gitops/traefik`
- `gitops/dashboards`
- `gitops/bitwarden-operator`
- `gitops/bitwarden-secrets`
- `gitops/pdm`
- `gitops/platform-resilience`

## Adoption Notes

- Some resources were originally installed outside Fleet and may need ownership adoption before Fleet can manage them cleanly.
- This is most relevant for Helm-managed or pre-existing objects such as MetalLB resources.
- Traefik is onboarded as a dedicated Fleet Helm bundle using the upstream chart and `gitops/traefik/values.yaml`, preserving continuity with the existing release name.
- If a bundle is stuck `WaitApplied` with a `conflict ... using ... .spec.<field>`
  error in the fleet-agent logs, a stale `kubectl-client-side-apply` /
  `before-first-apply` field manager owns the field. Re-assert ownership with:
  `kubectl apply --server-side --force-conflicts --field-manager=fleetagent -f <desired.yaml>`
  then force a sync. Full procedure in [issue 006](../../../docs/issues/006-fleet-ssa-field-ownership-conflict.md).

