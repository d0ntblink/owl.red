# Making changes on Unraid (`nas.owl.red`)

How Unraid configuration is managed and **which of the 3 methods** to use for any change.
The VM shell (CPU/RAM/disk/passthrough) is Terraform ([`terraform/proxmox/nas/nas.tf`](../../terraform/proxmox/nas/nas.tf));
this guide is about settings **inside** Unraid.

These are reference lanes, not approval to change the NAS for network work.
Keep disks/array/passthrough/boot/power and unrelated services unchanged. A manual
network mask/IP change needs its own bounded procedure and available local
keyboard/monitor recovery; do not run a general settings apply as its preflight.

## No-Fallback Operating Constraint

Owner clarification (2026-10-18): Unraid has **no fallback** and is the highest
value hardware in this environment. Continue routine, in-scope work without
repeated permission prompts. **Temporary disruptions are acceptable; destruction
is not.** Controlled service reloads/restarts are permitted when needed for the
scoped work; they are not blocked by a blanket no-interruption rule. Preserve
data, hardware and a recoverable management path. Disk/pool/array/boot/passthrough
changes and destructive cleanup remain outside the current storage work.
Production media files, placement and access/export policy remain unchanged.

Use live observations, scoped comparisons and the existing IaC owners. Retain
affected configuration before permitted changes, but do not describe a config
copy, parity or local console as a replacement NAS or tested data recovery.
Choose non-destructive, bounded changes with captured previous values and an
exact inverse. Do not mistake permission for an interruption for permission to
delete data, reinitialize storage or perform an unsafe power-loss test.

## Decision rule

> **Is there a safe GraphQL mutation for it?** → **Terraform** (`terraform/unraid/`).
> **Else, is it an allow-listed `/boot/config` flash key?** → **Ansible** (`unraid_settings` role, file lane).
> **Else (array / disk / user / secret / network lockout)?** → **Manual** (Unraid UI) — the role only drift-reports.

### DHCP-Managed NAS Mask

Read-only verification on 2026-10-16 at 19:50:45Z confirms
`USE_DHCP[0]="yes"`, dynamic `eth0` address `10.0.10.5/16`, DHCP default/connected
routes via `.1` and resolver `10.0.10.1`. The physical MAC remains
`f8:f2:1e:48:91:40`; HTTPS/SMB TCP ports respond.

Do not make a separate static NAS mask/DNS edit or add a `network.cfg` writer.
Its persistent mask must be handled with the active VyOS DHCP/LAN transition
and verified client renewal. Preserve the `.5` reservation and existing DNS
authority, save the affected router/DHCP state and check NAS reachability after
that bounded change. This preparation does not stop Docker/network services,
release the NAS lease, change IPv6 or touch any NAS configuration, array, disk,
passthrough, boot or power setting.

The owner subsequently approved only DHCP `/24` advertisement and normal NAS
IPv4 renewal. NAS is accepted at `.5/24` on 2026-10-16 at 20:22:08Z with the
same persistent network-config hash, boot/MAC/IPv6/daemon and non-`eth0` routes;
NAS ports and external HTTPS pass. The first prefix-changing renewal lost its
default route via a kernel deletion despite the correct DHCP router option.
Only the exact saved runtime default route was restored, then a controlled
same-`/24` renewal retained it. This was not a zero-interruption or first-try
acceptance, and no static NAS setting, release/rebind, service restart or disk/
array/boot/power operation was performed. The owning
[historical range guide](../../terraform/opnsense/README.md#dhcp-mask-preparation-before-router-contraction)
records this recovery boundary; the manual `network.cfg` policy is unchanged.

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
| Change the **DNS** the NAS uses | **Manual network policy; keep DHCP-provided DNS** | The active DHCP authority advertises DNS; preserve the VyOS client path during preparation and transfer to Technitium only at the approved handoff. Do not pin `.30` early. |
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
