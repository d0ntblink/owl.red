# Security Policy

Last updated: 2026-10-14

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

Source definitions do not prove runtime enforcement. The 2026-10-14
[live audit](docs/issues/008-live-state-vs-repository.md) found that Fleet had not
fully converged and Traefik still skipped backend TLS verification globally.
Close the applicable [roadmap gates](ROADMAP.md#stabilization-gates) before
depending on the declared controls for further deployment.

| Control | What it does | Where |
|---------|--------------|-------|
| gitleaks (CI) | Scans every push/PR (full history) for secrets | `.github/workflows/security.yml` |
| gitleaks (pre-commit) | Same scan before each local commit | `.pre-commit-config.yaml` |
| gitleaks config | Allowlists UUID *references* (Bitwarden IDs) and lockfiles to cut false positives | `.gitleaks.toml` |
| BitwardenSecret placeholder guard | Fails CI/commit if a committed `bwSecretId` is empty, a placeholder, or non-UUID (the issue-007 empty-secret trap) | `scripts/check-bitwarden-placeholders.sh` |
| Secret-file ignores | Keeps tfstate / Talos config / keys / kubeconfig / sessions out of git | `.gitignore` |
| Scoped backend TLS (runtime gap open) | Source permits only the PDM self-signed exception; audit still found the global runtime flag, requiring Fleet reconciliation and verification | `gitops/pdm/pdm-serverstransport.yaml`; roadmap G3 |

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
- Required policy: verify backend TLS by default. The only approved exception is the PDM
  self-signed backend, scoped via `gitops/pdm/pdm-serverstransport.yaml`. The audit's global
  runtime exception violates that policy; a source edit alone does not close the gap.
- The Traefik dashboard/API (`traefik.owl.red`, `api@internal`) exposes read-only routing
  information, but must still be restricted to verified management sources. No IP-allowlist
  middleware was found; private addressing alone is not proof of access restriction.

2. Network Security
- Implement the target segmentation and least-privilege policy through the
  [roadmap execution order](ROADMAP.md#execution-order); the audited live network
  is flat, not already isolated. Resolve legacy `/16` overlap before routing its
  contained target `/24`s.
- Preserve client DNS/DHCP on VyOS during preparation. Attach Technitium VLAN
  interfaces only after proving the replacement scopes cannot issue competing
  offers; transfer authority in an approved coordinated handoff. Final DNS
  enforcement follows successful path, renewal and rollback checks.
- Keep a tested recovery path for each affected management link. A reachable
  BMC/PDU or a console reached through the same failed path is not proof of
  independent recovery. CSS326 has no serial console; verify a physical access
  port and saved switch configuration before management-VLAN changes.
- Publishing is an operational action: a new Git revision, even documentation
  only, can trigger the Technitium timer's full settings/zone/scope sync. Review
  that effect and coordinate its serving-state guard before a push.
- Terraform's Proxmox management TLS exception (`PROXMOX_VE_INSECURE=true`) is
  scoped to the existing private API; pin its CA rather than extending a global
  bypass. VyOS management uses strictly pinned SSH host keys, not the retired
  router provider or its TLS settings.

3. Backups and Artifacts
- Backup exports must be encrypted at rest when stored outside trusted systems.
- Validation artifacts may be committed only when they do not include secrets.
- Before a live network change, retain the affected configuration and any state
  being changed outside the affected system, with its exact rollback and tested
  access method. This does not require a full NAS-data backup or completion of
  PBS. The user confirmed no backups exist; that separate protection gap remains.
- NAS keyboard/monitor access is available for network recovery. Network work
  does not authorize changes to NAS VM passthrough, disks, array, boot, power or
  unrelated services. Storage/destructive maintenance requires its own approved
  protection plan; the audit's empty parity2 slot does not imply disk repair.

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
