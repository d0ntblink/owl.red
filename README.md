# owl.red : Home Network Infrastructure

> **This repo is the single source of truth for the `owl.red` network.**  
> All changes network, infrastructure, k8s, config : are made here first, then applied.  
> Supported declarative configuration is managed here; documented manual floors and bootstrap steps have explicit ownership and rollback notes.

## Controller Requirements

Before running IaC or scripts, follow the [controller setup and tool requirements](docs/guides/controller-setup.md).
It covers tools, installation, Nix group/session access, Python/Ansible environments,
credentials and validation. Tool installation does not authorize infrastructure changes.

## Observed State (2026-10-14)

Current update (2026-10-17 UTC): VyOS VM 103 is the active `/24` router and VM 102
is the permanent isolated lab. The retired router VM, its 64-GB disk and installer
ISO have been deleted. The dated audit below is historical, not live authority.

The [live audit](docs/issues/008-live-state-vs-repository.md) distinguishes
deployed state from the target tables below. All six PVE hosts, eight guests and
four Talos nodes were online, and all 26 confirmed reservations matched Git.
The network was still flat /16, however: switch ports used PVID 1, the AP uplink
had no link, and Technitium had one NIC with its VLAN 10 DHCP scope disabled.
Gateway/pod DNS, Fleet convergence and management TLS still need correction;
there was no shared-storage/PVC setup or registered PVE backup coverage.

