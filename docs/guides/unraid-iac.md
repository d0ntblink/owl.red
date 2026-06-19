# Unraid IaC — operational runbook

Day-2 companion to [`unraid-iac-plan.md`](unraid-iac-plan.md) (the "what/why") for the
`unraid_settings` Ansible role (the "how"). Target: `nas.owl.red` (`10.0.10.5`).

## Lanes

- **API** — Unraid GraphQL, run from the controller against `http://10.0.10.5/graphql` with an `x-api-key` header. Used for settings with a write mutation (Phase 1: NTP).
- **File** — allow-listed `/boot/config` keys managed by Ansible (Phase 2; scaffolded, writes off).
- **Manual** — `network.cfg`, boot `go`, array/`super.dat`, secrets: never automated; drift-reported only.

## One-time controller setup

```bash
export BW_SESSION="$(bw unlock --raw)"     # unlock Bitwarden Password Manager
export BWS_ACCESS_TOKEN=...                # Bitwarden Secrets Manager token
./scripts/owl-controller-bootstrap.sh      # installs ansible, pulls SSH key from bw
```

Create the Unraid API key and store it in `bw` (Password Manager, per ADR 003):

```bash
ssh root@10.0.10.5 "unraid-api apikey --create --name 'ansible unraid settings' --roles ADMIN --json"
# store the returned key in a bw login item, then export it for API-lane runs:
export UNRAID_API_KEY="$(bw get password <bw-item-uuid> --session "$BW_SESSION")"
```

## Daily operations

| Goal | Command |
|------|---------|
| Drift report (read-only) | `ansible-playbook -i ansible/inventory/hosts.yml ansible/playbooks/deploy-unraid-settings.yml --check --diff --tags preflight,drift` |
| Refresh flash snapshot | `… --tags preflight,recapture` then `git diff unraid/flash-config/` |
| Set NTP (API lane) | `export UNRAID_API_KEY=…` then `… --tags preflight,api -e api_enabled=true` (reads → compares → writes only on drift → verifies) |

Always run `pre-commit run --files $(git diff --name-only unraid/flash-config/)` before committing a recapture.

## Reading drift output

`debug` lines tagged `DRIFT [NTP, API lane]` and `DNS [MANUAL lane]` show the live
state. NTP is managed by the API lane. **DNS is DHCP-provided by design** (decision
2026-06-18) — the role only flags if it's been pinned Static; which resolver DHCP
advertises is set at the Technitium DHCP scope, not the NAS.
A JSON summary is written to `ansible/artifacts/unraid/drift-report.json` (gitignored).

## Adding a new setting to IaC

1. Is there a GraphQL mutation? → API lane (add to the role, introspect to confirm the mutation/args).
2. Else, is the key in an allow-listed `/boot/config` file? → File lane (Phase 2; add to `unraid_cfg_write_allowlist`).
3. Else (network/array/secret/lockout) → **Manual**; document here and rely on drift detection.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Permission denied (publickey)` | SSH key not pulled from `bw` — run the bootstrap script (`BW_SESSION` must be set). |
| GraphQL `401`/empty | Wrong/expired API key, or `unraid-api` down (`pgrep -f unraid-api` on the NAS). |
| "No known NTP mutation found" | Schema differs; inspect the printed mutation list, update `unraid_ntp_mutation_candidates`. |
| recapture skipped | NAS had no Python — **resolved**: `python3` installed via `un-get` (persists in `/boot/extra`). If it recurs, re-run `un-get install python3`. |
| `bw`/`bws` TLS error | `NODE_EXTRA_CA_CERTS` must point at the Zscaler CA. |
| `role 'unraid_settings' was not found` / `ansible.cfg` ignored | Repo is on a world-writable mount; set `export ANSIBLE_CONFIG=ansible/ansible.cfg` (repo root) or `ANSIBLE_CONFIG=./ansible.cfg` (from `ansible/`). |
