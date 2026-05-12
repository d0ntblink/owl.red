# Bitwarden Secret Sync Resources

This path stores `BitwardenSecret` custom resources rendered for application namespaces.

## Workflow

1. Install operator bundle from `gitops/bitwarden-operator`.
2. Push selected Kubernetes secrets into Bitwarden and render `BitwardenSecret` manifests:

```bash
BW_PROJECT_ID=<project-id> \
BW_ORGANIZATION_ID=<organization-id> \
BWS_ACCESS_TOKEN=<machine-account-token> \
scripts/bitwarden-k8s-secrets-sync.sh
```

3. Review generated files under `gitops/bitwarden-secrets/generated/`.
4. Ensure each target namespace has a `bw-auth-token` secret with the machine account token.
5. Commit and let Fleet reconcile.

## Notes

- Generated manifests map explicit secret keys (`onlyMappedSecrets: true`).
- Service-account token secrets are excluded by default in the migration script.
