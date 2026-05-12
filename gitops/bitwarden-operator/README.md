# Bitwarden Secrets Manager Operator (GitOps)

This bundle installs the Bitwarden Secrets Manager Kubernetes Operator using Fleet + Helm.

## Bundle Inputs

- Chart: `bitwarden/sm-operator`
- Chart version: `2.0.1`
- Namespace: `sm-operator-system`

## Important Behavior

- The operator syncs secrets from Bitwarden into Kubernetes using `BitwardenSecret` resources.
- This operator is pull-based (Bitwarden -> Kubernetes). Existing Kubernetes secrets are not automatically pushed into Bitwarden.

## Post-Install Required Steps

1. Create a machine account in Bitwarden Secrets Manager.
2. Create a project for cluster-managed secrets.
3. In each target namespace, create `bw-auth-token` with that machine account token:

```bash
kubectl -n <namespace> create secret generic bw-auth-token \
  --from-literal=token='<bitwarden-machine-account-access-token>'
```

4. Create `BitwardenSecret` resources that map Bitwarden secret IDs to Kubernetes secret keys.

Example:

```yaml
apiVersion: k8s.bitwarden.com/v1
kind: BitwardenSecret
metadata:
  name: technitium-admin-sync
  namespace: technitium-namespace
spec:
  organizationId: "<bitwarden-org-id>"
  secretName: technitium-admin
  onlyMappedSecrets: true
  map:
    - bwSecretId: <uuid>
      secretKeyName: admin-password
  authToken:
    secretName: bw-auth-token
    secretKey: token
```

## Migration Recommendation

- Migrate app-owned secrets first (DNS API tokens, admin credentials, TLS issuers).
- Exclude generated service-account token secrets from migration.
