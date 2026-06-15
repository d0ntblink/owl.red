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

```bash
kubectl apply -f gitops/rancher/fleet/gitrepo-owl-red-fleet-local.yaml
# or
kubectl apply -f gitops/rancher/fleet/gitrepo-owl-red-fleet-default.yaml
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
