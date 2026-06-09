# owl.red Infrastructure Roadmap

Ordered list of outstanding work. Each item is either a prerequisite for something below it or a standalone milestone. Update status as work progresses.

Status: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## 1. Network Foundation

These must be complete before anything that depends on VLAN isolation or correct name resolution works end-to-end.

### 1.1 VLAN Steering on WAP (`ap.owl.red`)
- `[ ]` Log into OpenWrt on `10.0.10.40`
- `[ ]` Confirm SSID → VLAN bridge mappings:
  - `owl.red` → VLAN 20 (`private-net`)
  - `silence of the lans` → VLAN 30 (`guest-net`)
  - `owl.red-iot` → VLAN 40/50 (split by device; see below)
- `[ ]` Decide: split IoT SSIDs (`owl.red-iot-local` VLAN 40, `owl.red-iot-cloud` VLAN 50) **or** keep single SSID and steer by MAC in OPNsense
- `[ ]` Move IoT devices to correct SSID once steering is confirmed:
  - `ecobee.owl.red` → VLAN 50 (currently on VLAN 10)
  - `printer.owl.red` (Canon) → VLAN 40 (currently on VLAN 10)
  - `bambu.owl.red` → VLAN 40 (needs to join network)

### 1.2 VLAN Access Rules on Switch (`switch.owl.red`)
- `[ ]` Audit `ansible/switch_configs/css326.yml` — confirm all ports have correct PVID and tagged VLAN membership
- `[ ]` Apply any missing port VLAN config via `swos-apply-config.yml`
- `[ ]` Confirm VLAN 40 and VLAN 50 traffic from WAP trunk (SW18) reaches correct OPNsense subinterfaces

### 1.3 OPNsense VLAN Firewall Rules
- `[ ]` Confirm VLAN 10 → all VLANs (admin rule) exists
- `[ ]` Confirm VLAN 20 → internet + VLAN 10 services only (no lateral)
- `[ ]` Confirm VLAN 40 → LAN only, no internet, no lateral movement
- `[ ]` Confirm VLAN 50 → internet only, no lateral movement
- `[ ]` Guest VLAN 30 isolation rules (see `README.md` captive portal section)

### 1.4 Captive Portal (`captive.owl.red`)
- **Requires:** 1.1, 1.3
- `[ ]` Verify OPNsense captive portal zone is bound to VLAN 30
- `[ ]` Confirm `captive.owl.red` resolves from VLAN 30 clients
- `[ ]` Test: unauthenticated VLAN 30 client hits splash page
- `[ ]` Test: authenticated client reaches internet, blocked from other VLANs
- `[ ]` DHCP Option 114 (`RFC 8910`) set on VLAN 30 scope in Technitium

---

## 2. Network Cabinet

- `[ ]` Document existing patch panel port assignments (PP1–PP39) in full
- `[ ]` Label all cables front and rear
- `[ ]` Verify all active patch panel runs match `README.md` front patch table
- `[ ]` Identify and label any unused ports
- `[ ]` Tidy cable management; photograph final state for docs

---

## 3. Remote Access — Tailscale

- `[ ]` Choose exit node placement (OPNsense plugin vs. dedicated LXC vs. k8s pod)
- `[ ]` Deploy Tailscale on chosen host
- `[ ]` Confirm `owl.red` split-DNS via Tailscale MagicDNS or override to Technitium
- `[ ]` Verify VLAN 10 services reachable over Tailscale from outside network
- `[ ]` Decide whether IoT VLANs are exposed over Tailscale (probably not)

---

## 4. Shared Storage for Cluster Workloads

Prerequisite for any stateful apps on k8s, including Home Assistant.

- `[ ]` Decide storage backend:
  - Option A: NFS export from `nas.owl.red` (Unraid) — quick, no extra infra
  - Option B: Ceph on cluster nodes — resilient, complex with only 4 small nodes
  - Option C: Longhorn on cluster — simpler than Ceph, fits current node sizes
  - **Likely: NFS from nas short-term, Longhorn medium-term after Unraid→VM migration**
- `[ ]` Create NFS share on `nas.owl.red` for cluster PVCs (`/mnt/user/k8s-pvcs`)
- `[ ]` Deploy NFS CSI driver on Talos cluster (`democratic-csi` or `nfs-subdir-external-provisioner`)
- `[ ]` Create `StorageClass` pointing to NAS NFS export
- `[ ]` Smoke-test with a PVC — confirm pod can write and data persists across pod reschedule
- `[ ]` Document storage class name and NFS path in README

