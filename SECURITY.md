# Security Policy

Last updated: 2026-05-10

## Scope

This repository defines infrastructure and automation for the owl.red homelab platform.
The controls below are mandatory for all future changes.

## Security Baseline (Mandatory)

1. Never commit secrets or generated credentials.
- Forbidden in git: API tokens, private keys, session files, Terraform state, Talos generated config, kubeconfig files, vault passwords.
- Enforced by ignore rules in `.gitignore`.

2. Treat local Terraform state as sensitive.
- `terraform.tfstate` and `*.tfstate*` may contain secrets even when marked `sensitive`.
- Preferred future state: encrypted remote state backend with controlled access.

3. Treat Talos generated files as sensitive.
- `talos/config/talosconfig`, `controlplane.yaml`, and `worker.yaml` contain trust roots, keys, and bootstrap data.
- Generate locally, use only for bootstrap/operations, never commit.

4. Use centralized secret management.
- Infrastructure and automation secrets must be stored in Bitwarden organization vaults/secrets manager.
- No plaintext secret files in this repository.

5. Keep least-privilege credentials.
- Use dedicated service tokens (for example Proxmox API token) with minimum required roles.
- Avoid reusing personal admin credentials in automation.

6. Rotate exposed credentials immediately.
- If a secret is suspected to be exposed, rotate first, investigate second.
- Rotation includes API tokens, certs, bootstrap tokens, and any derived credentials.

## Pre-Commit Security Checklist

Before every commit:

1. Verify no sensitive files are staged.
- Run `git status --short` and inspect staged paths.
- Explicitly confirm no `tfstate`, Talos generated config, secret session, or key material is included.

2. Search staged content for high-risk markers.
- Examples: `token`, `secret`, `password`, `private_key`, `client_key`, `api_token`.

3. Confirm intent for infrastructure changes.
- Network, firewall, VLAN, and identity changes require rollback notes in docs/runbooks.

## Platform-Specific Controls

1. Kubernetes and Talos
- Keep Talos as immutable node OS; do not reintroduce SSH-based mutable node workflows.
- Use Kubernetes RBAC and namespace isolation for workload access.
- Keep ingress and LoadBalancer exposure explicit and documented.

2. Network Security
- Preserve VLAN segmentation and least-privilege inter-VLAN policy.
- Keep a break-glass management path available for recovery operations.

3. Backups and Artifacts
- Backup exports must be encrypted at rest when stored outside trusted systems.
- Validation artifacts may be committed only when they do not include secrets.

## Incident Response (Repository Scope)

If a secret is committed or suspected exposed:

1. Revoke and rotate affected credentials immediately.
2. Remove sensitive files from tracked history if required.
3. Audit related systems for unauthorized access.
4. Record incident summary and remediation actions in docs.

## Future Hardening Recommendations

1. Add automated secret scanning (for example gitleaks) in CI and pre-commit.
2. Enforce branch protection and pull request review on the remote repository.
3. Move Terraform state to encrypted remote backend before multi-operator usage.
4. Add signed commits or vigilant mode once remote collaboration begins.
