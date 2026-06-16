# Decision 015: Terraform Remote State Deferred (Local State For Now)

## Status

Accepted (2026-06-16). Single-operator phase — local, git-ignored state is retained;
an encrypted remote backend is scaffolded (commented) in each root module and deferred
until multi-operator / CI use. Makes SECURITY.md §"Future Hardening" #3 an explicit,
dated decision rather than an open recommendation.

## Quick Summary

| Area | Decision |
|------|----------|
| Current state location | Local working dir, git-ignored (`*.tfstate*`, `.terraform/`, `*.tfvars` in `.gitignore`) |
| Backend block | Scaffolded as a commented example in each root module; not enabled |
| Trigger to enable | First of: a second operator, CI-driven apply, or state stored off the workstation |
| Reference backend | S3-compatible (MinIO on the NAS) — example provided; final choice made at enable time |
| Credentials | Backend creds come from Bitwarden via the runner env, never committed (ADR 003) |

## Context

`terraform/` has three root modules (`proxmox/technitium`, `proxmox/nas`, `opnsense`),
all using local state. State can contain secrets (Talos PKI via `talos_machine_secrets`,
API tokens), so `.gitignore` already excludes `*.tfstate*`, `.terraform/`, `*.tfvars`,
and plan files. SECURITY.md lists "encrypted remote state backend" as future hardening.

Today owl.red is operated by one person from one workstation. A remote backend adds real
value once state must be shared (a second operator) or accessed from CI — and it requires
backing infrastructure (object store / DB), its own credentials, and encryption config.
Standing that up now adds a dependency and an attack surface before there is a consumer.

## Decision

1. Keep **local, git-ignored state** during the single-operator phase.
2. **Scaffold** an encrypted remote backend as a commented `backend` block in every root
   module so enabling it later is a small, reviewed diff — not a redesign.
3. The reference example is the **S3-compatible** backend (MinIO on the NAS), chosen
   because the homelab already runs storage; the final backend is decided when enabled.
4. **Enable** remote state at the first of: (a) a second operator, (b) CI-driven
   `terraform apply`, or (c) any need to keep state off the workstation.
5. Backend credentials (e.g. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for MinIO) are
   sourced from Bitwarden via the runner env (consistent with ADR 003 and the existing
   `scripts/terraform-run.sh` pattern); encryption at rest is provided by the bucket.

## Consequences

| Type | Outcome |
|------|---------|
| Positive | No new infra / credentials / attack surface before there is a consumer |
| Positive | Enabling remote state later is a reviewed one-block change in each module |
| Positive | The decision and its trigger are now explicit and dated, not an open "future" item |
| Trade-off | State currently lives only on one workstation — must be backed up out-of-band |
| Trade-off | No state locking — acceptable for a single operator, unacceptable for two |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| Workstation loss destroys state | Back up `terraform/**/*.tfstate` to encrypted storage out-of-band; most resources are reproducible from code |
| A second operator is added without enabling remote state | This ADR's trigger + the commented backend block make enabling the obvious next step |
| Secrets leak via committed state | `.gitignore` excludes all `*.tfstate*`; gitleaks (CI + pre-commit) scans for leaked material |

## Related

- ADR 003 — Secrets management with Bitwarden (backend credentials source)
- ADR 005 — Terraform owns VM lifecycle
- ADR 007 — Terraform vs Ansible boundaries
- SECURITY.md — §"Future Hardening" #3 (decided here)
