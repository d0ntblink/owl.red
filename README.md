# owl.red : Home Network Infrastructure

> **This repo is the single source of truth for the `owl.red` network.**  
> All changes network, infrastructure, k8s, config : are made here first, then applied.  
> No configuration is managed outside this repo except for initial hardware bootstrap.

> **Planning status:** pre-implementation design and review.  
> Items described here are target architecture until explicitly marked as implemented.

**Domain:** `owl.red` | **IP Space:** `10.0.0.0/8` | **VLAN Schema:** `10.0.<vlan>.<host>/24`

**How to read this README quickly:**
- This file is the high-level architecture and intended end state.
- Detailed rationale and open tradeoffs live in `docs/decisions/`.
- Device-level validation steps live in `DEVICE_TEST_PROCEDURES.md`.

## Automation Prerequisites

The control node (e.g., your laptop or automation runner) must have the `owl.red` automation SSH private key loaded to execute Ansible playbooks against the infrastructure. This key is securely stored in the `owl.red` Bitwarden organization and must be retrieved prior to running any configuration management tasks.
---

## Network Summary

### VLANs

| VLAN | Name | Subnet | Description |
|------|------|--------|-------------|
| 10 | `network-devices` | `10.0.10.0/24` | Infrastructure management : static IPs only |
| 20 | `private-net` | `10.0.20.0/24` | Trusted devices : wired + WiFi |
| 30 | `guest-net` | `10.0.30.0/24` | Guest WiFi : captive portal, internet only |
| 40 | `iot-no-inter` | `10.0.40.0/24` | IoT : local only, no internet |
| 50 | `iot-with-inter` | `10.0.50.0/24` | IoT : internet permitted, no lateral movement |

### VLAN Gateway Plan (Confirmed)

Each VLAN uses its own OPNsense interface-local gateway.

| VLAN | Gateway |
|------|---------|
| 10 | `10.0.10.1` |
| 20 | `10.0.20.1` |
| 30 | `10.0.30.1` |
| 40 | `10.0.40.1` |
| 50 | `10.0.50.1` |


## Static IP Assignments : `network-devices` VLAN

| IP | Hostname | Device | Role |
|----|----------|--------|------|
| `10.0.10.1` | `edge.owl.red` | OPNsense VM | VLAN 10 gateway, firewall, captive portal |
| `10.0.10.2` | `switch.owl.red` | MikroTik CSS326 | Switch management |
| `10.0.10.3` | `edge.pve.owl.red` | CSE-523L Proxmox | Router node PVE host |
| `10.0.10.4` | `storage.pve.owl.red` | RSV-L4500U Proxmox | Storage node PVE host |
| `10.0.10.5` | `nas.owl.red` | Unraid VM | NFS/SMB storage, Plex media |
| `10.0.10.6` | `ipmi.storage.owl.red` | X10SRi-F IPMI/BMC | Remote management for storage.pve.owl.red |
| `10.0.10.7` | `pdu.owl.red` | APC AP7900B PDU | PDU management (2 units, front IP only) |
| `10.0.10.11` | `cp1.pve.owl.red` | ThinkCentre M73 #1 | PVE host : k8s control plane node |
| `10.0.10.12` | `cp2.pve.owl.red` | ThinkCentre M73 #2 | PVE host : k8s control plane node |
| `10.0.10.13` | `cp3.pve.owl.red` | ThinkCentre M73 #3 | PVE host : k8s control plane node |
| `10.0.10.14` | `worker1.pve.owl.red` | ThinkCentre M73 #4 | PVE cluster host : k8s worker node |
| `10.0.10.21` | `cp1.k8s.owl.red` | k8s VM on cp1.pve | k8s control plane + worker VM |
| `10.0.10.22` | `cp2.k8s.owl.red` | k8s VM on cp2.pve | k8s control plane + worker VM |
| `10.0.10.23` | `cp3.k8s.owl.red` | k8s VM on cp3.pve | k8s control plane + worker VM |
| `10.0.10.24` | `worker1.k8s.owl.red` | k8s VM on worker1.pve | k8s worker VM |
| `10.0.10.40` | `ap.owl.red` | DIR-885L OpenWrt | WAP management |
| `10.0.10.30` | `dns.owl.red` | Technitium (on k8s cluster) | DNS service endpoint (HA via k8s) |
| `10.0.10.31` | `pdm.owl.red` | PDM VM | Proxmox Datacenter Manager |
| `10.0.10.201` | `rancher.owl.red` | Rancher service endpoint | Rancher UI/API ingress endpoint (via Traefik/MetalLB VIP) |
| `10.0.10.201` | `flame.owl.red` | Flame service endpoint | Dashboard candidate #1 (GitOps-managed via Fleet) |
| `10.0.10.201` | `homepage.owl.red` | Homepage service endpoint | Dashboard candidate #2 (GitOps-managed via Fleet) |
| `10.0.10.201` | `homer.owl.red` | Homer service endpoint | Dashboard candidate #3 (GitOps-managed via Fleet) |
| `10.0.10.33` | `pbs.owl.red` | PBS VM | Proxmox Backup Server |
| `10.0.10.200–250` | MetalLB VIP pool (active) | Kubernetes LoadBalancer address pool | Active for Traefik and future services |

