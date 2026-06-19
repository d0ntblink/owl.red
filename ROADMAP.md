# owl.red Infrastructure Roadmap

Ordered list of outstanding work. Each item is either a prerequisite for something below it or a standalone milestone. Update status as work progresses.

Status: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

**Current focus: Phase 0 — OPNsense Terraform IaC** (codify the firewall before VLAN work, so rules/aliases/overrides are reproducible and survive a reinstall).

**Recently completed (2026-06-18; driven by the "IaC-everything" principle, not phase-numbered):**
- **Unraid (`nas.owl.red`) settings IaC** — API-settable settings are declarative in `terraform/unraid/` (Terraform-GraphQL); flash-file + drift/recapture via the `unraid_settings` Ansible role; array/users/secrets stay manual. NTP→`10.0.10.1` applied + verified (closes §16.1 for the NAS). ADR 021; guides `unraid-making-changes.md`, `unraid-iac.md`.
- **Proxmox cluster Terraform coverage** — audited all 8 guests; scaffolded the 2 gaps (OPNsense VM `100`, PDM LXC `231`); Talos VMs confirmed already in `main.tf`. See §13 and `docs/guides/proxmox-terraform.md`.
- **Shared-storage decision** — NAS NFS for all HA workloads (reuse shares; NFS for k8s/Proxmox/LXC, SMB personal). See §4, ADR 018, `docs/guides/shared-storage.md`.
- **Repo-wide change-method matrix** — `docs/guides/changing-owl-red.md` ("I want to do X → which tool"). Plus README/discrepancy cleanup.

---

## 0. OPNsense — Terraform IaC

OPNsense config is currently all manual. Everything in OPNsense must be reproducible from code before VLAN work begins — otherwise VLAN firewall rules, aliases, and DNS overrides will drift and be unrecoverable after a reinstall.

Scaffold exists at `terraform/opnsense/`. Provider: `browningluke/opnsense` (~> 0.11).

> Scope note: this phase is the OPNsense **config** (firewall/aliases/DNS overrides) via `terraform/opnsense/`.
> The OPNsense **VM shell** (`edge.owl.red`, VMID 100) is a separate concern, scaffolded under
> `terraform/proxmox/opnsense-vm/` (§13). The `aliases.tf` + `dns.tf` here are written but the module has
> never been `init`-ed; firewall rules (`firewall_rules.tf`) don't exist yet — that's the bulk of 0.4.

### 0.1 Bootstrap API Access
- `[ ]` Create dedicated API user in OPNsense: System → Access → Users → Add
- `[ ]` Assign privileges: Firewall, DHCP, Interfaces, Unbound DNS, VPN (as needed)
- `[ ]` Generate API key+secret; store in Bitwarden SM
- `[ ]` Add `OPNSENSE_API_KEY` / `OPNSENSE_API_SECRET` / `OPNSENSE_ENDPOINT` handling to `scripts/terraform-run.sh`
- `[ ]` `terraform -chdir=terraform/opnsense init` — verify provider downloads

### 0.2 Import Existing Config
- `[ ]` Run `terraform plan` and identify all resources that already exist in OPNsense
- `[ ]` Import existing aliases, firewall rules, and Unbound overrides into state
- `[ ]` Verify `terraform plan` shows no diff after import (no unintended changes)

### 0.3 Codify All Current Devices / DHCP Static Mappings
- `[ ]` Add all known devices from `gitops/technitium/dhcp-reservations.json` as OPNsense firewall alias entries and/or DHCP static leases if OPNsense serves DHCP for any scope
- `[ ]` VLAN 10 reserved hosts → aliases in `terraform/opnsense/aliases.tf`
- `[ ]` IoT device aliases (VLAN 40/50) in `terraform/opnsense/aliases.tf`

