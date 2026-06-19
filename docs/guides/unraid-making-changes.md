# Making changes on Unraid (`nas.owl.red`)

How Unraid configuration is managed and **which of the 3 methods** to use for any change.
The VM shell (CPU/RAM/disk/passthrough) is Terraform ([`terraform/proxmox/nas/nas.tf`](../../terraform/proxmox/nas/nas.tf));
this guide is about settings **inside** Unraid.

## Decision rule

> **Is there a safe GraphQL mutation for it?** → **Terraform** (`terraform/unraid/`).
> **Else, is it an allow-listed `/boot/config` flash key?** → **Ansible** (`unraid_settings` role, file lane).
> **Else (array / disk / user / secret / network lockout)?** → **Manual** (Unraid UI) — the role only drift-reports.

## The 3 methods

| Method | Source of truth | Run | Used for |
|--------|-----------------|-----|----------|
| **Terraform-GraphQL** | `terraform/unraid/*.tf` (+ vars) | `scripts/unraid-terraform-run.sh plan/apply` | NTP/time, SSH, identity, Connect/remote-access, UPS |
| **Ansible file-lane** | `ansible/roles/unraid_settings/` (+ allow-listed `/boot/config`) | `ansible-playbook … deploy-unraid-settings.yml` | SMB/NFS/shares, docker.cfg, scheduler (Phase 2) — plus read-only drift + flash recapture today |
| **Manual** | the live box (snapshot mirrors it) | Unraid UI / CLI | array/disks/pools/parity, users, license, `network.cfg` (IP/DNS/bridge), WireGuard/SSL, plugin install |

## Scenario → method

| I want to… | Method | Where / how |
|------------|--------|-------------|
| Change **NTP** / timezone | Terraform | `terraform/unraid` `var.ntp_servers` (system-time.tf) → `unraid-terraform-run.sh apply` |
| Enable/disable **SSH** or change port | Terraform | `var.ssh_enabled` / `var.ssh_port` (ssh.tf) |
| Change **hostname** / comment / model | Terraform | `var.identity_*` (identity.tf) |
| Change **Connect / remote access** | Terraform | `var.connect_access_type` (connect.tf) — kept `DISABLED` per ADR 012 |
| Configure a **UPS** (once wired) | Terraform | set `var.ups_present=true` (ups.tf) |
| Change **SMB/NFS** global, share export/cache, `smb-extra` | Ansible file-lane (Phase 2) | `unraid_settings` → `share.cfg` / `shares/*.cfg` |
| Change **docker service** settings (image path, networks) | Ansible file-lane (Phase 2) | `docker.cfg` |
| Add/remove a **docker container** | compose-in-git on Unraid **or** k8s/Fleet (per ADR 002) | not this role |
| Change the **NAS IP** / bridge | **Manual** (lockout) | Unraid UI (stop Docker first); `network.cfg` snapshot is reference-only |
| Change the **DNS** the NAS uses | **Manual** — left DHCP-provided; authority is the Technitium scope | `gitops/technitium/dhcp/scopes.json` (not the NAS) |
| Add/change the **array**, a **disk**, a **pool**, **parity** | **Manual** ⛔ DRIVE PROTECTION | Unraid UI only — never IaC |
| Add a **user** | **Manual** ⛔ (secrets) | Unraid UI |
| Install/remove a **plugin** | **Manual** (future TF plugin-set) | Unraid UI |
| Rotate the **Unraid API key** | **Manual** + Bitwarden | `unraid-api apikey --create …`; update the bw item used by `TF_VAR_unraid_api_key` |

## DRIVE PROTECTION — never Terraform-managed

`terraform/unraid` deliberately excludes all destructive/operational GraphQL mutations (`array`, `parityCheck`,
`vm`, `docker*`, `rclone`, `initiateFlashBackup`, notifications, plugin install, `updateSettings` JSON, …) so an
`apply` can never touch the array, disks, containers, or VMs. Full list in [`terraform/unraid/README.md`](../../terraform/unraid/README.md).

For **non-Unraid** changes (DNS records, a new VM, a bootstrap script, host config, k8s apps), see
[`changing-owl-red.md`](changing-owl-red.md).
