# Decision 021: Unraid managed by hybrid IaC (API + File + Manual lanes)

## Status

Accepted and implemented (2026-06-18).

> **Revision (2026-06-18):** the **API lane moved from Ansible to Terraform-GraphQL** at the user's
> direction. The declarative source of truth for every safe GraphQL-settable Unraid setting is now
> `terraform/unraid/` (provider `sullivtr/graphql`), applied via `scripts/unraid-terraform-run.sh`. The
> Ansible `unraid_settings` role now owns only the **file** and **manual/drift** lanes. The three-lane model
> below still holds; only the API-lane *engine* changed (Terraform, not Ansible). **Drive protection:**
> destructive mutations (`array`/`parityCheck`/`vm`/`docker*`/…) are excluded from Terraform. See
> [`docs/guides/unraid-making-changes.md`](../guides/unraid-making-changes.md) and `terraform/unraid/README.md`.

## Context

`nas.owl.red` (Unraid 7.3.0) was the last major host with **no configuration IaC** — its
VM shell is Terraform (`terraform/proxmox/nas/nas.tf`), but nothing inside Unraid was
codified. Constraints shaped the approach:

- Unraid is **Slackware-based with no guaranteed Python**, so Ansible's module path can't be assumed on the box.
- It exposes a **GraphQL API** (`unraid-api`, `https://10.0.10.5/graphql`) that writes ~6 setting areas via emhttp.
- Most other settings live **only in `/boot/config` flash files** (no API).
- Some settings are **lockout- or data-loss-prone** (`network.cfg`, array/disk layout, license, users).
- Per the repo's principle, everything that safely can be should be IaC and easily syncable.

## Decision

Manage Unraid **settings** through **three lanes**, choosing by capability and
risk. The opening revision governs ownership; this is not an instruction to
re-enable the former Ansible API writer.

1. **API lane** — Terraform-GraphQL in `terraform/unraid/`, via
  `scripts/unraid-terraform-run.sh`. Inspect the installed schema, read/plan,
  approve only safe intended setting mutations, apply and verify. Ansible does
  not own these writes; destructive/operational API mutations stay excluded.
2. **File lane** — Ansible manages an **allow-listed** set of `/boot/config` keys, then reloads (scaffolded; Phase 2).
3. **Manual lane** — lockout/data-layer/secret settings (`network.cfg`, array, license, users, WG/SSL) are
   **never auto-written**; the role only **drift-reports** them and the committed flash snapshot mirrors live.

Supporting choices:
- **Secrets via env injection** from Bitwarden through the current Terraform
  runner, using `TF_VAR_unraid_api_key`; no key values in Git or tool output.
- **SSH key auth** with `id_ed25519_owl_ansible` (key stored in `bw`).
- **No NAS Python required for the core paths** — NAS reads use `raw`; GraphQL/Bitwarden run on the controller.
  `python3` was installed on the NAS via `un-get` (persists in `/boot/extra`) only to enable `fetch`-based recapture.
- **Ansible file writes remain off by default** (`file_lane_enabled`); the legacy
  `api_enabled` writer must remain unused. Preflight guards exclude secret/lockout
  files; Terraform API writes need their own reviewed plan and verification.

## Alternatives rejected

- **Pure file-lane** (drive everything by editing `/boot/config`): higher lockout risk and reimplements what the
  API does safely; the API is preferred where a mutation exists.
- **Pure API**: the GraphQL API only covers a handful of areas — most settings are file-only, so an API-only
  approach can't reach the requested scope (SMB/shares/identity/docker/scheduler).
- **In-cluster/containerised management**: N/A — Unraid *is* the host, not a workload.
- **Self-contained `bw` fetch inside Ansible**: hit a controller-side quirk running the snap `bw` from a module;
  env injection is simpler, proven, and matches the repo's existing secret-injection pattern.

## Consequences

- Clear, auditable lane ownership; drift detection for manual settings; reproducible, idempotent API writes.
- `network.cfg` / array / secrets stay **manual** (documented); **DNS is kept DHCP-provided by decision** —
  the active DHCP authority advertises the resolver, not a NAS-local static pin.
  Preserve the OPNsense client path during network preparation; the Technitium
  target becomes authoritative for client DHCP only at approved handoff.
- The flash snapshot stays in sync via recapture (requires NAS `python3`, now installed).
- Adding a setting follows a fixed decision: API mutation → file allow-list → else manual.
- **Risk:** the GraphQL schema can change across `unraid-api` versions — mitigated by introspecting the live
  schema (`__type`) before any write.

This settings decision is not a network prerequisite or permission for unrelated
NAS VM/passthrough/disk/array/boot/power/service changes. The user has local NAS
keyboard/monitor access for networking recovery; data protection/storage work
needs its own approved scope.

See: [`docs/guides/unraid-making-changes.md`](../guides/unraid-making-changes.md),
[`unraid-iac.md`](../guides/unraid-iac.md), [`unraid-iac-plan.md`](../guides/unraid-iac-plan.md),
and issues [003](../issues/003-proxmox-api-token-passthrough-restriction.md) /
[004](../issues/004-unraid-usb-gadget-license.md) / [005](../issues/005-plex-identity-reset-after-vm-restart.md).