Router placement rule: `edge.owl.red` is pinned to `edge.pve.owl.red` because it uses physical PCIe NIC passthrough (`hostpci`). Do not plan live/offline migration of this VM as part of normal operations.

---

## Current Rack Layout (Physical)

Current physical layout from the latest rack photo (top to bottom). Old label stickers are ignored.

```text
+--------------------------------------------------------------------------------------+
|                         owl.red Rack Elevation (27U, Top -> Bottom)                  |
|                       (U numbers shown on left and right rails)                       |
+--------------------------------------------------------------------------------------+
| U27 | Patch Panel (2U total)                                             | U27 |
| U26 | Patch Panel (2U total)                                             | U26 |
| U25 | MikroTik CSS326-24G-2S+RM (1U)                                     | U25 |
| U24 | Supermicro CSE-523L-505B router chassis (2U, i3 / OPNsense path)   | U24 |
| U23 | Supermicro CSE-523L-505B router chassis (2U, i3 / OPNsense path)   | U23 |
| U22 | Cable manager / patch transition zone                              | U22 |
| U19 | Shelf: Lenovo M73 node group (4 units total)                       | U19 |
| U18 | Shelf: Lenovo M73 node group (2 center vertical, 2 side-mounted)   | U18 |
| U17 | Shelf: Lenovo M73 node group                                       | U17 |
| U16 | Shelf: Lenovo M73 node group                                       | U16 |
| U15 | Shelf: Lenovo M73 node group                                       | U15 |
| U14 | Shelf: CyberPower LX1500GU UPS                                     | U14 |
| U13 | Shelf: CyberPower LX1500GU UPS           Back: APC AP7900B PDU     | U13 |
| U12 | Shelf: CyberPower LX1500GU UPS           Back: APC AP7900B PDU     | U12 |
| U11 | RSV-L4500U NAS chassis (4U storage section)                        | U11 |
| U10 | RSV-L4500U NAS chassis (4U storage section)                        | U10 |
| U09 | RSV-L4500U NAS chassis (4U storage section)                        | U09 |
| U08 | RSV-L4500U NAS chassis (4U storage section)                        | U08 |
| U07 | Lower cabinet / door panel zone                                    | U07 |
| U06 | Lower cabinet / door panel zone                                    | U06 |
| U05 | Lower cabinet / door panel zone                                    | U05 |
| U04 | Lower cabinet / door panel zone                                    | U04 |
| U03 | Lower cabinet / door panel zone                                    | U03 |
| U02 | Bottom shelf / spare                                               | U02 |
| U01 | Bottom clearance                                                    | U01 |
+--------------------------------------------------------------------------------------+
```

Notes:
- This diagram is physical placement only, not logical network flow.
- Device names and IP roles remain authoritative in the tables above.
- U ranges for shelf and cabinet zones are estimated from the photo angle and should be adjusted after direct rail measurement.
- WAP (`ap.owl.red`) is mounted on the right side of the rack (external to front U rails), not in a front U slot.

---

## Front Rack Port Configuration and Patching Plan

This section defines a clean front-of-rack patching standard for the patch panel, switch, and router chassis.

