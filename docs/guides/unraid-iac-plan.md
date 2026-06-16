# Unraid (`nas.owl.red`) — IaC Recon & Action Plan

Read-only survey of the live Unraid host and a phased plan to bring its
configuration under IaC. **No changes were made to the NAS** — this is
reconnaissance only.

- **Host:** `nas.owl.red` (`10.0.10.5`), Unraid VM (VMID 101) on `storage.pve`
- **Surveyed:** 2026-06-15 over SSH (read-only commands)
- **Related:** VM shell already IaC'd in [`terraform/proxmox/nas/nas.tf`](../../terraform/proxmox/nas/nas.tf);
  issues [003](../issues/003-proxmox-api-token-passthrough-restriction.md) (passthrough),
  [004](../issues/004-unraid-usb-gadget-license.md) (USB license),
  [005](../issues/005-plex-identity-reset-after-vm-restart.md) (Plex identity)

---

## 1. System snapshot

| Item | Value |
|------|-------|
| Unraid version | **7.3.0** (kernel `6.18.29-Unraid`) |
| License | **Pro** (`Pro.key` on flash; bound via USB gadget — issue 004) |
| Model / chassis | Rosewill RSV-L4500U, Xeon E5-2620 v4 (6c), 23 GiB RAM |
| Array | **STARTED**, 11 disks (10 data + 1 parity), `mdNumDisks=11` |
| Pools | `cache` (btrfs, 466G), `ssd` (xfs, 466G) |
| Capacity | ~42 TB usable (`/mnt/user`) |
| Shares | 7 (`appdata`, `backups`, `isos`, `media`, `sharefiles`, `system`, `vms`) |
| Timezone | `America/Edmonton`; NTP on (`*.pool.ntp.org`) |
| GraphQL API | **online**, `unraid-api` v4.35.0 (PM2, fork mode) |

GPU/transcode: `go` loads `i915` + `chmod 777 /dev/dri` and the `nvidia-driver`
plugin is installed; Plex (hotio) uses the passed-through GTX 1060. This is the hard
pin keeping Plex on Unraid.

---

## 2. Workloads (17 running containers)

`librespeed`, `Reclaimerr`, `radarr_uhd`, `radarr_fhd`, `prowlarr`, `plex`,
`bazarr`, `Seerr`, `qbittorrentvpn`, `flaresolverr`, `tautulli`, `sonarr_uhd`,
`sonarr_fhd`, `lidarr`, `DiskSpeed`, `speedtest-tracker`, `cloudflareddns`.

> Note: `/boot/config/plugins/dockerMan/templates-user/` holds **~120** template
> XMLs (many `.bak`/stale) — only the 17 above are running. Any container IaC must
> target the *running set*, not the template graveyard.

Defined via dockerMan XML templates (`docker.cfg`: image folder at
`/mnt/user/system/docker/`, appdata at `/mnt/user/appdata/`, custom network `eth1`).

---

## 3. Configuration inventory (what lives where)

### Flash top-level (`/boot/config/`)
`disk.cfg`, `docker.cfg`, `domain.cfg`, `editor.cfg`, `flash.cfg`, `ident.cfg`,
`network.cfg`, `network-extra.cfg`, `network-rules.cfg`, `share.cfg`, `super.dat`,
`Pro.key`, `Trial.key`
Subdirs: `shares/`, `ssh/`, `wireguard/`, `plugins/`, `rclone/`, `ssl/`, `pools/`,
`default/`, `modprobe.d/`.

### Key files observed