### 0.4 Codify Firewall Rules
- `[ ]` Add all inter-VLAN policy rules to `terraform/opnsense/firewall_rules.tf`:
  - VLAN 10 admin → all VLANs allowed
  - VLAN 20 private → internet + VLAN 10 services, no lateral
  - VLAN 30 guest → internet only via captive portal, blocked from all VLANs
  - VLAN 40 IoT → LAN only, no internet, no lateral
  - VLAN 50 IoT → internet, no lateral movement
- `[ ]` `terraform apply` — verify rules appear in OPNsense firewall UI
- `[ ]` Test each VLAN segment for correct connectivity

### 0.5 Ongoing
- `[ ]` All future OPNsense changes go through `terraform/opnsense/` — no manual edits
- `[ ]` Add OPNsense to `scripts/terraform-run.sh` workflow documentation

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

### 1.5 Subnet Migration: `/16` → `/24` per VLAN

Currently some hosts and DHCP scopes reference `255.255.0.0` (`/16`) instead of `255.255.255.0` (`/24`). The target is one clean `/24` per VLAN with no overlap.

- `[ ]` **Audit**: identify every place a `/16` mask appears
  - OPNsense interface/subnet config
  - Technitium DHCP scope `subnetMask` fields (`gitops/technitium/dhcp/scopes.json`)
  - Static IPs on any host (Talos configs in `talos/`, Terraform, etc.)
  - Ansible inventory `ansible_host` entries
- `[ ]` **Plan cutover order** — VLAN 10 is highest risk (all infra); do IoT VLANs first to practice
- `[ ]` IoT VLANs (40, 50): change OPNsense subinterface mask → `/24`; update Technitium scopes; verify DHCP still hands out correct range
- `[ ]` Guest VLAN 30: same as IoT
- `[ ]` Private VLAN 20: same; warn personal devices may drop briefly
- `[ ]` Infra VLAN 10: schedule maintenance window
  - Change OPNsense VLAN 10 interface mask to `/24`
  - Confirm all static IPs in `10.0.10.0/24` range (they are — no change needed to addresses)
  - Update Technitium scope `subnetMask` to `255.255.255.0`
  - Rerun `deploy-technitium-lxc.yml` or trigger sync
  - Verify all hosts still reachable
- `[ ]` Update `gitops/technitium/dhcp/scopes.json` with correct `/24` masks for all scopes
- `[ ]` Remove any remaining `/16` references across repo

### 1.6 Captive Portal (`captive.owl.red`)

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

## 4. Shared Storage for HA workloads (NAS = central store)

The NAS is the central shared store for **all HA/stateful things** — k8s PVCs (Home Assistant, *arr config),
Proxmox CT/VM disks on shared storage (real failover), other LXC/VMs, and personal files. **Plan + design:
[`docs/guides/shared-storage.md`](docs/guides/shared-storage.md); decision: [ADR 018](docs/decisions/018-storage-backend.md).**

- `[x]` Decide storage backend → **NFS from `nas.owl.red`, reusing existing shares** (NFS for HA/infra: k8s/Proxmox/LXC;
  SMB for personal). Longhorn medium-term (post Unraid→VM migration) to remove the NAS SPOF. (Ceph rejected: too heavy for 4 small nodes.)
