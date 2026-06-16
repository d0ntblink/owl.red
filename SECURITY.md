# Security Policy

Last updated: 2026-06-16

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

## Automated Controls (Implemented)

These enforce the baseline above so it does not depend on memory:

| Control | What it does | Where |
|---------|--------------|-------|
| gitleaks (CI) | Scans every push/PR (full history) for secrets | `.github/workflows/security.yml` |
| gitleaks (pre-commit) | Same scan before each local commit | `.pre-commit-config.yaml` |
| gitleaks config | Allowlists UUID *references* (Bitwarden IDs) and lockfiles to cut false positives | `.gitleaks.toml` |
| BitwardenSecret placeholder guard | Fails CI/commit if a committed `bwSecretId` is empty, a placeholder, or non-UUID (the issue-007 empty-secret trap) | `scripts/check-bitwarden-placeholders.sh` |
| Secret-file ignores | Keeps tfstate / Talos config / keys / kubeconfig / sessions out of git | `.gitignore` |
| Scoped backend TLS | `insecureSkipVerify` is no longer cluster-wide; only the PDM self-signed backend skips verification | `gitops/pdm/pdm-serverstransport.yaml` |

Contributor setup:

```bash
pipx install pre-commit   # or: pip install pre-commit
pre-commit install        # run hooks on every commit
pre-commit run --all-files
```

## Platform-Specific Controls

1. Kubernetes and Talos
- Keep Talos as immutable node OS; do not reintroduce SSH-based mutable node workflows.
- Use Kubernetes RBAC and namespace isolation for workload access.
- Keep ingress and LoadBalancer exposure explicit and documented.
- The `fleet-agent` ClusterRole in `gitops/platform-resilience/fleet-agent-local-bundle-override.yaml`
  is intentionally broad — it reproduces Rancher's stock Fleet-agent role. Fleet is the GitOps
  applier and must apply arbitrary resource kinds, so least-privilege scoping is not feasible
  without breaking reconciliation (see ADR 014; follow-up is to relocate it to Rancher Fleet values).
- Backend TLS verification is on by default. The only exception is the PDM self-signed backend,
  scoped via `gitops/pdm/pdm-serverstransport.yaml`.
- The Traefik dashboard/API (`traefik.owl.red`) is read-only (`api@internal`) and LAN-only; it can
  display routing topology but cannot mutate config — treated as acceptable info-disclosure on the LAN.

2. Network Security
- Preserve VLAN segmentation and least-privilege inter-VLAN policy.
- Keep a break-glass management path available for recovery operations.
- Terraform reaches Proxmox/OPNsense over their self-signed management TLS
  (`PROXMOX_VE_INSECURE=true`, OPNsense `allow_unverified`) — acceptable for LAN-only admin APIs;
  pin a CA if these are ever reached off-LAN.

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

1. ~~Add automated secret scanning (gitleaks) in CI and pre-commit.~~ **Done** — see
   "Automated Controls (Implemented)" above.
2. Enforce branch protection and PR review on the remote repository. Suggested (the check
   contexts must match the Actions job names, adjust if GitHub reports them differently):

   ```bash
   gh api -X PUT repos/d0ntblink/owl.red/branches/main/protection --input - <<'JSON'
   {
     "required_status_checks": {
       "strict": true,
       "checks": [
         {"context": "Secret scanning (gitleaks)"},
         {"context": "BitwardenSecret placeholder guard"}
       ]
     },
     "enforce_admins": true,
     "required_pull_request_reviews": {"required_approving_review_count": 1},
     "restrictions": null
   }
   JSON
   ```

3. Move Terraform state to an encrypted remote backend before multi-operator usage.
   **Decided and scaffolded** — deferred per `docs/decisions/015-terraform-remote-state-deferred.md`
   (a commented `backend` block is ready in each root module).
4. Add signed commits / vigilant mode once remote collaboration begins:

   ```bash
   # Local signing (SSH-key signing shown; GPG also works):
   git config gpg.format ssh
   git config user.signingkey ~/.ssh/id_ed25519.pub
   git config commit.gpgsign true
   # Require signatures on the protected branch:
   gh api -X POST repos/d0ntblink/owl.red/branches/main/protection/required_signatures \
     -H "Accept: application/vnd.github+json"
   ```