Follow the [roadmap execution order](ROADMAP.md#execution-order) and its
change-scoped [acceptance gates](ROADMAP.md#stabilization-gates). Keep client
DNS/DHCP on VyOS while preparing the network; handoff waits for supporting
VLAN paths and Technitium interfaces plus an approved coordinated change. Resolve
legacy `/16` overlap before routing the contained target `/24`s; management-mask
contraction and management VLAN tagging are different steps.

Full NAS-data backups, PBS, unrelated Fleet/TLS repairs, storage and NAS VM/
passthrough/disk changes are not network entry criteria. Preserve the working
NAS and save only affected configuration/state with practical rollback access
for network work. No live remediation is implied by this documentation update.

## Quick Reference

### VLANs

| VLAN | Name | Subnet | Gateway | DHCP | Purpose |
|------|------|--------|---------|------|---------|
| 10 | `network-devices` | `10.0.10.0/24` | `10.0.10.1` | Technitium `10.0.10.100-199` | Infrastructure management; known devices use MAC reservations |
| 20 | `private-net` | `10.0.20.0/24` | `10.0.20.1` | Technitium `10.0.20.100-199` | Trusted wired and WiFi clients |
| 30 | `guest-net` | `10.0.30.0/24` | `10.0.30.1` | Technitium `10.0.30.100-199` | Guest WiFi with captive portal |
| 40 | `iot-no-inter` | `10.0.40.0/24` | `10.0.40.1` | Technitium `10.0.40.100-199` | IoT with local-only access |
| 50 | `iot-with-inter` | `10.0.50.0/24` | `10.0.50.1` | Technitium `10.0.50.100-199` | IoT with internet, no lateral movement |

These are target VLAN allocations, not proof of a completed network cutover. DHCP
reservations do not configure switch-port or WiFi VLAN membership. The canonical
[DHCP registry](gitops/technitium/dhcp-reservations.json) and
[scope definitions](gitops/technitium/dhcp/scopes.json) own the address plan.

### VLAN 10 Infrastructure Hosts

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.10.1` | `edge.owl.red` | VyOS VM 103 | Active native-LAN gateway/firewall, interim DHCP/DNS; VLANs and guest portal remain planned |
| `10.0.10.2` | `switch.owl.red` | MikroTik CSS326 | Switch management |
| `10.0.10.3` | `edge.pve.owl.red` | CSE-523L Proxmox | Router node PVE host |
| `10.0.10.4` | `storage.pve.owl.red` | RSV-L4500U Proxmox | Storage node PVE host |
| `10.0.10.5` | `nas.owl.red` | Unraid VM 101 on storage.pve | SMB/Plex; NFS planned, currently disabled |
| `10.0.10.6` | `ipmi.storage.owl.red` | X10SRi-F IPMI/BMC | Remote management for storage node |
| `10.0.10.9` | `pdu.owl.red` | APC AP7900B PDU | Rack PDU management |
| `10.0.10.11` | `cp1.pve.owl.red` | ThinkCentre M73 #1 | PVE host for k8s control plane |
| `10.0.10.12` | `cp2.pve.owl.red` | ThinkCentre M73 #2 | PVE host for k8s control plane |
| `10.0.10.13` | `cp3.pve.owl.red` | ThinkCentre M73 #3 | PVE host for k8s control plane |
| `10.0.10.14` | `worker1.pve.owl.red` | ThinkCentre M73 #4 | PVE host for k8s worker |
| `10.0.10.21` | `cp1.k8s.owl.red` | Talos VM on cp1.pve | k8s control plane node |
| `10.0.10.22` | `cp2.k8s.owl.red` | Talos VM on cp2.pve | k8s control plane node |
| `10.0.10.23` | `cp3.k8s.owl.red` | Talos VM on cp3.pve | k8s control plane node |
| `10.0.10.24` | `worker1.k8s.owl.red` | Talos VM on worker1.pve | k8s worker node |
| `10.0.10.31` | `pdm.owl.red` | PDM LXC 231 on cp1.pve | Proxmox Datacenter Manager; cp1-only HA affinity |
| `10.0.10.33` | `pbs.owl.red` | PBS VM planned on storage.pve | Not yet provisioned |
| `10.0.10.40` | `ap.owl.red` | DIR-885L OpenWrt | Recorded WAP management address; unreachable at audit |

### VLAN 20 Private Clients (target allocations)

| IP / Range | Name | Device | Status |
|------------|------|--------|--------|
| `10.0.20.10` | `w1ngz.owl.red` | Main workstation | Confirmed recorded MAC; target reservation |
| `10.0.20.11` | `paranoid-android.owl.red` | LG personal phone | Confirmed recorded MAC; target reservation |
| `10.0.20.12` | `tablet.owl.red` (planned) | Lenovo TB-X606FA bedside tablet | Pending target-SSID MAC; not applied to DHCP or DNS |
| `10.0.20.100-199` | `KAM1WL102916` | Work laptop | Dynamic only; no fixed lease |

### VLAN 40 IoT Hosts (local only)

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.40.10` | `printer.owl.red` | Canon printer (Canon1c2258) | Local network printing |
| `10.0.40.11` | `bambu.owl.red` | Bambu Lab A1 3D printer | Local 3D printing |
| `10.0.40.12` | `wuuk-ptz-foyer.owl.red` | WUUK Y0510 PTZ camera | Foyer monitoring; local-only target |
| `10.0.40.13` | `wuuk-ptz-office.owl.red` | WUUK Y0510 PTZ camera | Office monitoring; local-only target |

### VLAN 50 IoT Hosts (internet permitted)

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.50.10` | `ecobee.owl.red` | Ecobee thermostat | Smart thermostat — needs cloud API access |
| `10.0.50.11` | `shield.owl.red` | NVIDIA Shield TV | Media playback; internet and explicit local-media access |
### Service VIPs and Pools

| IP / Range | Name | Backing Service | Notes |
|------------|------|-----------------|-------|
| `10.0.10.20` | k8s control-plane VIP | Talos `cp1`–`cp3` shared VIP | `kube-apiserver` endpoint `https://10.0.10.20:6443`; floating VIP managed by Talos, not a DHCP host |
| `10.0.10.30` | `ns1.owl.red` | Technitium LXC on edge.pve | DNS service endpoint |
| `10.0.10.201` | `rancher.owl.red`, `dns.owl.red`, `home.owl.red`, `traefik.owl.red` | Traefik + MetalLB | Shared internal ingress VIP for Rancher, Technitium web, Homepage, and Traefik |
| `10.0.10.200-250` | MetalLB VIP pool | Kubernetes LoadBalancer pool | Active for ingress and future services |

Access rule: these service VIPs are intended for LAN clients. They only work when the client can route to VLAN 10 and resolves `owl.red` names from internal Technitium instead of falling through to public DNS.

Router placement rule: `edge.owl.red` is pinned to `edge.pve.owl.red` because it uses physical PCIe NIC passthrough (`hostpci`). Do not plan routine live or offline migration of this VM.

Accepted replacement (2026-10-17 UTC): [ADR 022](docs/decisions/022-vyos-router-replacement.md)
is deployed as VM 103, pinned rolling VyOS with direct WAN/LAN PCI passthrough
and gateway `10.0.10.1/24`. The old router VM 100, its 64-GB virtual disk and
unused installer ISO were explicitly retired. The separate permanent `edge-lab.owl.red`
VM 102 uses 2 vCPU/4 GB and private virtual networking, not production passthrough.
The five target VLANs and Technitium authority handoff are not completed by this
router swap; follow [the roadmap](ROADMAP.md) for those later batches.

First wired pilot accepted (2026-10-17): VLAN 20 has a verified tagged path
between cp1 SW02 and VyOS SFP+1, gateway `10.0.20.1/24`, internet/DNS acceptance
and tested NAS/router-management denials. The temporary client is removed;
DHCP authority and existing client/management addresses remain unchanged. This
does not complete AP/SSID steering, IPv6, full segmentation or client migration.

---

## Front Patching

### Cable Standard

- `BLUE` = infrastructure uplinks and trunks
- `PURPLE` = endpoint and room-drop patching
- `AQUA` = SFP+ DAC links

### Front Patch Summary

CSS326 front numbering is staggered by column: top row is even ports, bottom row is odd ports.

| Switch Port | Patch | Target | Target Role / VLANs | Notes |
|-------------|-------|--------|--------------|-------|
| `SW02` | `PP25` | `cp1.pve.owl.red` | VLAN 10 access | Active |
| `SW04` | `PP26` | `cp2.pve.owl.red` | VLAN 10 access | Active |
| `SW06` | `PP27` | `cp3.pve.owl.red` | VLAN 10 access | Active |
| `SW08` | `PP28` | `worker1.pve.owl.red` | VLAN 10 access | Active |
| `SW10` | `PP29` | `storage.pve.owl.red` | VLAN 10 access | Active, obnic0 |
| `SW12` | `PP30` | `storage.pve.owl.red` | VLAN 10 access | Active, obnic1 (bond standby) |
| `SW14` | `PP31` | `ipmi.storage.owl.red` | VLAN 10 access | Active |
| `SW16` | `PP32` | `pdu.owl.red` | VLAN 10 access | Active |
| `SW18` | `PP33` | `ap.owl.red` | 802.1Q trunk `10/20/30/40/50` | No link in 2026-10-14 audit |
| `SW22` | `PP35` | `Network Cabinet` | 802.1Q trunk `10/20/30/40/50` | Active |
| `SW24` | `PP36` | `edge.pve.owl.red` eth0 | VLAN 10 management | Active |
| `SFP+1` | `PP16 to PP37` | `edge.owl.red` SFP+ passthrough | 10G VyOS uplink path | Active |
| `SFP+2` | `PP39` | `nas.owl.red` SFP+ (Unraid) | 10G storage uplink | Active |

---

## Infrastructure Inventory

### Firewall / Router : Supermicro CSE-523L-505B

| Field | Value |
|-------|-------|
| Chassis | Supermicro CSE-523L-505B (2U) |
| CPU | Intel Core i3-8100 (live audit) |
| Motherboard | Asus PRIME B365M |
| RAM | 32 GB (4 × 8 GB) |
| Hypervisor | Proxmox VE — `edge.pve.owl.red` `10.0.10.3` |
| Router VM | VyOS VM 103, `edge.owl.red` `10.0.10.1/24`; pinned PCIe passthrough, do not migrate |
| Non-production lab | VyOS VM 102, `edge-lab.owl.red`, 2 vCPU/4 GB, private virtual networking |

| Interface | Hardware | MAC | Role | Speed |
|-----------|----------|-----|------|-------|
| `eth0` | onboard NIC | `3c:7c:3f:25:50:6a` | Proxmox management, VLAN 10 → SW24 | 1G |
| `eth0` (VyOS) | passthrough Intel i226-V | `e0:d4:e8:ef:2b:f2` | WAN uplink | 2.5G |
| `iX10` | Intel X710 SFP+ port 0 | `6c:fe:54:70:08:30` | Spare / future path | 10G |
| `eth1` (VyOS) | Intel X710 SFP+ port 1 | `6c:fe:54:70:08:31` | 10G LAN trunk → SW SFP+1 | 10G |

### Switch : MikroTik CSS326-24G-2S+RM

| Field | Value |
|-------|-------|
| Model | MikroTik CSS326-24G-2S+RM |
| OS | SwOS `2.18` |
| Management IP | `10.0.10.2` (`switch.owl.red`) |
| Management MAC | `48:8f:5a:0c:d1:82` |
| Admin login | `admin`; existing Bitwarden password applied and verified after access reset, blank login rejected (2026-10-17) |
| VLAN mode | Target: 802.1Q access/trunk by port; audited ports still Optional/PVID 1, VLAN membership only on disabled port 5 |
| IaC source | `ansible/switch_configs/css326.yml` |

### Storage Node : RSV-L4500U / Supermicro X10SRi-F

| Field | Value | Info |
|-------|-------|------|
| Chassis | RSV-L4500U (4U) | |
| Platform | Supermicro X10SRi-F | LGA 2011 / Xeon |
| RAM | 32 GB | 4 × 8 GB |
| Hypervisor | Proxmox VE | `storage.pve.owl.red` — `10.0.10.4` (bond0 via obnic0+obnic1) |
| Unraid | VM 101 on storage.pve | `nas.owl.red` — `10.0.10.5`; Unraid 7.3.3, NFS disabled |
| IPMI | `10.0.10.6` | Always-on BMC |
| PDM | `10.0.10.31` | LXC 231 actually runs on cp1.pve, not this storage host |
| PBS | `10.0.10.33` | Planned, not yet provisioned |
| Passthrough NIC | Intel 82599ES 2-port SFP+ | Passed to Unraid → SW SFP+2 |
| Passthrough HBA 1 | Broadcom / LSI SAS3008 | Passed to Unraid for direct disk access |
| Passthrough HBA 2 | Broadcom / LSI SAS3008 | Passed to Unraid for direct disk access |
| Passthrough GPU | NVIDIA GeForce GTX 1060 6GB | Passed to Unraid for AI / transcoding |

| Interface | Hardware | MAC | Role | Speed |
|-----------|----------|-----|------|-------|
| `obnic0` | onboard Intel I350 | `ac:1f:6b:47:87:f0` | Proxmox management, bond0 active → SW10 | 1G |
| `obnic1` | onboard Intel I350 | `ac:1f:6b:47:87:f1` | Proxmox management, bond0 standby → SW12 | 1G |
| `iX10` | Intel 82599ES SFP+ port 0 | `f8:f2:1e:48:91:40` | Unraid passthrough → SW SFP+2 | 10G |
| `iX11` | Intel 82599ES SFP+ port 1 | `f8:f2:1e:48:91:41` | Unraid passthrough, spare | 10G |
| `BMC` | ASPEED AST2400 | `ac:1f:6b:4b:b5:e7` | IPMI → SW14 | 1G |

### Wireless Access Point : D-Link DIR-885L (OpenWrt)

| Field | Value |
|-------|-------|
| Model | D-Link DIR-885L (OpenWrt) |
| Management IP | `10.0.10.40` (`ap.owl.red`) |
| Management MAC | `10:be:f5:d9:1e:37` |
| Uplink | `SW18` via `PP33`; native management retained, tagged VLANs `20/40/50`, guest activation deferred |
| Mode | Lightweight Layer-2 AP; DHCP/DNS/routing/filtering on VyOS, no local portal or compute services |
| Power | Verified 8 dBm at 2.4 GHz, 12 dBm at 5 GHz; apartment coverage still needs a client walk-test |

| Target SSID | Target VLAN | Notes |
|------|------|-------|
| `owl.red` | `20` | Active on 2.4/5 GHz; key in Bitwarden `owl-red-wifi-private` |
| `silence of the lans` | `30` | Disabled until external captive-portal enforcement is ready |
| `owl.red-iot-local` | `40` | Active on 2.4 GHz; no internet, isolated clients |
| `owl.red-iot-cloud` | `50` | Active on 2.4 GHz; internet without private-network forwarding |

### Compute Nodes : Lenovo ThinkCentre M73 (×4)

Each node is a single-NIC Lenovo ThinkCentre M73 SFF. The `vmbr0` bridge inherits the physical NIC MAC. The Talos VM virtio NIC is assigned a static `02:00:00:00:00:XX` MAC in the VM config, where the last octet matches the hosted Talos VM's IP (`.21`–`.24`).

| Host | PVE IP | Physical NIC MAC | Talos VM NIC MAC |
|------|--------|-----------------|------------------|
| `cp1.pve.owl.red` | `10.0.10.11` | `00:23:24:7a:87:96` | `02:00:00:00:00:21` |
| `cp2.pve.owl.red` | `10.0.10.12` | `00:23:24:70:ef:b0` | `02:00:00:00:00:22` |
| `cp3.pve.owl.red` | `10.0.10.13` | `00:23:24:6f:c2:4b` | `02:00:00:00:00:23` |
| `worker1.pve.owl.red` | `10.0.10.14` | `00:23:24:6b:dc:f9` | `02:00:00:00:00:24` |

### Kubernetes Cluster : Talos VMs on Proxmox

| Field | Value | Info |
|-------|-------|------|
| Distribution | Talos Linux 1.8.1 + Kubernetes 1.31.1 | Audited runtime; source/ISO still pins Talos 1.7.5 |
| Control plane nodes | `3` | Quorum survives one control-plane failure |
| Worker nodes | `1` | General workload capacity |
| CNI | Flannel (VXLAN) | Current network overlay |
| Placement policy | Availability first | Critical workloads can land on all nodes |
| Control-plane fallback | Partial | Several platform workloads tolerate control-plane nodes; fleet-agent currently does not |
| Ingress strategy | Traefik + MetalLB | Shared ingress VIP on VLAN 10 |
| DNS strategy | Technitium LXC on `edge.pve` | Systemd sync timer in LXC, not k8s; only one live NIC and incomplete DHCP serving path |
| Replica policy | HA is incomplete | Rancher/Traefik/MetalLB have 3 replicas without guaranteed one-per-node placement; fleet-agent has 1; Technitium is one LXC |

| Node Role | vCPU | Memory | Disk | Notes |
|-----------|------|--------|------|-------|
| Control plane (`cp1-3.k8s`) | `2` | `10 GiB` | `40 GiB` | Audited allocation; matches Terraform sizing |
| Worker (`worker1.k8s`) | `4` | `12 GiB` | `40 GiB` | Audited allocation; matches Terraform sizing |

| Workload Group | Services | Placement / Notes |
|----------------|----------|-------------------|
| Ingress and PKI | Traefik, cert-manager | Ingress active; trusted DNS-01 cert only observed for dns.owl.red, other frontend TLS incomplete |
| Platform control | Rancher, Homepage | Cluster management and operator dashboard |
| DNS | Technitium DNS, LXC sync timer | Authoritative `owl.red` DNS and Git-managed reservations; end-to-end DHCP/VLAN serving incomplete |
| Media and apps | Plex target, Arr stack, qBittorrent, slskd, Seer, Tautulli, Reclaimerr | Mixed k8s and media-integrated workloads |
| Utility services | speedtest-tracker, Librespeed, flarednsresolver | Internal utility and observability services |
| Future / specialized | flaresolver, GPU-backed workloads | Planned once GPU path is ready |

### Bedside Tablet : Lenovo Tab M10 FHD Plus

| Field | Value |
|-------|-------|
| Model | Lenovo `TB-X606FA` |
| Serial | `HVA0GSZV` |
| CPU | MediaTek MT8768, 8 cores, up to 2.3 GHz, ARM64 |
| GPU | PowerVR Rogue GE8320 |
| RAM | 2 GB (1.76 GiB visible to Android) |
| Storage | 32 GB eMMC |
| Display | 1200 x 1920 |
| OS | Lenovo Android 10 (API 29) |
| Dock | Lenovo HA-200 |
| Target network | VLAN 20, `10.0.20.12`, planned `tablet.owl.red`; lease MAC pending, current management endpoints unchanged |
| Purpose | Bedside Home Assistant dashboard, alarm clock, and media playback |

See [MAC inventory](docs/mac-inventory.md) for network addresses and
[the tablet setup runbook](nix/android-tablet/README.md) for the fresh-device
sequence, rooting, one-batch cleanup, apps, SSH/Wi-Fi ADB, and known fixes.
The [installed-app log](nix/android-tablet/installed-apps/HVA0GSZV.json)
records the current package IDs and versions. Refresh it from the repo root
with `bash scripts/android-tablet-inventory.sh` after app changes.

### Cameras : WUUK Y0510 (x2)

| Field | Value |
|-------|-------|
| Model | WUUK Y0510 |
| Type | PTZ IP camera |
| CPU / SoC | `t31x` (recorded platform; exact variant not verified) |
| RAM | Not recorded |
| Image sensor | `SC4336P` |
| Flash | `ZB25VQ128` |
| Firmware | Not recorded |
| Purpose | Local camera monitoring, foyer and office |

| Device | Location | MAC | Target VLAN | Target reservation |
|--------|----------|-----|-------------|--------------------|
| `wuuk-ptz-foyer` | Foyer | `02:7f:f6:05:40:fc` | 40 | `10.0.40.12` |
| `wuuk-ptz-office` | Office | `02:2d:1f:56:ee:b8` | 40 | `10.0.40.13` |

Source: [MAC inventory](docs/mac-inventory.md). VLAN 40 follows the local-only
policy selected on 2026-10-14. The older VLAN 10 addresses remain historical
records there; inspect any legacy reservations during the approved cutover.
No live network assignment was changed by this allocation update.

---

## Core Services and Network Behavior

### Service Authority Summary

| Function | Primary Service | Endpoint | Notes |
|----------|-----------------|----------|-------|
| Routing and firewall | OPNsense | `10.0.10.1` and per-VLAN gateways | Default gateway and policy engine |
| DHCP (target: all VLANs) | Technitium | Target multi-homed IPs | Live LXC has one NIC, VLAN 10 scope disabled, no leases; current client-serving authority needs authenticated verification |
| Authoritative DNS | Technitium | Live `10.0.10.30` | LXC on edge.pve; Git sync via its systemd timer |
| Ingress and TLS | Traefik + cert-manager | `10.0.10.201` | Internal ingress VIP for cluster web services; not a public origin endpoint |
| Guest captive portal (target) | OPNsense | `https://captive.owl.red` | Hostname was NXDOMAIN at audit; portal configuration not authenticated/verified |

### DHCP and DNS Plan

| VLAN | DHCP Authority | Range | Router | DNS | Notes |
|------|----------------|-------|--------|-----|-------|
| `10` | Technitium | `10.0.10.100-199` | `10.0.10.1` | `10.0.10.30` | Known infrastructure devices use reservations |
| `20` | Technitium | `10.0.20.100-199` | `10.0.20.1` | `10.0.20.30` | Trusted wired and WiFi clients |
| `30` | Technitium | `10.0.30.100-199` | `10.0.30.1` | `10.0.30.30` | Guest scope with captive portal signaling |
| `40` | Technitium | `10.0.40.100-199` | `10.0.40.1` | `10.0.40.30` | IoT local-only policy |
| `50` | Technitium | `10.0.50.100-199` | `10.0.50.1` | `10.0.50.30` | IoT with internet, no lateral movement |

Technitium is authoritative for `owl.red` on `10.0.10.30`; five VLAN-local
interfaces are the target, not the audited live configuration. Its systemd timer
pulls Git every 15 minutes and skips unchanged commits. All confirmed target
reservations matched live, but there were no leases and VLAN 10's scope was
disabled while the other scopes were enabled. Direct gateway queries returned
NXDOMAIN for internal ingress names, and an existing pod received public answers
or ENOTFOUND. Preserve the OPNsense client path during preparation; final resolver
handoff and enforcement are roadmap G2 work after network readiness, not before.
Any interim resolver repair needs separate justification and rollback.

Before attaching new Technitium NICs, prove explicit DHCP serving-state control;
the prepared source now disables all scopes and adds verified lifecycle calls
plus a default-locked Nix activation gate, but it has not been deployed. The
old running script does not gain that behavior from a Git pull alone. Even a
documentation-only push can trigger the timer's full
settings/zone/scope/reservation pass on a new SHA. Review publishing as an
operational action; see the [Technitium guide](gitops/technitium/README.md).

### Traefik and TLS

- Traefik is exposed as a MetalLB `LoadBalancer` service on `10.0.10.201` for LAN clients.
- `dns.owl.red`, `rancher.owl.red`, `home.owl.red`, and `traefik.owl.red` are expected to resolve internally to `10.0.10.201`.
- DNS-01 is the intended issuance method for internal services. Only `dns.owl.red` had a trusted certificate at audit; no wildcard Certificate was found and other management names served Traefik's default self-signed certificate.
- Source policy limits backend TLS skip-verification to PDM, but the running Traefik still had the global skip-verification flag. Fleet reconciliation and runtime policy must be verified before calling this fixed.
- Traefik dashboard access must be restricted to verified management sources. No IP-allowlist middleware was present; an IP range alone does not prove VLAN 10 isolation while the LAN is flat.

### Cluster Hostname Troubleshooting

- If `curl https://dns.owl.red` or `curl https://rancher.owl.red` fails, check name resolution first. These hostnames should resolve to `10.0.10.201` for LAN clients.
- If `nslookup` or `Resolve-DnsName` returns a public IP instead of `10.0.10.201`, the client is not using healthy internal Technitium answers for `owl.red`.
- `10.0.10.30` is the LXC's DNS service address, not a floating DNS VIP or the Traefik web VIP. `ping` and HTTP checks against `10.0.10.30` are not valid tests for `dns.owl.red`.
- Direct DNS checks should be done against Technitium, for example: `Resolve-DnsName dns.owl.red -Server 10.0.10.30` and `Resolve-DnsName rancher.owl.red -Server 10.0.10.30`.
- If Technitium answers with a public IP for internal names, fix the authoritative zone path first; ingress hostnames behind Traefik will not work until internal DNS returns the correct VIP.

### Guest VLAN Captive Portal

The portal is a target, not a verified live service; `captive.owl.red` was
NXDOMAIN in the October audit. Under [ADR 022](docs/decisions/022-vyos-router-replacement.md),
select a proven enforcement engine and placement for the VyOS guest path before
guest activation. A central web/auth service alone does not enforce access, and
the weak WAP must not host the heavy portal service.

| Setting | Value | Notes |
|---------|-------|-------|
| Enforcement | VLAN 30 on LAN trunk | Engine/placement undecided; cover IPv4 and applicable IPv6 |
| Authentication | Splash-only | Future voucher or RADIUS possible |
| Idle / hard timeout | `0 / 0` target | Validate against the chosen engine |
| Portal hostname | `https://captive.owl.red` | Working guest DNS, trusted TLS and pre-auth reachability required |
| DHCP Option 114 | API URL from the chosen engine, not yet selected | Advertise a real CAPPORT API, not the splash page or old OPNsense endpoint |

Validate policy against the chosen engine, not an assumed OPNsense zone. The
serving router provides agreed interim DNS until the approved final handoff to
the VLAN-local Technitium endpoint. Do not enable final DNS blocking early.

Firewall behavior for the guest VLAN should remain ordered as follows:
1. Allow required DHCP, approved DNS and the specific portal/discovery endpoints before authentication.
2. Support captive HTTP discovery and CAPPORT with a valid HTTPS portal; do not intercept arbitrary HTTPS.
3. Maintain authenticated client state through the chosen enforcement engine.
4. Allow authenticated guests to reach the internet.
5. Deny other unauthenticated traffic; verify IPv6 cannot bypass enforcement.

Guest isolation must block access from VLAN 30 to VLANs 10, 20, 40 and 50 except
the specific approved infrastructure endpoints, and deny router management.
Block cross-VLAN discovery while retaining required local IPv6 control traffic.

### Power and Recovery

| Component | Recorded Power Source | Recovery Target | Audit Status |
|-----------|-----------------------|-----------------|--------------|
| OPNsense, switch, storage, one k8s node | LX1500GU UPS (recorded model) | NUT-triggered WoL and staged recovery | CyberPower USB UPS attached to storage.pve; no running NUT monitoring demonstrated; physical circuit coverage/runtime not tested |
| Technitium LXC | Edge host power path | Starts automatically with `edge.pve` | On-boot configured; DNS runs independently of k8s/storage, but DHCP readiness is incomplete |
| Remaining k8s nodes | Separate power path (recorded) | Quorum-based survival | Three-member etcd healthy; outage/failover behavior not tested |

NUT enable flags are not proof of monitoring or safe shutdown. Verify the power
path before stateful rollout under G6. No PVE backup jobs or registered local
backup objects were found; establish G1's minimum recovery path without waiting
for full PBS deployment. The audit's disabled array slot was empty parity2, not
a demonstrated failed data disk; it did not authorize a repair or rebuild.

---