### Color Standard

- `BLUE` = infrastructure uplinks/trunks (critical paths)
- `PURPLE` = endpoint/data patching (room drops and device access)
- `AQUA` = SFP+ DAC links (direct attach copper, no fiber panel path)

### Device Port Roles

#### Router Chassis (`CSE-523L-505B`)

| Router Port | Role | Cable Color | Connected To |
|-------------|------|-------------|--------------|
| `R0` | WAN uplink (ISP handoff) | `BLUE` | ISP modem/ONT (direct) |
| `R1` | Primary LAN trunk (VLAN 10/20/30/40/50 tagged) | `BLUE` | Switch `SW17` |
| `R2` | Management/fallback link (disabled by default) | `BLUE` | Switch `SW18` (reserved) |
| `R3` | Future DMZ/WAN2 | `BLUE` | Reserved |

#### Switch (`MikroTik CSS326-24G-2S+RM`)

| Switch Port | Mode | VLANs | Cable Color | Front-Patch Target |
|-------------|------|-------|-------------|--------------------|
| `SW17` | Trunk | `10,20,30,40,50` (tagged) | `BLUE` | Router `R1` (active LAN trunk) |
| `SW18` | Access/Reserved | `10` | `BLUE` | Router `R2` (fallback, disabled) |
| `SW19` | Trunk | `10,20,30,40,50` (tagged) | `BLUE` | AP uplink (`ap.owl.red`) via patch panel |
| `SW1-SW9` | Access | `10` | `PURPLE` | Infrastructure/management drops |
| `SW10-SW16` | Access | `20` | `PURPLE` | Private LAN drops |
| `SW20-SW22` | Access | `30` | `PURPLE` | Guest LAN drops |
| `SW23` | Access | `40` | `PURPLE` | IoT no-internet drop |
| `SW24` | Access | `50` | `PURPLE` | IoT with-internet drop |
| `SFP+1` | Reserved trunk (future 10G) | `10,20,30,40,50` | `AQUA` | OPNsense future SFP+ via direct DAC through keystone pass-through |
| `SFP+2` | Reserved storage/uplink (future 10G) | As needed | `AQUA` | Storage path via direct DAC through keystone pass-through |

### Front View ASCII Patch Map (Color-Linked)

`PPxx` = patch panel port number, `SWx` = switch RJ45 port.

```text
TOP FRONT (Patch Panel)
PP01 PP02 PP03 PP04 PP05 PP06 PP07 PP08 PP09 PP10 PP11 PP12 PP13 PP14 PP15 PP16 PP17 PP18 PP19 PP20 PP21 PP22 PP23 PP24
PP25 PP26 PP27 PP28 PP29 PP30 PP31 PP32 PP33 PP34 PP35 PP36 PP37 PP38 PP39 PP40 PP41 PP42 PP43 PP44 PP45 PP46 PP47 PP48


MIDDLE FRONT (Switch)
SW02 SW04 SW06 SW08 SW10 SW12 SW14 SW16 SW18 SW20 SW22 SW24     
SW01 SW03 SW05 SW07 SW09 SW11 SW13 SW15 SW17 SW19 SW21 SW23 SFP+1 SFP+2

PHYSICAL ORIENTATION NOTE
CSS326 front numbering is staggered by column:
top row = even ports (`2 4 6 ... 24`), bottom row = odd ports (`1 3 5 ... 23`).

ACTIVE ASSIGNMENT (3-char tags)
PP25 <-> SW01 = CP1
PP26 <-> SW02 = CP2
PP27 <-> SW03 = CP3
PP28 <-> SW04 = WR1
SW05 = EDG
PP30 <-> SW06 = STO
PP31 <-> SW07 = IPM
SW08 = KVM
PP32 <-> SW09 = PDU
PP19 <-> SW19 = WAP (BLUE trunk)

TAG LEGEND
CP1=cp1.pve  CP2=cp2.pve  CP3=cp3.pve  WR1=worker1.pve
EDG=edge.pve STO=storage.pve IPM=ipmi.storage KVM=service laptop/KVM WAP=ap.owl.red
```

