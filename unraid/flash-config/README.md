# Unraid flash config snapshot — `nas.owl.red`

Read-only capture of the Unraid settings (`/boot/config/*.cfg`) for IaC reference.
Captured **2026-06-15** over SSH from `10.0.10.5` (Unraid 7.3.0).

> **This is a sanitized reference snapshot, not an applied artifact.** Files here
> are for diffing/authoring IaC. Nothing in this directory is pushed back to the NAS
> automatically. See [`docs/guides/unraid-iac-plan.md`](../../docs/guides/unraid-iac-plan.md)
> for the action plan and [`docs/guides/unraid-api-capabilities`](../../docs/guides/unraid-iac-plan.md#5-iac-coverage-matrix-evidence-based)
> for the API-vs-file coverage matrix.

## Scope

Captured `/boot/config` settings files only:

| Group | Files |
|-------|-------|
| Top-level | `disk.cfg`, `docker.cfg`, `domain.cfg`, `editor.cfg`, `flash.cfg`, `ident.cfg`, `network.cfg`, `network-extra.cfg`, `network-rules.cfg`, `share.cfg`, `smb-extra.conf`, `go` |
| Per-share | `shares/{appdata,backups,isos,media,sharefiles,system,vms}.cfg` |
| Plugins | `plugins/**/*.cfg` (settings of installed plugins) |

## Security — what was redacted / excluded

Captured content was scanned (keyword + base64 sweeps) before saving. Handling:

| Item | Action | Reason |
|------|--------|--------|
| `plugins/dynamix.my.servers/myservers.cfg` | **excluded entirely** | Holds Unraid Connect `apikey`, `localApiKey`, tokens, email |
| `nut.cfg` → `MONPASS`, `SLAVEPASS` | **redacted** (`<REDACTED-SET-VIA-BITWARDEN>`) | NUT credential fields (were defaults `monpass`/`slavepass`; treat as secret) |
| `ident.cfg` → `DOMAIN_PASSWD` | kept (empty `""`) | No value present |

**Never captured (hard-excluded, secret-bearing):** `*.key` (license), `super.dat`,
`config/passwd`, `shadow`, `smbpasswd`, `secrets.tdb`, `ssh/`, `wireguard/`, `ssl/`,
`rclone/`. These must come from Bitwarden if ever needed (ADR 003 / SECURITY.md).

> Note: `disk.cfg` contains `luksKeyfile="/root/keyfile"` — this is only the *path*
> to the LUKS keyfile, not the key. The keyfile itself is not on flash and is not
> captured.

## Key observations (for IaC authoring)

### Global share / SMB / NFS (`share.cfg`, `ident.cfg`)
- **SMB enabled, NFS disabled** (`shareSMBEnabled=yes`, `shareNFSEnabled=no`).
- Mover schedule `0 */2 * * *`; cache floor 2 GB; Avahi/`Xserve` model on.
- `WORKGROUP`, `SECURITY=user`, NetBIOS off, WSD on, `LOCAL_TLD=owl.red`.
- `smb-extra.conf` is **empty** — clean slate for custom Samba shares.

### Per-share (`shares/*.cfg`)
7 shares. Each declares `shareUseCache`, `shareCachePool`, `shareExport`,
`shareSecurity`, `shareWriteList`, NFS export fields. Example `appdata`:
cache `only` on pool `ssd`, security `secure`, writelist `d0ntblink`.

### Docker (`docker.cfg`)
Enabled; **folder** image at `/mnt/user/system/docker/` (20 GB); appdata
`/mnt/user/appdata/`; custom network `eth1`; log rotation 50m. The
**`compose.manager` plugin is installed** → the compose-in-git path is available
without adding tooling.

### VM Manager (`domain.cfg`)
**Service disabled** (`SERVICE="disable"`). No VMs managed by this Unraid (it is
itself a guest). VM-settings IaC is therefore N/A unless enabled later.

### Disk settings (`disk.cfg`)
`startArray=yes`, `spindownDelay=0` (no spindown), `shutdownTimeout=90`,
poll 1800s, md tunables at defaults. Per-disk spindown all `-1`. **Array/disk
layout itself is out of IaC scope** — these are tunables only.

### Network (`network.cfg`, `network-extra.cfg`, `network-rules.cfg`)
- `eth0` DHCP (v4+v6), DNS `10.0.10.3 / 10.0.10.1 / 1.1.1.1`.
- `eth0` pinned by udev rule to MAC `f8:f2:1e:48:91:40` (the passed-through Intel
  82599ES SFP+ port — matches `nas.tf` / README inventory).
- `network-extra.cfg` includes `tailscale1` interface.
- **Lockout-sensitive — file-IaC only with extreme care, or leave manual.**

### Scheduler (`plugins/dynamix/*.cron`)
parity-check (quarterly, 1st Fri 01:00), mover (`0 */2`), monitor (1m), docker/
plugin/lang/status/unraid update checks. Captured separately as crons.

### Plugins of note
`compose.manager`, `nvidia-driver`, `tailscale`, `user.scripts`,
`unassigned.devices(+plus)`, `appdata.backup`, `dynamix.system.autofan` (6 fan
zones configured), `gpustat`, `recycle.bin`, `file.integrity`.

### Boot (`go`)
Loads `ipmi_devintf`, `ipmi_si`, `i915`, and `chmod -R 777 /dev/dri` (Intel iGPU
exposure) — alongside the passed-through GTX 1060 + `nvidia-driver` plugin for Plex.

## SSH access

The ansible key `id_ed25519_owl_ansible` (`ansible@owl.red`) was authorized on the
NAS on 2026-06-15 (appended to `/boot/config/ssh/root/authorized_keys`, persisted
across reboot; a timestamped `.bak` of the prior file was left on flash). Automation
can now reach the NAS with the standard ansible key, consistent with other hosts.

## Re-capturing

This snapshot was produced by reading `/boot/config` over SSH and sanitizing. A
future `unraid_settings` Ansible role (check-mode-first) should reproduce this as a
`fetch` + redact step so drift is diffable against these files. Do **not** add a
mechanism that writes back to flash without the allow-list + secret-exclusion guard
described in the action plan.