- `[ ]` Lock NFS exports (`shareSecurityNFS=private` + `shareHostListNFS`=VLAN 10; fix `media`'s `public`) — Ansible file-lane (`--check` first)
- `[ ]` Enable NFS globally on Unraid (`shareNFSEnabled=yes`) — array untouched
- `[ ]` k8s: deploy NFS CSI (`nfs-subdir-external-provisioner`/`democratic-csi`) via Fleet → `StorageClass` → smoke-test a PVC (write + survive reschedule)
- `[ ]` Proxmox: `pvesm add nfs` (images/rootdir/iso/backup) on each node → verify CT HA failover (unblocks PDM HA, §11/§13)
- `[ ]` Document StorageClass name, NFS paths, and per-share export rules back into the guide + README

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

## 9. External Access — Cloudflare Tunnel

For services that should be reachable from the internet without opening inbound ports. Complements Tailscale (which handles personal/admin access) — tunnel handles public-facing services like a self-hosted wiki, status page, or anything else intentionally public.

- `[ ]` Decide which services get public exposure (start with zero — add deliberately)
- `[ ]` Create Cloudflare Tunnel in Cloudflare dashboard; save tunnel token to Bitwarden
- `[ ]` Deploy `cloudflared` connector:
  - Option A: k8s Deployment in its own namespace (`cloudflared`)
  - Option B: LXC on `edge.pve` — simpler, no k8s dependency
  - **Likely: k8s Deployment so it benefits from cluster HA**
- `[ ]` Configure tunnel routes in `cloudflared` config (ingress rules by hostname)
- `[ ]` Verify public hostname resolves via Cloudflare and traffic reaches internal service through Traefik
- `[ ]` Firewall rule: confirm OPNsense allows `cloudflared` egress to Cloudflare IPs only
- See: `docs/decisions/012-cloudflare-tunnel-no-inbound-port-forwarding.md`

---

## 10. Cloudflare DNS — GitOps Managed

Currently Cloudflare DNS records are managed manually in the dashboard. Make them code.

- `[ ]` Choose tooling:
  - Option A: Terraform Cloudflare provider — fits existing `terraform/` structure
  - Option B: `external-dns` on k8s with Cloudflare webhook — automatic from Ingress/IngressRoute annotations
  - **Likely: Terraform for static records + external-dns for dynamic cluster services**
- `[ ]` Terraform: create `terraform/cloudflare/` module
  - Import existing records into Terraform state (`terraform import`)
  - Commit `main.tf` / `records.tf` to repo
  - Add to `scripts/terraform-run.sh`
- `[ ]` `external-dns`: deploy to k8s, point at Cloudflare zone, annotate IngressRoutes
- `[ ]` Remove manual records from Cloudflare dashboard once Terraform manages them
- `[ ]` Verify `owl.red` public records (MX, TXT/SPF, tunnel CNAME) survive import

---

## 11. File Storage Migration: OneDrive → Google Drive

Personal/family file storage migration. Infrastructure-adjacent — needs to be done before decommissioning any Microsoft 365 dependency.

- `[ ]` Inventory what is on OneDrive and who uses it
- `[ ]` Decide Google Workspace tier or free Drive (shared drives need Workspace Business)
- `[ ]` Use `rclone` to migrate: `rclone copy onedrive: gdrive: --progress --checksum`
- `[ ]` Verify file count and sizes match post-migration
- `[ ]` Update any app integrations pointing at OneDrive (e.g. document editors, backups)
- `[ ]` Keep OneDrive read-only for 30 days then decommission

---

## 12. Mail — Self-Hosted `@owl.red` Mail Server

Hosted mail for `owl.red` users. Also a dependency for any service that needs to send email (HA alerts, cluster notifications, etc.).

### 12.1 Evaluate Proton Mail Replacement
- `[ ]` Options:
  - **Self-hosted**: Stalwart Mail (modern, all-in-one SMTP/IMAP/JMAP) — fits k8s well
  - **Self-hosted**: Maddy — minimal, single binary
  - **Managed**: Fastmail, Migadu — no infra overhead
  - **Recommendation**: Stalwart on k8s for full control; Migadu if ops burden is a concern
- `[ ]` Decide and document in `docs/decisions/`

### 12.2 Deploy Mail Server (if self-hosted)
- `[ ]` Requires: Cloudflare tunnel or open port 25 inbound (or smart relay via Mailgun/SES for outbound)
- `[ ]` Provision persistent volume for mail store (NFS StorageClass — see milestone 4)
- `[ ]` TLS cert for `mail.owl.red` via cert-manager
- `[ ]` Cloudflare DNS: MX record → `mail.owl.red`, SPF TXT, DKIM TXT, DMARC TXT
- `[ ]` Create user accounts for all `owl.red` users
- `[ ]` Test send + receive, DKIM signing, spam score (mail-tester.com)
- `[ ]` Configure services to relay through mail server:
  - Home Assistant notifications
  - Cluster alerting (Alertmanager)
  - Any app needing SMTP

### 12.3 Migrate from Proton Mail
- `[ ]` Export Proton Mail messages (use Proton Mail Bridge + `imapsync` or `mbsync`)
- `[ ]` Import into new mail server
- `[ ]` Update MX records to point at new server
- `[ ]` Monitor for 30 days, keep Proton active during transition

---

## 13. Proxmox IaC — All VMs and LXCs via Terraform

Every Proxmox workload must be reproducible from `terraform/proxmox/`. Manual `qm`/`pct` create commands are not acceptable after this milestone is complete.

### 13.1 Audit Current State
- `[ ]` List all VMs and LXCs across all nodes: `pvesh get /cluster/resources --type vm`
- `[ ]` Cross-reference against `terraform/proxmox/` — identify anything not in Terraform state
- `[ ]` For each unmanaged resource: decide import vs. recreate

### 13.2 Import / Codify Existing Workloads
Known workloads — add `.tf` file per workload, import into state:

| Workload | Node | VMID | Status |
|----------|------|------|--------|
| `edge.owl.red` (OPNsense VM) | edge.pve | 100 | `[~]` scaffold `terraform/proxmox/opnsense-vm/` — import pending |
| `nas.owl.red` (Unraid VM) | storage.pve | 101 | `[x]` `terraform/proxmox/nas/nas.tf` |
| Technitium LXC | edge.pve | 200 | `[x]` `terraform/proxmox/technitium/technitium-lxc.tf` |
| PDM LXC | cp1.pve | 231 | `[~]` scaffold `terraform/proxmox/pdm/` — import pending |
| PBS VM | storage.pve | TBD | `[ ]` not yet provisioned |
| Talos cp1.k8s VM | cp1.pve | 601 | `[x]` `terraform/proxmox/technitium/main.tf` (`control_planes`) |
| Talos cp2.k8s VM | cp2.pve | 602 | `[x]` `main.tf` (`control_planes`) |
| Talos cp3.k8s VM | cp3.pve | 603 | `[x]` `main.tf` (`control_planes`) |
| Talos worker1.k8s VM | worker1.pve | 604 | `[x]` `main.tf` (`workers`) |

- `[ ]` `terraform -chdir=terraform/proxmox/<workload> import <resource> <vmid>` for each
- `[ ]` Verify `terraform plan` shows no diff after import
- `[ ]` All new workloads going forward: `.tf` first, then `apply`

### 13.3 Talos IaC — Document and Codify
- `[ ]` Document current `talos/` directory structure in `docs/guides/talos-iac.md`:
  - `talos/config/` — machine configs (generated by `talosctl gen config`)
  - `talos/patches/` — patch files applied per node/role
  - How configs are applied: `talosctl apply-config`
  - How upgrades work: `talosctl upgrade`
- `[ ]` Pin Talos version in `talos/config/` (if not already)
- `[ ]` Document the full bootstrap sequence: Terraform (VM) → Talos config apply → `talosctl bootstrap` → kubeconfig
- `[ ]` Confirm `terraform/proxmox/technitium/` Talos provider resources match current cluster state
- `[ ]` If not already: add `talosctl health` check to post-deploy validation

---

## 14. Physical Documentation — Rack Diagram, Floor Plan, Photos

### 14.1 Rack Diagram
- `[ ]` Create rack diagram in draw.io (free, exports SVG/PNG, no Visio license needed)
  - Alternative: `rack-diagrams` YAML-to-SVG tool if you prefer code-as-diagrams
- `[ ]` Include: PDU, UPS, patch panels (PP1–PP39), switch, all servers, cable management
- `[ ]` Label U positions, cable colors (BLUE/PURPLE/AQUA per README standard)
- `[ ]` Export as SVG + PNG; commit to `docs/diagrams/rack.svg` and `docs/diagrams/rack.png`

### 14.2 Network Diagram
- `[ ]` Create logical network diagram:
  - Physical layer: switch ports, SFP+ links, WAP trunk
  - VLAN layer: per-VLAN subnets, DHCP ranges, gateway IPs
  - Service layer: Technitium, OPNsense, Traefik VIP, MetalLB pool
- `[ ]` Export to `docs/diagrams/network-logical.svg`
- `[ ]` Create physical layer diagram (which NIC connects where)
- `[ ]` Export to `docs/diagrams/network-physical.svg`

### 14.3 Floor Plan
- `[ ]` Sketch room layout with rack location, WAP location, cable run paths
- `[ ]` Mark wired drop points and which patch panel port they map to
- `[ ]` Photo or scan; commit to `docs/diagrams/floor-plan.png`

### 14.4 Photos
- `[ ]` Photograph front of rack (labeled)
- `[ ]` Photograph rear of rack (cable management)
- `[ ]` Photograph patch panel front and rear
- `[ ]` Commit to `docs/photos/` with filenames matching what they show

---

## 15. Documentation Completeness Pass

Do this last — docs written after everything is running are accurate.

### 15.1 Guides (create in `docs/guides/`)
- `[ ]` `opnsense-terraform.md` — bootstrap API user, run terraform, import workflow
- `[ ]` `talos-iac.md` — full Talos VM → config → bootstrap → upgrade sequence
- `[x]` `proxmox-terraform.md` — cluster IaC coverage audit, passthrough commands, add-a-node (incl. Talos) — done 2026-06-18
- `[ ]` `fleet-gitops.md` — how Fleet watches this repo, how to add a new app
- `[ ]` `vlan-setup.md` — VLAN architecture, how to add a new VLAN end-to-end
- `[ ]` `storage-setup.md` — NFS share → CSI driver → StorageClass → PVC workflow
- `[ ]` `cert-manager.md` — wildcard cert workflow, how LXCs get certs
- `[ ]` `tailscale.md` — how to connect, what's exposed, split-DNS setup
- `[ ]` `mail-server.md` — user creation, SMTP relay config for services

### 15.2 Decisions (create in `docs/decisions/`)
- `[ ]` `016-opnsense-terraform.md` — why OPNsense config is managed by Terraform
- `[ ]` `017-mail-server-choice.md` — Stalwart vs. Migadu decision
- `[x]` `018-storage-backend.md` — NFS-from-NAS now, Longhorn later (created 2026-06-18)
- `[ ]` `019-tailscale-vs-vpn.md` — why Tailscale over WireGuard/OpenVPN
- `[x]` `021-unraid-hybrid-iac.md` — hybrid API/File/Manual IaC for the Unraid NAS (done 2026-06-18)

### 15.3 README
- `[ ]` Update README workload table to reflect final state
- `[ ]` Add links to key guides
- `[ ]` Add architecture diagram inline (SVG from 14.2)
- `[ ]` Verify every IP/hostname/MAC in README matches live state

---

## 16. Time Synchronization

Two layers: a free consolidation fix (do first), and an optional GNSS stratum-1
appliance (resilience / hobby). Nothing in the stack *requires* high-precision time
(etcd/TLS/logs tolerate ordinary NTP), so 16.1 is the real win and 16.2 is optional.

### 16.1 Point everything at OPNsense as the LAN NTP server (free, do first)
Today hosts sync inconsistently: Unraid points at public `*.pool.ntp.org`, others at
pool/mixed sources. **Decision: OPNsense (`10.0.10.1`) is the single internal NTP
authority for the LAN.** Every host points at it; OPNsense itself uses the public
pool as upstream. (If/when the GNSS appliance in 16.2 exists, it feeds OPNsense as an
additional source.)

- `[ ]` Confirm OPNsense NTP service is enabled and serving on `10.0.10.1`
  (Services → Network Time → General); restrict to LAN VLANs
- `[ ]` Point all hosts at `10.0.10.1` (manage via IaC where possible):
  - `[x]` Unraid — NTP set to `10.0.10.1` via the `unraid_settings` role (GraphQL
    `updateSystemTime`); verified `NTP_SERVER1=10.0.10.1` (2–4 cleared) in `ident.cfg`. (2026-06-18)
  - `[ ]` Proxmox hosts — chrony/systemd-timesyncd → `10.0.10.1` via Ansible
  - `[ ]` Talos nodes — `machine.time.servers: [10.0.10.1]` in machine config, reapply
  - `[ ]` Technitium LXC — NixOS `services.timesyncd`/chrony → `10.0.10.1`
- `[ ]` Verify skew across all hosts is < ~100 ms (`chronyc tracking` / `timedatectl`)

### 16.2 Optional — GNSS stratum-1 NTP appliance (Pi 4 + PPS)
Internet-independent LAN time. **Accuracy comes from PPS (pulse-per-second) into a
GPIO pin**, disciplined by chrony — *not* from NIC PTP. The existing **Pi 4 is ideal**
for this (its lack of NIC hardware-PTP timestamping is irrelevant for a GPS NTP
server; PTP only matters for distributing PTP over Ethernet, which nothing here uses).

- `[ ]` Build the appliance (parts list below); wire PPS → GPIO18
- `[ ]` Enable `dtoverlay=pps-gpio,gpiopin=18` + UART; install `gpsd` + `chrony`
- `[ ]` chrony: PPS as `refclock`, **plus** internal/pool servers as fallback
  (never single-source — a bad GPS fix must not poison LAN time)
- `[ ]` Place on VLAN 10 (`time.owl.red`), add DNS A record + DHCP reservation
- `[ ]` Feed it into 16.1 as **one source among several** on the internal NTP server
- `[ ]` Mount antenna with real sky view (window/roof run) — this is the actual cost

**Parts list (HAT build — recommended, no soldering):**

| Part | Notes | Approx |
|------|-------|--------|
| Raspberry Pi 4 | **already owned** | — |
| Uputronics GPS/RTC HAT (u-blox MAX-M8Q/M10, PPS on GPIO18 + RTC) | Gold standard for Pi NTP; PPS pre-wired | ~$60–80 |
| Active GPS antenna (SMA, ≥28 dB) + adapter if u.FL | Sky view critical | ~$15–25 |
| Pi PSU + case + microSD | likely on hand | ~$0–25 |

**Cheaper DIY alternative (jumper wiring):** u-blox NEO-M8N/M9N breakout w/ PPS pin
(~$15–25, antenna often included) wired to GPIO (PPS→18, TX/RX→UART, 3V3/GND).
Functionally identical stratum-1; trades ~$45 for soldering/wiring + less tidy.

> Prices are approximate (recalled) — confirm current SKUs/stock before buying.
> Adafruit Ultimate GPS HAT is a valid fallback but needs a solder jumper for PPS.

### Decision to record
- `[ ]` `docs/decisions/020-time-sync-gnss.md` — internal NTP consolidation; GNSS
  optional, justified by resilience not necessity; Pi 4 + PPS over PTP

---

## Notes

- **VLAN 40 vs. VLAN 50 for IoT**: devices that only need LAN access (printers, 3D printers, local sensors) go to 40. Devices that need cloud APIs (Ecobee, Bambu cloud, voice assistants) go to 50.
- **Unraid → VM migration**: deferred until storage strategy is decided. Plex with GPU passthrough is the main blocker.
- **Tailscale before captive portal**: Tailscale gives a reliable admin path if the captive portal breaks VLAN 30 routing during testing.
- **Home Assistant mDNS**: this is the hardest part. IoT device auto-discovery requires multicast to reach HA across VLANs. Plan this before deploying HA.
- **Mail inbound delivery**: port 25 inbound is blocked by most residential ISPs. Use Cloudflare Email Routing to receive and relay to self-hosted SMTP, or use a VPS SMTP relay with `cloudflared` for the web UI.
- **draw.io vs. Visio**: draw.io is free, cross-platform, exports editable XML committed to git. Prefer it over Visio unless you already have a license.
- **Terraform import order**: always import before writing new resources. Terraform will refuse to create a resource that already exists by ID.
