# Role: `unraid_settings`

Read-only drift, recapture and the allow-listed file lane for the Unraid NAS
(`nas.owl.red`, `10.0.10.5`). Under
[ADR 021](../../../docs/decisions/021-unraid-hybrid-iac.md), Terraform owns safe
GraphQL writes; any remaining Ansible API tasks are historical, not an approved
second writer. This role is not a network migration or NAS recovery procedure.

| Lane | Mechanism | This role |
|------|-----------|-----------|
| **API** | Terraform-GraphQL (`terraform/unraid/`) | Not owned by this role; do not enable its historical API writer |
| **File** | Ansible-managed allow-listed `/boot/config` keys | scaffolded, **writes OFF** |
| **Manual** | `network.cfg`, boot `go`, array/`super.dat`, secrets | **never written**, drift-detected only |

## Safety model

- **File writes are off by default.** Keep `file_lane_enabled=false` unless an affected setting change is separately approved; check mode is not an approved apply. Do not enable the historical `api_enabled` path; Terraform owns that lane.
- **Secret/lockout guard.** `preflight` asserts no `unraid_cfg_hard_excluded` file (`myservers.cfg`, `network.cfg`, `go`, `super.dat`, `passwd`/`shadow`/`smbpasswd`/`secrets.tdb`) appears in `unraid_cfg_fetch_list` or `unraid_cfg_write_allowlist`.
- **No NAS Python required for the core paths.** NAS reads use `raw`; GraphQL/Bitwarden run on the controller (`delegate_to: localhost`). Only `fetch`-based recapture needs Python on the NAS (gated on a preflight probe).
- **`network.cfg` is never written.** Report DNS state without treating `.30` as an immediate target; retain VyOS client DNS/DHCP until the coordinated network handoff. NAS networking is a manual, change-scoped operation with local console recovery.

## Prerequisites (controller)

Run [`scripts/owl-controller-bootstrap.sh`](../../../scripts/owl-controller-bootstrap.sh) once:
- Ansible installed (pipx).
- `~/.ssh/id_ed25519_owl_ansible` present (pulled from Bitwarden `bw`; already authorized on the NAS).
- `NODE_EXTRA_CA_CERTS` set (Zscaler).
- API credentials belong to the Terraform lane through `scripts/unraid-terraform-run.sh`; do not export a key to enable the retired Ansible API writer for drift/file work.

## Run

```bash
PB=ansible/playbooks/deploy-unraid-settings.yml
INV=ansible/inventory/hosts.yml
# read-only drift report
ansible-playbook -i $INV $PB --check --diff --tags preflight,drift
# refresh the committed flash snapshot (no --check; skips if NAS has no python)
ansible-playbook -i $INV $PB --tags preflight,recapture
```

This playbook uses SSH-key auth, so it is run directly, **not** via `scripts/ansible-run.sh` (the Proxmox password wrapper).

> **World-writable mount:** the repo lives on a world-writable Windows/WSL mount, so Ansible ignores any `ansible.cfg` it finds there (and won't pick up `roles_path`, `private_key_file`, the python interpreter, etc.). Set the config explicitly: `export ANSIBLE_CONFIG=ansible/ansible.cfg` from the repo root (or `ANSIBLE_CONFIG=./ansible.cfg` when run from `ansible/`). Without it, you'll see "role 'unraid_settings' was not found".

## Historical API Lane

The old controller-side NTP writer is superseded by Terraform-GraphQL. Use
[the current change guide](../../../docs/guides/unraid-making-changes.md) for
approved API settings; do not run both writers against the same setting.

## Out of scope (this iteration)

File-lane writes, container defs, SSH/identity/plugin/UPS API writes, NFS enable,
Tailscale/WG. **DNS is left DHCP-provided by decision**; the active DHCP authority
controls its advertised resolver. That remains the VyOS client path during
preparation, with Technitium handoff only after network readiness and approval.
Disks/array/passthrough/boot/power and unrelated services are outside network work.
