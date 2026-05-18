# Decision 003: Secrets Management with Bitwarden + SM Operator

## Status

Accepted and in implementation.

## Quick Summary

| Area | Decision |
|------|----------|
| Infrastructure secrets | Ansible reads from Bitwarden Password Manager |
| Kubernetes workload secrets | Bitwarden Secrets Manager sync via the Kubernetes Operator |
| Repo policy | No plaintext secrets in Git |
| Bootstrap path | `scripts/ansible-run.sh` unlocks Bitwarden and exports `BW_SESSION` |

## Decision

Use a two-layer secrets model:

1. Ansible reads infrastructure secrets from Bitwarden Password Manager through `community.general.bitwarden` lookup.
2. Kubernetes workloads receive synced secrets from Bitwarden Secrets Manager through the Bitwarden Secrets Manager Kubernetes Operator.

## Operating Model

| Layer | Mechanism | Scope |
|------|-----------|-------|
| Ansible | Bitwarden Password Manager lookup | Infrastructure passwords, API credentials, SSH material |
| Kubernetes | Bitwarden Secrets Manager Operator | Workload secrets exposed through `BitwardenSecret` objects |
| Namespace bootstrap | `bw-auth-token` secret per namespace | Machine-account authentication for operator sync |

## Security Baseline

- No plaintext secrets in the repository.
- Machine-account tokens must be least-privilege and scoped to the project.
- Bootstrap tokens are break-glass material and should be rotated on schedule.

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Machine-account token remains valid too long | Rotate on a fixed cadence and validate sync after rotation |
| Generated or system secrets are synced accidentally | Migrate app-owned secrets first and explicitly exclude service-account token secrets |

## Review Gates

- Validate that Ansible can fetch all listed infrastructure secrets without local plaintext files.
- Validate operator sync for at least one non-critical secret and one cert-manager token.
- Validate break-glass recovery by revoking a token and re-establishing sync with a new one.

## Secret Mapping

| Secret | Source | Accessed by | Retrieval path |
|--------|--------|-------------|----------------|
| `proxmox-root-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `nut-upsmon-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `nut-upsd-admin-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `rancher-bootstrap-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `pbs-admin-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `technitium-admin-password` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `opnsense-api-key` | BW Password Manager login item | Ansible | lookup plugin `bw get username/password` |
| `wifi-private-psk` | BW Password Manager login item | Ansible | lookup plugin `bw get password` |
| `ssh-ops-pubkey` | BW Password Manager secure note | Ansible | lookup plugin `bw get notes` |
| `bitwarden-sm-access-token` | BW Password Manager secure note | Namespace auth bootstrap | `bw get notes` into `bw-auth-token` |
| `cloudflare-owl.red-api-token` | BW Secrets Manager `owl-red-infra` | SM Operator | `BitwardenSecret` mapping |
| `plex-claim-token` | BW Secrets Manager `owl-red-infra` | SM Operator | `BitwardenSecret` mapping |