---

## 5. Home Assistant

- **Requires:** 4 (shared storage), 1.1 (correct VLAN for IoT discovery)
- `[ ]` Create `gitops/home-assistant/` Fleet app directory
- `[ ]` Deploy via Helm chart (`home-assistant` from `pajikos` or raw manifests)
- `[ ]` 3-replica `StatefulSet` with `podAntiAffinity` spread across all 3 control-plane nodes
- `[ ]` Persistent volume via NFS StorageClass (10 GiB minimum for config + DB)
- `[ ]` Add `home.owl.red` DNS A record → `10.0.10.201` (already in zone — verify)
- `[ ]` TLS via cert-manager + Traefik IngressRoute (matches existing pattern)
- `[ ]` Home Assistant `homeassistant.http.use_x_forwarded_for` + trusted proxy set to Traefik pod CIDR
- `[ ]` IoT device discovery: HA needs mDNS/multicast access to VLAN 40/50
  - Either run HA with `hostNetwork: true` on a dedicated node
  - Or configure mDNS repeater / Avahi proxy on OPNsense between VLANs
- `[ ]` Integrate ecobee, Bambu A1, Canon printer once network is correct

---

## 6. Certificate Manager — Single Authority for Everything

Currently cert-manager runs on k8s only. LXC workloads (Technitium) and any off-cluster services get no automated certs.

- `[ ]` Decide scope:
  - Option A: Keep cert-manager on k8s only; LXC services use wildcard cert distributed by Ansible
  - Option B: Run `step-ca` or a shared ACME CA accessible by all hosts
  - **Likely: wildcard cert via cert-manager, distributed to LXCs via Bitwarden Secrets + Ansible**
- `[ ]` Generate wildcard `*.owl.red` cert in cert-manager (DNS-01 via Cloudflare — already configured)
- `[ ]` Export wildcard cert to a k8s Secret in a shared namespace
- `[ ]` Ansible task: pull cert from Bitwarden/k8s Secret, deploy to LXC `/etc/ssl/`
- `[ ]` Technitium LXC: configure HTTPS using wildcard cert
- `[ ]` Any future off-cluster service: same Ansible role

---

## 7. App Migration to Cluster

Move remaining self-hosted apps from wherever they are now onto the Talos cluster.

- **Requires:** 4 (storage), 6 (certs), cluster stable
- `[ ]` Inventory all currently running apps and their current hosts
- `[ ]` Prioritize migration order (stateless first, stateful after storage is proven)
- `[ ]` Create `gitops/<app>/` Fleet directories per app, matching existing conventions
- `[ ]` Apps known to need migration (from README workload table):
  - `[ ]` Plex (GPU passthrough needed — may stay on Unraid until VM migration complete)
  - `[ ]` Arr stack (Radarr, Sonarr, etc.)
  - `[ ]` qBittorrent
  - `[ ]` slskd
  - `[ ]` Seer (Overseerr/Jellyseerr)
  - `[ ]` Tautulli
  - `[ ]` Reclaimerr
  - `[ ]` speedtest-tracker
  - `[ ]` Librespeed
  - `[ ]` Homepage (may already be on cluster — verify)
  - `[ ]` flaresolver
- `[ ]` For each app: IngressRoute + TLS cert + PVC + resource limits

---

## 8. Proxmox Backup Server (`pbs.owl.red`)

- `[ ]` Provision PBS VM on `storage.pve.owl.red`
- `[ ]` Assign MAC, update `dhcp-reservations.json` (currently TBD at `10.0.10.33`)
- `[ ]` Configure backup jobs for all PVE VMs and LXCs
- `[ ]` Add `pbs.owl.red` to DNS zone (already has A record — verify IP after provisioning)

---

## Notes

- **VLAN 40 vs. VLAN 50 for IoT**: devices that only need LAN access (printers, 3D printers, local sensors) go to 40. Devices that need cloud APIs (Ecobee, Bambu cloud, voice assistants) go to 50.
- **Unraid → VM migration**: deferred until storage strategy is decided. Plex with GPU passthrough is the main blocker.
- **Tailscale before captive portal**: Tailscale gives a reliable admin path if the captive portal breaks VLAN 30 routing during testing.
- **Home Assistant mDNS**: this is the hardest part. IoT device auto-discovery requires multicast to reach HA across VLANs. Plan this before deploying HA.