CRITICAL BLUE LINKS
BLUE-A: SW17 <-----------------------------------------------> Router R1 (LAN trunk, active)
BLUE-B: SW18 <-----------------------------------------------> Router R2 (fallback, disabled)
BLUE-C: SW19 <----> PP19 ----(rear run)----> AP uplink (VLAN trunk)
DAC-01 (AQUA): SFP+1 <== direct DAC via keystone pass-through ==> OPNsense future SFP+ trunk
DAC-02 (AQUA): SFP+2 <== direct DAC via keystone pass-through ==> Storage future 10G path

WAP physical note:
- `ap.owl.red` is on the right side of the rack and is fed by `BLUE-C` (`SW19 -> PP19 -> AP`).


### Active Purple Cable Plan (Current Systems)

These are the current purple front patches for systems already in your rack/device list.

| Purple Link | Patch Panel | Switch Port | Device | VLAN / Purpose |
|-------------|-------------|-------------|--------|----------------|
| `PURPLE-01` | `PP25` | `SW01` | `cp1.pve.owl.red` (`10.0.10.11`) | VLAN 10 management |
| `PURPLE-02` | `PP26` | `SW02` | `cp2.pve.owl.red` (`10.0.10.12`) | VLAN 10 management |
| `PURPLE-03` | `PP27` | `SW03` | `cp3.pve.owl.red` (`10.0.10.13`) | VLAN 10 management |
| `PURPLE-04` | `PP28` | `SW04` | `worker1.pve.owl.red` (`10.0.10.14`) | VLAN 10 management |
| `PURPLE-05` | `N/A` | `SW05` | `edge.pve.owl.red` (`10.0.10.3`) | VLAN 10 Proxmox management |
| `PURPLE-06` | `PP30` | `SW06` | `storage.pve.owl.red` (`10.0.10.4`) | VLAN 10 Proxmox management |
| `PURPLE-07` | `PP31` | `SW07` | `ipmi.storage.owl.red` (`10.0.10.6`) | VLAN 10 BMC/IPMI |
| `PURPLE-08` | `N/A` | `SW08` | `KVM/laptop` (reserved) | VLAN 10 management (break-glass, no active patch) |
| `PURPLE-08` | `PP32` | `SW09` | `pdu.owl.red` (`10.0.10.7`) | VLAN 10 management (2 PDUs, front IP only) |

Active non-purple front link to current systems:
- `BLUE-C`: `SW19 <-> PP19 <-> ap.owl.red` (`10.0.10.40`) VLAN trunk (10/20/30/40/50)

Break-glass requirement:
- `PURPLE-08` (`SW08`) stays reserved as untagged VLAN 10 recovery access during all VLAN cutover work.


---

## Device Inventory

### Firewall / Router : Supermicro CSE-523L-505B

| Field | Value |
|-------|-------|
| Chassis | Supermicro CSE-523L-505B (2U) |
| CPU | Intel i3 8300 |
| RAM | 16 GB (4× 8 GB) |
| NIC (passthrough) | 4-port PCIe GbE : fully passed to OPNsense VM |
| NIC (passthrough) | 2-port PCIe SFP+ : fully passed to OPNsense VM, goes to switch and uplink |
| NIC (management) | Onboard NIC : Proxmox host management, VLAN 10 untagged |
| Hypervisor | Proxmox VE |
| VM | OPNsense |
| Proxmox host IP | `10.0.10.3` |
| OPNsense VLAN gateway IPs | `10.0.10.1`, `10.0.20.1`, `10.0.30.1`, `10.0.40.1`, `10.0.50.1` |

**4-port NIC port assignment (inside OPNsense):**

| Port | Role |
|------|------|
| 0 | WAN : ISP uplink |
| 1 | LAN trunk → MikroTik CSS326 (tagged VLAN 10/20/30/40/50) |
| 2 | Reserved : WAN2 / dedicated management fallback |
| 3 | Reserved : future DMZ |

**future 2-port SFP+ assignment (inside OPNsense):**

| Port | Role |
|------|------|
| 0 | LAN trunk → MikroTik CSS326 (tagged VLAN 10/20/30/40/50) : future 10G upgrade |       
| 1 | Reserved : future WAN uplink or direct to storage |

