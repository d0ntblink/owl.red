# Making changes on Unraid (`nas.owl.red`)

How configuration on the Unraid NAS is managed, **what is done where**, and the exact
procedure to change each kind of setting. Companions: [`unraid-iac.md`](unraid-iac.md)
(command runbook) and [`unraid-iac-plan.md`](unraid-iac-plan.md) (coverage matrix + why).

The VM shell (CPU/RAM/disk/passthrough) is Terraform (`terraform/proxmox/nas/nas.tf`);
**this guide is about settings _inside_ Unraid**, managed by the `unraid_settings` Ansible
role (`ansible/roles/unraid_settings/`).

## The three lanes (decide which one a change belongs to)

| Lane | Mechanism | Source of truth | Use for |
|------|-----------|-----------------|---------|
| **API** | Unraid GraphQL (`https://10.0.10.5/graphql`, `x-api-key`), run from the controller | the role + GraphQL | time/NTP, SSH, server identity, plugins, UPS |
| **File** | Ansible edits allow-listed `/boot/config` keys, then reload (Phase 2 — *scaffolded, not built*) | the role + declared vars | SMB/NFS/shares, `ident.cfg` globals, `docker.cfg`, scheduler crons |
| **Manual** | changed in the Unraid UI by a human; role only **drift-reports** | the live box (snapshot mirrors it) | `network.cfg` (DNS/bridge), array/disk layout, license, users, WireGuard/SSL |

Rule of thumb: **API if a GraphQL mutation exists; else File-lane allow-list; else Manual.**
Never auto-write `network.cfg`, the boot `go`, `super.dat`, or secret files — they are hard-excluded.

## What is done today

| Component | Lane | Status | Where |
|-----------|------|--------|-------|
| **NTP** (`= 10.0.10.1`, strict) | API | **Done** — verified, idempotent | `tasks/api.yml`, `defaults: unraid_ntp_server1` |
| **Drift detection** (NTP + DNS mode) | read-only | **Done** | `tasks/drift.yml` → `ansible/artifacts/unraid/drift-report.json` |
| **Flash recapture** (snapshot refresh) | read-only | **Done** (needs NAS python3 — installed via `un-get`) | `tasks/recapture.yml` → `unraid/flash-config/` |
| **Secret/lockout guards** | preflight | **Done** | `tasks/preflight.yml` |
| **DNS** | Manual | **DHCP-provided by decision** (not pinned) — drift-reported only | live `network.cfg`; authority is the Technitium DHCP scope |
| SSH / identity / plugins / UPS | API | Not yet (mutations exist) | future `tasks/api.yml` additions |
| SMB / shares / docker / scheduler | File | Not yet (Phase 2 scaffold) | `tasks/file-scaffold.yml` |
| Array / disks / license / users / WG / SSL | Manual | **Never IaC** | UI only |

## Prerequisites for any run

```bash
cd <repo root>
source ~/.owl-red.env                                   # BW_SESSION (to read bw)
export ANSIBLE_CONFIG=ansible/ansible.cfg               # repo is on a world-writable mount
export ANSIBLE_HOST_KEY_CHECKING=False
# SSH key (id_ed25519_owl_ansible) must be in ~/.ssh — pull from bw if missing:
#   scripts/owl-controller-bootstrap.sh
PB=ansible/playbooks/deploy-unraid-settings.yml
INV=ansible/inventory/hosts.yml
```

## Procedure by lane

### API-lane change (e.g. NTP)
1. Edit the desired value in `ansible/roles/unraid_settings/defaults/main.yml`
   (e.g. `unraid_ntp_server1`). For a *new* setting, add a read/compare/mutate/verify
   block to `tasks/api.yml` using the researched mutation (see below).
2. Export the API key from `bw` and run (writes only on drift, verifies after):
   ```bash
   export UNRAID_API_KEY="$(bw get password 56ea6570-7420-4172-a600-b46e00397fde --session "$BW_SESSION")"
   ansible-playbook -i $INV $PB --tags preflight,api -e api_enabled=true
   ```
3. Re-run to confirm idempotency (`changed=0`, "IN SYNC").

> **Discovering a new mutation safely** (introspection is read-only; schema enumeration via
> `__schema` is disabled but `__type` works):
> ```bash
> curl -sk https://10.0.10.5/graphql -H "x-api-key: $UNRAID_API_KEY" -H 'Content-Type: application/json' \
>   -d '{"query":"{ __type(name:\"Mutation\"){ fields { name } } }"}' | jq -r '.data.__type.fields[].name'
> curl -sk https://10.0.10.5/graphql -H "x-api-key: $UNRAID_API_KEY" -H 'Content-Type: application/json' \
>   -d '{"query":"{ __type(name:\"<InputTypeName>\"){ inputFields { name type { name kind ofType { name } } } } }"}' | jq
> ```
> Then read the resolver in the open-source `unraid/api` repo (`gh search code '<mutation> repo:unraid/api'`)
> to confirm it only writes the setting and is reversible **before** writing.

### Manual-lane change (e.g. `network.cfg`, DNS, array)
1. Make the change in the **Unraid UI** (network changes require stopping the Docker
   service first — Settings → Docker → disable, change, re-enable).
2. Run a drift report to confirm the role sees it as expected:
   ```bash
   ansible-playbook -i $INV $PB --check --diff --tags preflight,drift
   ```
3. If a captured file changed, **re-capture the snapshot** so the repo mirrors live:
   ```bash
   ansible-playbook -i $INV $PB --tags preflight,recapture
   git diff unraid/flash-config/ && pre-commit run --files $(git diff --name-only unraid/flash-config/)
   ```
   (`network.cfg` is not in the auto-fetch list; refresh it manually if you change it.)

### File-lane change (Phase 2 — not built yet)
Add the key to `unraid_cfg_write_allowlist`, template/`lineinfile` it in a new `tasks/file.yml`,
add a reload handler, gate behind `file_lane_enabled`. Verify the reload command on the box first.

## Hard rules
- **Writes are off by default**: `api_enabled`/`file_lane_enabled` default `false`; every write also has `when: not ansible_check_mode`.
- The role **never** writes `network.cfg` / `go` / `super.dat` / `*.key` / `passwd`/`shadow`/`smbpasswd`/`secrets.tdb` / `ssh`/`wireguard`/`ssl`/`rclone` — preflight asserts this.
- **Research before writing** to the NAS (it's production: storage + Plex/*arr). Read-only first; characterise the mutation; get sign-off.
