# Role: `unraid_settings`

Hybrid IaC for the Unraid NAS (`nas.owl.red`, `10.0.10.5`). Implements the lane
model from [`docs/guides/unraid-iac-plan.md`](../../../docs/guides/unraid-iac-plan.md):

| Lane | Mechanism | This role |
|------|-----------|-----------|
| **API** | Unraid GraphQL (`http://NAS/graphql`, `x-api-key`) run from the controller | NTP set (Phase 1) |
| **File** | Ansible-managed allow-listed `/boot/config` keys | scaffolded, **writes OFF** |
| **Manual** | `network.cfg`, boot `go`, array/`super.dat`, secrets | **never written**, drift-detected only |

## Safety model

- **Writes are off by default.** `api_enabled` / `file_lane_enabled` default `false`; enable per-run with `-e`. Every write also carries `when: not ansible_check_mode`.
- **Secret/lockout guard.** `preflight` asserts no `unraid_cfg_hard_excluded` file (`myservers.cfg`, `network.cfg`, `go`, `super.dat`, `passwd`/`shadow`/`smbpasswd`/`secrets.tdb`) appears in `unraid_cfg_fetch_list` or `unraid_cfg_write_allowlist`.
- **No NAS Python required for the core paths.** NAS reads use `raw`; GraphQL/Bitwarden run on the controller (`delegate_to: localhost`). Only `fetch`-based recapture needs Python on the NAS (gated on a preflight probe).
- **`network.cfg` is never written.** DNS drift (`.3` vs desired `.30`) is *reported only*; fix it in the Unraid UI.

## Prerequisites (controller)

Run [`scripts/owl-controller-bootstrap.sh`](../../../scripts/owl-controller-bootstrap.sh) once:
- Ansible installed (pipx).
- `~/.ssh/id_ed25519_owl_ansible` present (pulled from Bitwarden `bw`; already authorized on the NAS).
- `NODE_EXTRA_CA_CERTS` set (Zscaler).
- Unraid API key created (`unraid-api apikey --create --name 'ansible unraid settings' --roles ADMIN --json`), stored in `bw`. The role reads it from the **`UNRAID_API_KEY`** env var — export it before an API-lane run: `export UNRAID_API_KEY="$(bw get password <bw-item> --session "$BW_SESSION")"`.

## Run

```bash
PB=ansible/playbooks/deploy-unraid-settings.yml
INV=ansible/inventory/hosts.yml
# read-only drift report
ansible-playbook -i $INV $PB --check --diff --tags preflight,drift
# refresh the committed flash snapshot (no --check; skips if NAS has no python)
ansible-playbook -i $INV $PB --tags preflight,recapture
# API lane: set NTP (needs UNRAID_API_KEY exported); reads -> compares -> writes only on drift -> verifies
ansible-playbook -i $INV $PB --tags preflight,api -e api_enabled=true
```

This playbook uses SSH-key auth, so it is run directly, **not** via `scripts/ansible-run.sh` (the Proxmox password wrapper).

> **World-writable mount:** the repo lives on a world-writable Windows/WSL mount, so Ansible ignores any `ansible.cfg` it finds there (and won't pick up `roles_path`, `private_key_file`, the python interpreter, etc.). Set the config explicitly: `export ANSIBLE_CONFIG=ansible/ansible.cfg` from the repo root (or `ANSIBLE_CONFIG=./ansible.cfg` when run from `ansible/`). Without it, you'll see "role 'unraid_settings' was not found".

## API lane — how the NTP write works

`tasks/api.yml` runs entirely on the controller against `https://<nas>/graphql` (the NAS has no Python).
It reads `systemTime`, compares `ntpServers` to the desired `unraid_ntp_server*`, and only on drift (and
not `--check`) issues the **`updateSystemTime`** mutation, then re-reads to verify. The mutation maps to
emhttp's *Settings → Date & Time → Apply* (writes `ident.cfg` `NTP_SERVER*`/`USE_NTP`); it does not touch
the array, network, shares, or Docker, and is reversible by re-applying the prior servers.

## Out of scope (this iteration)

File-lane writes, container defs, SSH/identity/plugin/UPS API writes, NFS enable,
Tailscale/WG. **DNS is left DHCP-provided by decision** (authority lives at the
Technitium DHCP scope, not the NAS) — the role only flags if DNS is pinned Static.
