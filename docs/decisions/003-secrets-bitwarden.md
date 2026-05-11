# Proposal: Secrets Management with Bitwarden + ESO

## Status

Proposed (pre-implementation review)

## Context

Secrets are needed by both Ansible and Kubernetes workloads. Secret values must not be committed to git.

## Proposed Decision

Use a two-layer model:

1. Ansible reads infra secrets from Bitwarden Password Manager via `community.general.bitwarden` lookup.
2. Kubernetes syncs workload secrets from Bitwarden Secrets Manager via External Secrets Operator (ESO).

Bootstrap approach:
- `scripts/ansible-run.sh` unlocks vault and exports `BW_SESSION` for playbook runs.
- `scripts/bootstrap-k8s-secrets.sh` seeds only bootstrap credentials required for ESO startup and first cert issuance.
- After bootstrap, normal rotation happens in Bitwarden and ESO reconciles to Kubernetes.

## Homelab Security Baseline (Lightweight)

- No plaintext secrets in repo.
- Bootstrap token should be treated as break-glass and rotated after initial cluster bring-up.
- Use least-privilege Bitwarden machine account for ESO (project-scoped access only).

## Risks And Mitigations

- Risk: stale bootstrap token remains valid too long.
   - Mitigation: rotate token after bootstrap and document recovery runbook.
- Risk: delayed reconciliation can temporarily desync workloads after rotation.
   - Mitigation: define expected sync window and verify critical secret updates manually during initial rollout.

## Review Gates Before Approval

- Validate Ansible can fetch all listed infra secrets without local plaintext files.
- Validate ESO sync for at least one non-critical secret and one cert-manager token.
- Validate break-glass recovery: revoke token and re-bootstrap successfully.

## Secret Mapping (Planned)

| Secret | Where | Accessed by | How |
|--------|-------|-------------|-----|
| `proxmox-root-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `nut-upsmon-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `nut-upsd-admin-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `rancher-bootstrap-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `pbs-admin-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `technitium-admin-password` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `opnsense-api-key` | BW Password Manager login item | Ansible | lookup plugin (`bw get username/password`) |
| `wifi-private-psk` | BW Password Manager login item | Ansible | lookup plugin (`bw get password`) |
| `ssh-ops-pubkey` | BW Password Manager secure note | Ansible | lookup plugin (`bw get notes`) |
| `bitwarden-sm-access-token` | BW Password Manager secure note | Bootstrap script | `bw get notes` seeded into Kubernetes |
| `cloudflare-owl.red-api-token` | BW Secrets Manager (`owl-red-infra`) | ESO | machine account token |
| `plex-claim-token` | BW Secrets Manager (`owl-red-infra`) | ESO | machine account token |