**Trunk migration plan (proposed):** Keep the active 1G trunk (port 1, 4-port GbE NIC) as production until SFP+ is validated. Planned cutover: (1) validate 10G link, (2) configure VLAN tags on SFP+ trunk, (3) move traffic during maintenance window, (4) validate all VLANs, (5) retire 1G trunk after successful validation.

---

### Switch : MikroTik CSS326-24G-2S+RM

| Field | Value |
|-------|-------|
| Type | Layer 2 smart managed switch : **no routing** |
| OS | SwOS (MikroTik's custom switch OS) |
| Ports | 24× GbE + 2× SFP+ |
| Management IP | `10.0.10.2` |
| VLAN mode | 802.1Q |

---

### Storage Node : RSV-L4500U (4U, Supermicro X10SRi-F platform)

| Field | Value |
|-------|-------|
| Chassis | RSV-L4500U (4U) |
| CPU | X10SRi-F : LGA 2011, E5 Xeon family |
| RAM | 32 GB (4× 8 GB) |
| future GPU | 1060 or 1660 6Gb card for AI and transcoding workloads |
| Onboard NIC 1 (eth0) | PVE management : `10.0.10.4` |
| Onboard NIC 2 (eth1) | Available : bond with eth0 for mgmt, or future VLAN 60 storage |
| IPMI port | Dedicated BMC : `10.0.10.6` (`ipmi.storage.owl.red`) : always on, OS-independent |
| PCIe NIC | 4-port GbE : **fully passed to Unraid VM** (all 4 ports for NFS bonding/LACP inside Unraid) |
| future PCIe NIC | **fully passed to Unraid VM** 2-port PCIe SFP+ : one port to switch; one port reserved for direct storage network or direct to edge |
| Hypervisor | Proxmox VE |
| VMs | Unraid (HBA + NVMe passthrough), PDM, PBS |
| Proxmox host IP | `10.0.10.4` |
| Unraid VM IP | `10.0.10.5` |
| Technitium VIP | `10.0.10.30` (service endpoint on k8s) |
| PDM VM IP | `10.0.10.31` |
| Rancher endpoint IP | Traefik exposure via MetalLB VIP (`10.0.10.201`) |
| PBS VM IP | `10.0.10.33` |

**Unraid responsibilities:**
- Primary NFS storage for all k8s PVCs
- Plex media library (movies, TV, music)
- Runs Plex Media Server for local streaming and remote access
- Holds backups of app data and VMs (via k8s CronJobs or Velero)
- Holds images and ISOs for VM provisioning (e.g. k8s node OS images)

---

### Wireless Access Point : D-Link DIR-885L (OpenWrt)

| Field | Value |
|-------|-------|
| Mode | Access Point only : DHCP and routing disabled |
| Management IP | `10.0.10.40` |
| Uplink | Single trunk to CSS326 (tagged VLAN 10, 20, 30, 40, 50) |

**SSIDs:**

| SSID | VLAN | Notes |
|------|------|-------|
| `owl.red` | 20 : `private-net` | WPA3/WPA2, full trusted access |
| `silence of the lans` | 30 : `guest-net` | Open or simple PSK, captive portal enforced by OPNsense |
| `owl.red-iot` | 40 or 50 : `iot-no-inter` or `iot-with-inter` | WPA3/WPA2, IoT devices only |

---

### Kubernetes Cluster : k8s on Proxmox VMs

| Field | Value |
|-------|-------|
| Kubernetes distro | k8s (only supported distro in this repo) |
| Control plane nodes | 3 (HA quorum via k8s server/etcd) |
| Worker nodes | 1 |
| CNI | Flannel (VXLAN) |

**k8s VM resource profile (initial baseline):**

| Node Role | vCPU | Memory | Disk | Notes |
|-----------|------|--------|------|-------|
| Control plane (`cp1-3.k8s`) | 2 | 6 GiB | 60 GiB | Prioritize etcd stability and consistent headroom |
| Worker (`worker1.k8s`) | 4 | 8 GiB | 100 GiB | Primary app scheduling target |

Memory tuning rule: start with reserved memory (no overcommit), then adjust after workload telemetry is collected.

**Why 3 control plane nodes?**
- the split-brain scenario is the worst-case failure mode for a HA cluster. With 3 control plane nodes, the cluster can tolerate the failure of one node without losing quorum. With only 2 control plane nodes, the failure of one node would cause the cluster to lose quorum and become unavailable until the failed node is restored.

### Cluster Applications
| Application | Description |
|-------------|-------------|
| Traefik | Ingress controller for all cluster services, TLS termination with cert-manager |
| Service exposure strategy | Selected: MetalLB with explicit VIP assignment for ingress and selected services |
| cert-manager | Manages TLS certificates from Let's Encrypt via DNS-01 challenge |
| Rancher | Kubernetes management plane, deployed on k8s for high availability and manages the cluster itself |
| Flame | Lightweight app launcher dashboard candidate, deployed on k8s and managed via Fleet |
| Homepage | Feature-rich dashboard candidate with flexible widgets/layout, deployed on k8s and managed via Fleet |
| Homer | Static YAML-driven dashboard candidate with low operational overhead, deployed on k8s and managed via Fleet |
| Technitium DNS | Deployed on k8s cluster for high availability. Authoritative DNS server for `owl.red` domain. Records are Git-managed and reconciled via Fleet-managed sync job. DHCP remains on OPNsense in the initial build; Option 114 is delivered by OPNsense DHCP on guest VLAN. |
| Proxmox Datacenter Manager | Centralized management for multiple Proxmox hosts/clusters, deployed on k8s for high availability |
| Proxmox Backup Server | Backup target for k8s cluster state and VM backups |
| Plex Media Server | Placement pending final decision (`docs/decisions/002-plex-k8s-quicksync.md`): target is k8s on QuickSync-capable nodes; fallback is Unraid VM |
| qBittorrent | Used only to download linux ISOs of course; Pinned to unraid for best performance, fallback to k8s if needed |
| Arr suite (Sonarr, Radarr, Lidarr, Bazarr, Prowlarr, Soularr) | Media management for legally ripped TV, movies, music; Pinned to k8s for better integration with Plex and access to cert-manager TLS |
| slskd | Soulseek client for music discovery (free mixtapes only of course)|
| flaresolver | AI workloads, GPU passthrough planned for future |
| flarednsresolver | DNS resolver for flaresolver, also used as a Pi-hole replacement for network-wide ad blocking |
| Seer | Request website for Plex content ot to be added to the library, deployed on k8s for better integration with Plex and cert-manager TLS |
| Reclaimerr | Automatically delete media from Plex library based on custom rules (e.g. delete movies after 1 year, or TV episodes after 3 months), deployed on k8s for better integration with Plex and cert-manager TLS |
| speedtest-tracker | Track internet speed over time, deployed on k8s for better integration with cert-manager TLS and Traefik dashboard |
| Tautulli | Plex analytics and monitoring, deployed on k8s for better integration with Plex and cert-manager TLS |
| Librespeed | Speedtest server for LAN speed testing, deployed on k8s for better integration with cert-manager TLS and Traefik dashboard |

## Ingress & TLS : Traefik + cert-manager

**Load balancer strategy (initial):** MetalLB is active from baseline with VIP assignments from `10.0.10.200-250`.

**Service exposure model:** Traefik is exposed as a MetalLB `LoadBalancer` service (current VIP `10.0.10.201`). See `docs/decisions/004-loadbalancer-metallb-vs-servicelb.md`.

### Architecture

```
Client → Traefik
              ↓ TLS termination (wildcard *.owl.red cert)
              ↓ IngressRoute / Ingress annotations
         [Plex, qBit, Rancher, ...]
```

### cert-manager : Let's Encrypt via DNS-01

HTTP-01 challenge will not work for internal services (they are not reachable from the internet on port 80). DNS-01 must be used.

**DNS-01 flow:**
1. cert-manager requests a cert from Let's Encrypt
2. LE returns a DNS TXT record challenge (`_acme-challenge.owl.red`)
3. cert-manager creates the TXT record via the DNS provider API (Cloudflare recommended)
4. LE validates and issues the cert
5. cert-manager stores cert in a k8s `Secret`, auto-renews 30 days before expiry (every ~60 days)
- All VLAN clients receive `10.0.10.30` (Technitium cluster VIP) as their DNS server via DHCP
- Technitium runs as a StatefulSet on k8s with persistent storage (Unraid NFS); configuration is replicated and survives node failures

### UPS & Cluster Resilience

**Power & Failover Architecture:**

| Component | Power Source | Failover Strategy | Recovery Window |
|-----------|--------------|------|---|
| OPNsense (edge.pve), MikroTik Switch, Unraid (storage.pve), 1× k8s node | LX1500GU UPS | UPS runtime ~15–30 min; NUT on storage.pve triggers WoL to restart all PVE hosts | Automatic (WoL) + manual for persistent failures |
| Technitium (on k8s) | LX1500GU UPS | If UPS exhausted and cluster restarts, Technitium resumes from persistent storage (Unraid NFS). DNS may be unavailable for 2–5 min during cluster restart. | Graceful restart via NUT + k8s auto-recovery |
| k8s cluster (3 CP nodes + 1 worker) | Separate power (assumed on grid or separate UPS) | If one CP node loses power, cluster remains operational (quorum maintained with 3 nodes). Technitium pod reschedules to surviving nodes. | Quorum-based (no single-node SPOF). |

**Known Gap:** If all UPS-backed devices (edge.pve, storage.pve, switch, WAP, 1× k8s node) lose power simultaneously for > 30 min, Technitium will restart from storage. Cluster recovery time depends on storage availability and NUT completion.

**Recommendation:** Document recovery procedure: (1) UPS depletion -> cluster shuts down gracefully, (2) power restored -> NUT triggers WoL, (3) Technitium pod resumes on first available CP node, (4) DNS resolution resumes after pod recovery.

---

### Traefik

- Deployed via Helm (Rancher catalog or `helm install`)
- Wildcard TLS secret (`owl-red-wildcard-tls`) referenced in default TLS store
- All services exposed via `IngressRoute` CRDs : no cleartext HTTP outside the cluster
- Traefik dashboard accessible at `https://traefik.owl.red`
  - **Application layer protection (primary):** Dashboard middleware enforces `network-devices` VLAN (10.0.10.0/24) source authentication; unauthenticated requests from other VLANs are blocked by middleware
  - **Network layer protection (secondary):** OPNsense firewall can restrict dashboard port (9000) to VLAN 10 via firewall rule for defense-in-depth

---

## DHCP & Network Services Architecture

### DHCP Authority (Initial) : OPNsense

**Authority:** OPNsense is the authoritative DHCP server in the initial deployment for VLANs 20/30/40/50. VLAN 10 remains static-only.

**Resilience rationale:** This avoids coupling DHCP availability to the full k8s dependency chain during first rollout.

**DHCP scope configuration (on OPNsense initially):**

| VLAN | Subnet | DHCP Range | Gateway | DNS Servers | Notes |
|------|--------|------------|---------|-------------|-------|
| 10 | `10.0.10.0/24` | Static IPs only | `10.0.10.1` | `10.0.10.30` (Technitium cluster VIP) | No DHCP server; static assignments only |
| 20 | `10.0.20.0/24` | `10.0.20.100–254` | `10.0.20.1` | `10.0.10.30` | Trusted devices; full internet access |
| 30 | `10.0.30.0/24` | `10.0.30.100–254` | `10.0.30.1` | `10.0.10.30` | **Guest captive portal VLAN; see RFC 8910/8908 requirements below** |
| 40 | `10.0.40.0/24` | `10.0.40.100–254` | `10.0.40.1` | `10.0.10.30` | IoT with local-only network access (internet blocked) |
| 50 | `10.0.50.0/24` | `10.0.50.100–254` | `10.0.50.1` | `10.0.10.30` | IoT with internet access; no lateral movement to other VLANs |

### DNS Authority : Technitium on k8s

**Authority & High Availability:** Technitium DNS is deployed on the k8s cluster at service endpoint `10.0.10.30`.

**GitOps ownership model (selected):**
- Fleet is the reconciler for Kubernetes DNS manifests.
- The authoritative `owl.red` zone file is stored in Git (`gitops/technitium/dns-zone-configmap.yaml`).
- A Fleet-managed CronJob imports the zone into Technitium on schedule to correct drift.

**Failure domain:** DNS depends on k8s health and storage availability. This is acceptable now because DHCP remains on OPNsense during initial rollout.

**Future option (deferred):** DHCP relay to Technitium can be evaluated later after platform stability is proven.

### Guest VLAN (30) : Captive Portal + Modern RFC 8910/8908 Support

**Captive Portal Zone Configuration (OPNsense):**
- Enabled: Yes
- Interface: Tagged VLAN 30 on trunk (LAN port 1)
- Authentication: Splash-only (no login required for basic connectivity; future voucher/RADIUS capable)
- Idle timeout: 0 minutes (no forced disconnect)
- Hard timeout: 0 minutes (no forced disconnect)
- SSL certificate: Valid public certificate (required for RFC 8910/8908 support)
- Hostname: `https://captive.owl.red` (must resolve and be reachable from guest VLAN)
- Custom template: TBD (branding and terms)

**DHCP Option 114 (RFC 8910 Captive Portal API):**

Configured on OPNsense DHCP (VLAN 30 scope):
```
Option 114 (String) = https://captive.owl.red:8000/api/captiveportal/access/api
```

**Fallback Access (IP-based):** Clients can also access the portal directly via OPNsense IP if DNS fails:
```
https://10.0.30.1:8000/api/captiveportal/access/api
```
This ensures guest clients can always reach the portal even if Technitium DNS is temporarily unavailable during cluster transitions.

**Why RFC 8910/8908:** Modern clients (iOS 14+, Android 12+, Windows 11+) use standardized captive portal detection via DHCP Option 114 and the Captive Portal API endpoint. Without this, clients may fail to detect the portal or show confusing connection warnings. This is the recommended approach over HTTP 302 redirection for user experience and reliability.

**Firewall Rule Ordering (OPNsense) for Guest VLAN:**

When the captive portal is enabled, OPNsense automatically installs firewall rules with the following implicit precedence (apply-first to apply-last):

1. **DNS passthrough (auto-generated):** Allow DNS (port 53) from guest VLAN to OPNsense (This Firewall)
2. **Captive portal HTTP/HTTPS redirect (auto-generated):** Redirect all TCP/80 and TCP/443 from unauthenticated guests to localhost ports 9000 and 8000 (zone 0)
3. **Captive portal zone alias (auto-generated):** Authenticated guest alias (`__captiveportal_zone_0`) is maintained in-kernel
4. **Explicit allow (user-defined):** Allow all traffic from authenticated guests to any destination (this is where internet access is permitted)
5. **Default deny (auto-generated):** Block all traffic from unauthenticated guests (except DNS and portal redirects)

**Inter-VLAN Deny Rules (OPNsense):** Explicit firewall rules block guest VLAN traffic to trusted/internal VLANs **before** the allow-internet rule:

```
Rule 1: Block | Guest VLAN (10.0.30.0/24) | -> | Network Devices VLAN (10.0.10.0/24) | (any protocol)
Rule 2: Block | Guest VLAN (10.0.30.0/24) | -> | Private VLAN (10.0.20.0/24) | (any protocol)
Rule 3: Block | Guest VLAN (10.0.30.0/24) | -> | IoT No Internet (10.0.40.0/24) | (any protocol)
Rule 4: Block | Guest VLAN (10.0.30.0/24) | -> | IoT With Internet (10.0.50.0/24) | (any protocol)
Rule 5: Block | Guest VLAN (10.0.30.0/24) | -> | OPNsense (This Firewall) except DNS/portal | (all protocols)
Rule 6: Block | Guest VLAN (10.0.30.0/24) | -> | Multicast (224.0.0.0/4) | (any protocol) | (prevents mDNS/SSDP service discovery on other VLANs)
```

These rules must be applied **before** any catch-all allow rules for guest internet access. Multicast blocking prevents guests from enumerating services on other VLANs via mDNS or SSDP.

### DNS / DHCP Coupling

- OPNsense provides DHCP in the initial build and advertises Technitium (`10.0.10.30`) as client DNS
- Technitium provides DNS authority and recursive resolution for clients
- Recursive DNS queries from clients resolve via Technitium; no client queries go to external resolvers directly
- All VLAN clients receive `10.0.10.30` (Technitium) as their DNS server via DHCP

---