| Domain | File(s) | Notable current values |
|--------|---------|------------------------|
| Global share | `share.cfg` | `shareSMBEnabled=yes`, **`shareNFSEnabled=no`**, mover `0 */2 * * *`, cache floor 2 GB, Avahi on |
| Per-share | `shares/*.cfg` (7) | e.g. `appdata`: `shareUseCache=only` pool `ssd`, `shareExport=e`, `shareSecurity=secure`, `shareWriteList=d0ntblink` |
| SMB extras | `smb-extra.conf` | **empty (0 bytes)** |
| Identity/SMB global | `ident.cfg` | `WORKGROUP`, `SECURITY=user`, `USE_SSL=yes` (80/443), `USE_SSH=yes`, `LOCAL_TLD=owl.red`, `SYS_MODEL`, WSD on, NetBIOS off |
| Docker service | `docker.cfg` | enabled, folder image 20 GB, `DOCKER_CUSTOM_NETWORKS=eth1`, log rotation 50m |
| Network | `network.cfg` | `eth0` DHCP, DNS `10.0.10.3 / 10.0.10.1 / 1.1.1.1` |
| Boot | `go` | `emhttp`, ipmi modules, `i915`, `chmod 777 /dev/dri` |
| Scheduler | `plugins/dynamix/*.cron` | parity-check, mover, monitor, plugin/lang/status checks |
| UPS | `plugins/nut/nut.cfg` (**`SERVICE=disable`**) + `dynamix.apcupsd/` | not active |
| User scripts | `plugins/user.scripts/scripts/` | `delete.ds_store`, `delete_dangling_images`, `docker-image-rescue`, `nvidia_patch`, `viewDockerLogSize` |

### Plugins (32) — highlights
`nvidia-driver`, `tailscale`, `user.scripts`, `unassigned.devices(+plus/preclear)`,
`appdata.backup`, `community.applications`, `fix.common.problems`,
`dynamix.*` (autofan, system stats/temp/info, file.integrity, active.streams),
`ca.update.applications`, `tips.and.tweaks`, `un-get`, `dwmemtester`, `gpustat`.

---

## 4. Secrets / exclusion map (never commit)

Confirmed secret-bearing files in flash — **hard-exclude from any capture/IaC**:

| File | Contains |
|------|----------|
| `Pro.key`, `Trial.key` | License (also USB-GUID bound, issue 004) |
| `super.dat` | Array disk assignment signature |
| `config/passwd`, `shadow`, `smbpasswd`, `secrets.tdb` | Local users / Samba password DB |
| `ssh/` | Host keys + authorized_keys |
| `wireguard/` | VPN private keys |
| `ssl/` | TLS private keys/certs |
| `rclone/` | Remote backup tokens |
| `plugins/**/*.cfg` w/ creds | e.g. tailscale auth, cloudflareddns token |

Any IaC mechanism must allow-list specific **non-secret keys**, and snapshots must be
run through secret scanning before commit (SECURITY.md).

---

## 5. IaC coverage matrix (evidence-based)

Derived from the live state above + the real GraphQL schema
(`unraid/api` `generated-schema.graphql`). Three lanes: **API** (GraphQL write
exists), **File** (manage allow-listed `/boot/config` keys via Ansible), **Manual**
(too risky / data-layer / no safe mechanism).

| Area | Current | Lane | Notes |
|------|---------|------|-------|
| Date/Time, NTP | TZ set, NTP on | **API** | `updateSystemTime` |
| UPS | NUT disabled, apcupsd present | **API** | `configureUps` (only if a UPS is wired) |
| SSH access | on, port 22 | **API** | `updateSshSettings` |
| Server identity | name/model/comment | **API**(partial) | `updateServerIdentity` + `ident.cfg` |
| Plugins install/remove | 32 installed | **API** | `addPlugin`/`removePlugin` |
| Flash backup | — | **API** | `initiateFlashBackup` |
| Global SMB / Avahi | SMB on, NFS off | **File** | `share.cfg` (no write API) |
| SMB extras | empty | **File** | `smb-extra.conf` |
| Per-share export/cache | 7 shares | **File** | `shares/*.cfg` (config only, not data) |
| Identity/Display/WSD/NetBIOS | see ident.cfg | **File** | `ident.cfg` (no write API) |
| Docker service settings | folder image, eth1 net | **File** | `docker.cfg` |
| Scheduler (parity/mover) | crons present | **File** | `dynamix/*.cron` (API can run, not schedule) |
| Container definitions | 17 running | **File** | compose-in-git **or** keep dockerMan XML; future k8s migration |
| Network (bridge/DNS) | eth0 DHCP | **Manual** ⚠️ | `network.cfg` — lockout risk |
| Boot params / `go` | gpu/ipmi modprobe | **Manual** ⚠️ | flash `go`/syslinux |
| Array / disks / pools | 11 disks STARTED | **Manual** ⛔ | data layer — never IaC |
| License / users / WG / SSL | secrets | **Manual** ⛔ | secret-bearing |

