# Proposal: Secrets Management with Bitwarden + SM Operator

## Status

Accepted (implementation in progress)

## Context

Secrets are needed by both Ansible and Kubernetes workloads. Secret values must not be committed to git.

## Decision

Use a two-layer model:

1. Ansible reads infrastructure secrets from Bitwarden Password Manager via `community.general.bitwarden` lookup.
2. Kubernetes syncs workload secrets from Bitwarden Secrets Manager via the Bitwarden Secrets Manager Kubernetes Operator (`BitwardenSecret` CRD).

Bootstrap approach:
- `scripts/ansible-run.sh` unlocks vault and exports `BW_SESSION` for playbook runs.
- Operator installation is GitOps-managed under `gitops/bitwarden-operator`.
- Each target namespace stores a machine-account token in `bw-auth-token`.
- `BitwardenSecret` objects map Bitwarden secret IDs to Kubernetes secret keys.

## Homelab Security Baseline (Lightweight)

- No plaintext secrets in repo.
- Machine account token is least-privilege and project-scoped.
- Bootstrap token is treated as break-glass and rotated on schedule.

## Risks And Mitigations

- Risk: stale machine-account token remains valid too long.
   - Mitigation: rotate token on a fixed cadence and validate sync after rotation.
- Risk: accidental sync of generated/system secrets.
   - Mitigation: migrate app-owned secrets first and explicitly exclude service-account token secrets.

## Review Gates

- Validate Ansible can fetch all listed infra secrets without local plaintext files.
- Validate operator sync for at least one non-critical secret and one cert-manager token.
- Validate break-glass recovery by revoking token and re-establishing sync with a new token.

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
| `bitwarden-sm-access-token` | BW Password Manager secure note | Namespace auth secret bootstrap | `bw get notes` -> `bw-auth-token` |
| `cloudflare-owl.red-api-token` | BW Secrets Manager (`owl-red-infra`) | SM Operator | `BitwardenSecret` mapping |
| `plex-claim-token` | BW Secrets Manager (`owl-red-infra`) | SM Operator | `BitwardenSecret` mapping |