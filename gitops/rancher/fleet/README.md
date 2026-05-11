# Fleet Bootstrap Manifests

This directory contains bootstrap manifests for Rancher Fleet `GitRepo` resources.

## Which File To Apply

Use the manifest that matches the Fleet namespace present in your cluster:

```bash
kubectl get ns | rg '^fleet-(local|default)$'
```

- If `fleet-local` exists, apply `gitrepo-owl-red-fleet-local.yaml`.
- If `fleet-default` exists (and `fleet-local` does not), apply `gitrepo-owl-red-fleet-default.yaml`.

## Required Git Credential Secret

The GitHub repo is private. Create a Fleet credential secret in the same namespace where the `GitRepo` object will live:

```bash
# For fleet-local namespace
kubectl -n fleet-local create secret generic owl-red-github-auth \
	--type=kubernetes.io/basic-auth \
	--from-literal=username='<github-username>' \
	--from-literal=password='<github-personal-access-token>'

# For fleet-default namespace
kubectl -n fleet-default create secret generic owl-red-github-auth \
	--type=kubernetes.io/basic-auth \
	--from-literal=username='<github-username>' \
	--from-literal=password='<github-personal-access-token>'
```

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

Expected outcome: Fleet starts reconciling these paths from `https://github.com/d0ntblink/owl.red.git` on branch `main`:
- `gitops/technitium`
- `gitops/metallb`
- `gitops/cert-manager`

## Adoption Strategy

This bootstrap now targets:
- `gitops/technitium`
- `gitops/metallb`
- `gitops/cert-manager`

Reason: Fleet uses Helm under the hood for bundle deployment. Existing resources that were installed outside Fleet (for example MetalLB objects) can fail ownership checks if included immediately.

Traefik is intentionally deferred in this phase. Current Traefik configuration is values-only (`gitops/traefik/values.yaml`) and should be onboarded as an explicit Fleet Helm bundle in a dedicated step.