**Headline:** the GraphQL API writes only ~6 setting areas; **everything the user
asked about (SMB/NFS/shares/identity/docker/scheduler) is file-lane only.**

---

## 6. Action plan (phased, non-destructive)

Ordering favors safety: read/drift-detection before enforcement, low-blast-radius
areas before risky ones, and reuse of existing Ansible/Fleet rather than new tools.

### Phase 0 — Foundations (safe, do first)
- [ ] Add an `nas_unraid` Ansible play target (host already in inventory; fix the
      SSH key — recon used `~/.ssh/id_ed25519`, **not** the ansible key; decide which
      key Unraid should trust and document it).
- [ ] Create `ansible/roles/unraid_settings/` skeleton, **check/diff mode only**
      (no writes), reading current `/boot/config` keys and reporting drift vs a
      declared allow-list.
- [ ] Add a secret-exclusion guard (refuse to read/store `*.key`, `super.dat`,
      `passwd`/`shadow`/`smbpasswd`/`secrets.tdb`, `ssh/`, `wireguard/`, `ssl/`,
      `rclone/`).

### Phase 1 — API lane (low risk, genuine write coverage)
- [ ] Create an Unraid API key (least-privilege) via `unraid-api apikey --create`;
      store in Bitwarden (per ADR 003), expose to automation like other secrets.
- [ ] `unraid_api_settings` tasks (GraphQL): manage **Date/Time, SSH, server
      identity, plugin set**; optionally **UPS** if/when a UPS is connected.
- [ ] Wire API **reads** (array/disk/docker/container health) into Homepage/alerting.

### Phase 2 — File lane: SMB/NFS/shares (the requested scope)
- [ ] Codify global `share.cfg` keys (SMB/NFS enable, mover schedule, cache floor,
      Avahi) as declared variables.
- [ ] Codify `smb-extra.conf` (currently empty) as a managed template.
- [ ] Codify per-share `shares/*.cfg` **export/security/cache** fields (not data).
- [ ] Reload hooks per area (e.g. `samba` restart) — validated in check mode first.
- [ ] Codify `ident.cfg` SMB/identity globals (workgroup, WSD, NetBIOS, SSL ports).

### Phase 3 — File lane: docker service + scheduler (still appliance config)
- [ ] Manage `docker.cfg` service settings (image path/size, custom networks, log
      rotation) — **not** container defs yet.
- [ ] Manage `dynamix/*.cron` (parity/mover schedule) declaratively.

### Phase 4 — Container definitions
- [ ] Decide per-app: **(a)** compose-in-git on Unraid (GPU-pinned: plex + *arr), or
      **(b)** migrate to k8s/Fleet (stateless/non-GPU: librespeed, speedtest-tracker,
      tautulli, etc.) as ROADMAP §4 storage lands.
- [ ] Import-safe only: describe **running** containers, validate with
      `compose up --no-recreate`; preserve Plex identity (issue 005).

### Explicitly out of scope (stay manual)
- Array/disk/pool layout, parity, `super.dat` — **never** IaC.
- `network.cfg` / boot `go` / syslinux — lockout risk; manual + documented.
- License, local users, WireGuard, SSL private keys — secret-bearing.

---

## 7. Open decisions (need owner input)

1. **SSH key**: recon worked with `~/.ssh/id_ed25519` (personal), not
   `id_ed25519_owl_ansible`. Should the ansible key be authorized on Unraid, or will
   automation use the personal key? (Affects how `nas_unraid` is wired.)
2. **Container strategy**: compose-in-git on Unraid vs. k8s migration per app — the
   GPU pin means Plex/*arr likely stay; confirm the split.
3. **NFS**: currently disabled globally. Will the k8s cluster consume NFS from Unraid
(ROADMAP §4)? If so, enabling/managing NFS exports becomes Phase-2 priority.
4. **Tailscale/WireGuard**: in scope for IaC (config only, secrets excluded) or fully
   manual?

---

## Appendix — recon method

All data gathered with read-only SSH commands (`cat`, `ls`, `df`, `docker ps`,
`unraid-api status`). Secret values were redacted at the source command and never
stored. No mutating command was run on the NAS.
