# owl.red : Home Network Infrastructure

> **This repo is the single source of truth for the `owl.red` network.**  
> All changes network, infrastructure, k8s, config : are made here first, then applied.  
> No configuration is managed outside this repo except for initial hardware bootstrap.

## Quick Reference

### VLANs

| VLAN | Name | Subnet | Gateway | DHCP | Purpose |
|------|------|--------|---------|------|---------|
| 10 | `network-devices` | `10.0.10.0/24` | `10.0.10.1` | Technitium `10.0.10.100-199` | Infrastructure management; known devices use MAC reservations |
| 20 | `private-net` | `10.0.20.0/24` | `10.0.20.1` | OPNsense `10.0.20.100-254` | Trusted wired and WiFi clients |
| 30 | `guest-net` | `10.0.30.0/24` | `10.0.30.1` | OPNsense `10.0.30.100-254` | Guest WiFi with captive portal |
| 40 | `iot-no-inter` | `10.0.40.0/24` | `10.0.40.1` | OPNsense `10.0.40.100-254` | IoT with local-only access |
| 50 | `iot-with-inter` | `10.0.50.0/24` | `10.0.50.1` | OPNsense `10.0.50.100-254` | IoT with internet, no lateral movement |

### VLAN 10 Infrastructure Hosts

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.10.1` | `edge.owl.red` | OPNsense VM | VLAN 10 gateway, firewall, captive portal |
| `10.0.10.2` | `switch.owl.red` | MikroTik CSS326 | Switch management |
| `10.0.10.3` | `edge.pve.owl.red` | CSE-523L Proxmox | Router node PVE host |
| `10.0.10.4` | `storage.pve.owl.red` | RSV-L4500U Proxmox | Storage node PVE host |
| `10.0.10.5` | `nas.owl.red` | Unraid | NFS/SMB storage, Plex media |
| `10.0.10.6` | `ipmi.storage.owl.red` | X10SRi-F IPMI/BMC | Remote management for storage node |
| `10.0.10.7` | `pdu.owl.red` | APC AP7900B PDU | Rack PDU management |
| `10.0.10.11` | `cp1.pve.owl.red` | ThinkCentre M73 #1 | PVE host for k8s control plane |
| `10.0.10.12` | `cp2.pve.owl.red` | ThinkCentre M73 #2 | PVE host for k8s control plane |
| `10.0.10.13` | `cp3.pve.owl.red` | ThinkCentre M73 #3 | PVE host for k8s control plane |
| `10.0.10.14` | `worker1.pve.owl.red` | ThinkCentre M73 #4 | PVE host for k8s worker |
| `10.0.10.21` | `cp1.k8s.owl.red` | Talos VM on cp1.pve | k8s control plane node |
| `10.0.10.22` | `cp2.k8s.owl.red` | Talos VM on cp2.pve | k8s control plane node |
| `10.0.10.23` | `cp3.k8s.owl.red` | Talos VM on cp3.pve | k8s control plane node |
| `10.0.10.24` | `worker1.k8s.owl.red` | Talos VM on worker1.pve | k8s worker node |
| `10.0.10.31` | `pdm.owl.red` | PDM workload | Proxmox Datacenter Manager |
| `10.0.10.33` | `pbs.owl.red` | PBS VM | Proxmox Backup Server |
| `10.0.10.40` | `ap.owl.red` | DIR-885L OpenWrt | WAP management |

### Service VIPs and Pools

| IP / Range | Name | Backing Service | Notes |
|------------|------|-----------------|-------|
| `10.0.10.30` | `ns1.owl.red` | Technitium DNS on k8s | DNS service endpoint |
| `10.0.10.201` | `rancher.owl.red`, `dns.owl.red`, `home.owl.red`, `traefik.owl.red` | Traefik + MetalLB | Shared internal ingress VIP for Rancher, Technitium web, Homepage, and Traefik |
| `10.0.10.200-250` | MetalLB VIP pool | Kubernetes LoadBalancer pool | Active for ingress and future services |

Access rule: these service VIPs are intended for LAN clients. They only work when the client can route to VLAN 10 and resolves `owl.red` names from internal Technitium instead of falling through to public DNS.

Router placement rule: `edge.owl.red` is pinned to `edge.pve.owl.red` because it uses physical PCIe NIC passthrough (`hostpci`). Do not plan routine live or offline migration of this VM.

---

## Front Patching

### Cable Standard

- `BLUE` = infrastructure uplinks and trunks
- `PURPLE` = endpoint and room-drop patching
- `AQUA` = SFP+ DAC links

### Front Patch Summary

CSS326 front numbering is staggered by column: top row is even ports, bottom row is odd ports.

| Switch Port | Patch | Target | Role / VLANs | Notes |
|-------------|-------|--------|--------------|-------|
| `SW01` | `PP25` | `cp1.pve.owl.red` | VLAN 10 access | Active |
| `SW02` | `PP26` | `cp2.pve.owl.red` | VLAN 10 access | Active |
| `SW03` | `PP27` | `cp3.pve.owl.red` | VLAN 10 access | Active |
| `SW04` | `PP28` | `worker1.pve.owl.red` | VLAN 10 access | Active |
| `SW05` | direct | `edge.pve.owl.red` | VLAN 10 access | Active |
| `SW06` | `PP30` | `storage.pve.owl.red` | VLAN 10 access | Active |
| `SW07` | `PP31` | `ipmi.storage.owl.red` | VLAN 10 access | Active |
| `SW08` | `PP29` | reserved storage patch | VLAN 10 access | Reserved |
| `SW09` | `PP32` | `pdu.owl.red` | VLAN 10 access | Active |
| `SW10` | direct | service laptop / KVM | Break-glass local access | Active |
| `SW11-SW16` | unpatched | private-net drops | VLAN 20 access | Reserved |
| `SW17-SW19` | unpatched | IoT drops | VLAN 40 / 50 access | Reserved |
| `SW20` and `SW22` | unpatched | guest drops | VLAN 30 access | Reserved |
| `SW21` | `PP23` | `ap.owl.red` | 802.1Q trunk `10/20/30/40/50` | Active, 1G |
| `SW23` | direct | `edge.owl.red` `R1` | Primary LAN trunk `10/20/30/40/50` | Active, 1G |
| `SW24` | direct | `edge.owl.red` `R2` | Fallback LAN trunk | Disabled by default |
| `SFP+1` | keystone / DAC | future OPNsense SFP+ | Future 10G trunk | Planned |
| `SFP+2` | keystone / DAC | future storage 10G | Future storage uplink | Planned |

---

## Infrastructure Inventory

### Firewall / Router : Supermicro CSE-523L-505B

| Field | Value | Info |
|-------|-------|------|
| Chassis | Supermicro CSE-523L-505B (2U) | Router chassis |
| CPU | Intel i3 8300 | Dedicated to `edge.pve` / OPNsense path |
| Motherboard | Asus PRIME B365M | Current platform |
| RAM | 32 GB | `4 x 8 GB` |
| Hypervisor | Proxmox VE | Hosts OPNsense VM |
| OPNsense VM | `edge.owl.red` | Default gateway for VLANs `10/20/30/40/50` |
| Proxmox host IP | `10.0.10.3` | `edge.pve.owl.red` |
| OPNsense gateway IPs | `10.0.10.1`, `10.0.20.1`, `10.0.30.1`, `10.0.40.1`, `10.0.50.1` | Per-VLAN gateways |
| Management NIC | Onboard GbE | `3c:7c:3f:25:50:6a`, VLAN 10 untagged |
| Passthrough NIC | 4-port Intel I340-T4 | Passed directly to OPNsense |
| Future passthrough NIC | 2-port SFP+ | Planned 10G trunk / future uplink path |

| Interface | Hardware | Role | Status |
|-----------|----------|------|--------|
| `eth0` | onboard NIC `3c:7c:3f:25:50:6a` | Proxmox management on VLAN 10 | Active |
| `R0 / igb0` | I340-T4 port 0 `90:e2:ba:0c:44:94` | WAN uplink | Active |
| `R1 / igb1` | I340-T4 port 1 `90:e2:ba:0c:44:95` | Primary LAN trunk to `SW23` | Active |
| `R2 / igb2` | I340-T4 port 2 `90:e2:ba:0c:44:96` | Fallback management / LAN path | Reserved |
| `R3 / igb3` | I340-T4 port 3 `90:e2:ba:0c:44:97` | Future DMZ / WAN2 | Reserved |
| `SFP+0` | future 2-port SFP+ NIC | Future 10G LAN trunk | Planned |
| `SFP+1` | future 2-port SFP+ NIC | Future WAN or storage path | Planned |

Trunk migration plan: keep the active 1G trunk on `R1` until the SFP+ path is validated end to end, then cut over during a maintenance window.

### Switch : MikroTik CSS326-24G-2S+RM

| Field | Value | Info |
|-------|-------|------|
| Type | Layer 2 managed switch | No routing |
| OS | SwOS | Current version observed: `2.18` |
| Ports | `24 x GbE + 2 x SFP+` | CSS326-24G-2S+RM |
| Management IP | `10.0.10.2` | `switch.owl.red` |
| VLAN mode | 802.1Q | Access + trunk roles by port |
| Primary trunks | `SW21`, `SW23`, `SW24` | AP uplink, active router trunk, fallback router trunk |
| Future trunks | `SFP+1`, `SFP+2` | Planned 10G expansion |
| IaC source | `ansible/switch_configs/css326.yml` | Applied via Ansible playbooks |

### Storage Node : RSV-L4500U / Supermicro X10SRi-F

| Field | Value | Info |
|-------|-------|------|
| Chassis | RSV-L4500U (4U) | Storage / virtualization chassis |
| Platform | Supermicro X10SRi-F | LGA 2011 / Xeon platform |
| RAM | 32 GB | `4 x 8 GB` |
| Hypervisor | Proxmox VE | `storage.pve.owl.red` |
| Proxmox host IP | `10.0.10.4` | Planned management on onboard NIC2 |
| Unraid IP | `10.0.10.5` | Bare metal today, VM target later |
| IPMI | `10.0.10.6` | Dedicated BMC, always-on management |
| PDM | `10.0.10.31` | Proxmox Datacenter Manager workload |
| PBS | `10.0.10.33` | Proxmox Backup Server workload |
| Onboard NIC 1 | `ac:1f:6b:47:87:f0` | Currently used by Unraid |
| Onboard NIC 2 | `ac:1f:6b:47:87:f1` | Planned Proxmox management NIC |
| BMC MAC | `ac:1f:6b:4b:b5:e7` | Dedicated IPMI interface |
| Passthrough GbE NIC | 4-port PCIe GbE | Passed to Unraid for storage traffic |
| Future passthrough NIC | 2-port PCIe SFP+ | Planned storage / high-speed uplink path |
| Future GPU | GTX 1060 or 1660 6 GB | For AI / transcoding workloads |
| Primary responsibilities | Unraid storage, Plex media, backups, ISO/image staging | NFS, SMB, media, backup path |

### Wireless Access Point : D-Link DIR-885L (OpenWrt)

| Field | Value | Info |
|-------|-------|------|
| Role | Access point only | No routing or DHCP |
| Management IP | `10.0.10.40` | VLAN 10 management |
| Uplink | `SW21` | Tagged trunk for VLANs `10/20/30/40/50` |
| Link state | 1G | Verified on switch |

| SSID | VLAN | Notes |
|------|------|-------|
| `owl.red` | `20` | Trusted clients |
| `silence of the lans` | `30` | Guest clients behind captive portal |
| `owl.red-iot` | `40` or `50` | IoT segment depending device policy |

### Kubernetes Cluster : Talos VMs on Proxmox

| Field | Value | Info |
|-------|-------|------|
| Distribution | Talos Linux + vanilla Kubernetes | Current repo standard |
| Control plane nodes | `3` | Quorum survives one control-plane failure |
| Worker nodes | `1` | General workload capacity |
| CNI | Flannel (VXLAN) | Current network overlay |
| Placement policy | Availability first | Critical workloads can land on all nodes |
| Control-plane fallback | Enabled | Via tolerations and bounded requests |
| Ingress strategy | Traefik + MetalLB | Shared ingress VIP on VLAN 10 |
| DNS strategy | Technitium on k8s | Authoritative DNS plus VLAN 10 DHCP reservations |
| Replica policy | Critical services spread across nodes | Technitium remains single-replica until shared-safe HA exists |

| Node Role | vCPU | Memory | Disk | Notes |
|-----------|------|--------|------|-------|
| Control plane (`cp1-3.k8s`) | `2` | `6 GiB` | `60 GiB` | Prioritize etcd stability |
| Worker (`worker1.k8s`) | `4` | `8 GiB` | `100 GiB` | General workload capacity |

| Workload Group | Services | Placement / Notes |
|----------------|----------|-------------------|
| Ingress and PKI | Traefik, cert-manager | MetalLB-exposed ingress, wildcard TLS via DNS-01 |
| Platform control | Rancher, Homepage | Cluster management and operator dashboard |
| DNS | Technitium DNS, zone sync job | Authoritative `owl.red` DNS, VLAN 10 DHCP reservations |
| Media and apps | Plex target, Arr stack, qBittorrent, slskd, Seer, Tautulli, Reclaimerr | Mixed k8s and media-integrated workloads |
| Utility services | speedtest-tracker, Librespeed, flarednsresolver | Internal utility and observability services |
| Future / specialized | flaresolver, GPU-backed workloads | Planned once GPU path is ready |

---

## Core Services and Network Behavior

### Service Authority Summary

| Function | Primary Service | Endpoint | Notes |
|----------|-----------------|----------|-------|
| Routing and firewall | OPNsense | `10.0.10.1` and per-VLAN gateways | Default gateway and policy engine |
| VLAN 10 DHCP | Technitium | `ns1.owl.red` / `10.0.10.30` | Scope `vlan10-network-devices`, pool `10.0.10.100-199` |
| VLAN 20/30/40/50 DHCP | OPNsense | Per-VLAN gateway | Guest VLAN also carries Option 114 |
| Authoritative DNS | Technitium | `10.0.10.30` | Hosted on k8s, Fleet-managed zone sync |
| Ingress and TLS | Traefik + cert-manager | `10.0.10.201` | Internal ingress VIP for cluster web services; not a public origin endpoint |
| Guest captive portal | OPNsense | `https://captive.owl.red` | RFC 8910 / 8908 path |

### DHCP and DNS Plan

| VLAN | DHCP Authority | Range | Router | DNS | Notes |
|------|----------------|-------|--------|-----|-------|
| `10` | Technitium | `10.0.10.100-199` | `10.0.10.1` | `10.0.10.30` | Known infrastructure devices use reservations |
| `20` | OPNsense | `10.0.20.100-254` | `10.0.20.1` | `10.0.10.30` | Trusted wired and WiFi clients |
| `30` | OPNsense | `10.0.30.100-254` | `10.0.30.1` | `10.0.10.30` | Guest scope with captive portal signaling |
| `40` | OPNsense | `10.0.40.100-254` | `10.0.40.1` | `10.0.10.30` | IoT local-only policy |
| `50` | OPNsense | `10.0.50.100-254` | `10.0.50.1` | `10.0.10.30` | IoT with internet, no lateral movement |

Technitium is authoritative for `owl.red` and runs as a StatefulSet on k8s with persistent storage. DNS records are Git-managed and reconciled by a Fleet-managed sync job. If Technitium is not serving the zone authoritatively, clients can fall through to public DNS and internal service names such as `dns.owl.red` or `rancher.owl.red` will resolve incorrectly.

### Traefik and TLS

- Traefik is exposed as a MetalLB `LoadBalancer` service on `10.0.10.201` for LAN clients.
- `dns.owl.red`, `rancher.owl.red`, `home.owl.red`, and `traefik.owl.red` are expected to resolve internally to `10.0.10.201`.
- cert-manager issues wildcard certificates using DNS-01 because internal services are not reachable for HTTP-01.
- Traefik dashboard access is intended to remain limited to VLAN 10, with middleware as the primary control and OPNsense rules as defense in depth.

### Cluster Hostname Troubleshooting

- If `curl https://dns.owl.red` or `curl https://rancher.owl.red` fails, check name resolution first. These hostnames should resolve to `10.0.10.201` for LAN clients.
- If `nslookup` or `Resolve-DnsName` returns a public IP instead of `10.0.10.201`, the client is not using healthy internal Technitium answers for `owl.red`.
- `10.0.10.30` is the DNS service VIP, not the Traefik web VIP. `ping` and HTTP checks against `10.0.10.30` are not valid tests for `dns.owl.red`.
- Direct DNS checks should be done against Technitium, for example: `Resolve-DnsName dns.owl.red -Server 10.0.10.30` and `Resolve-DnsName rancher.owl.red -Server 10.0.10.30`.
- If Technitium answers with a public IP for internal names, fix the authoritative zone path first; ingress hostnames behind Traefik will not work until internal DNS returns the correct VIP.

### Guest VLAN Captive Portal

| Setting | Value | Notes |
|---------|-------|-------|
| Zone | VLAN 30 on LAN trunk | OPNsense captive portal zone |
| Authentication | Splash-only | Future voucher or RADIUS possible |
| Idle / hard timeout | `0 / 0` | No forced disconnect |
| Portal hostname | `https://captive.owl.red` | Must resolve and be reachable from guest VLAN |
| DHCP Option 114 | `https://captive.owl.red:8000/api/captiveportal/access/api` | RFC 8910 captive portal API |
| Fallback endpoint | `https://10.0.30.1:8000/api/captiveportal/access/api` | Direct IP path if DNS is down |

Firewall behavior for the guest VLAN should remain ordered as follows:
1. Allow DNS to OPNsense.
2. Redirect guest HTTP and HTTPS to the captive portal.
3. Maintain the authenticated captive portal alias.
4. Allow authenticated guests to reach the internet.
5. Deny unauthenticated guest traffic.

Guest isolation rules should explicitly block access from VLAN 30 to VLANs 10, 20, 40, and 50, block direct access to OPNsense except DNS and portal functions, and block multicast discovery traffic (`224.0.0.0/4`).

### Power and Recovery

| Component | Power Source | Recovery Model | Notes |
|-----------|--------------|----------------|-------|
| OPNsense, switch, storage, one k8s node | LX1500GU UPS | NUT-triggered WoL and staged recovery | Core infra path |
| Technitium on k8s | UPS-backed storage dependency | Restarts from persistent storage after cluster recovery | Short DNS outage acceptable during restart window |
| Remaining k8s nodes | Separate power path | Quorum-based cluster survival | One control-plane loss is tolerable |

Known gap: if all UPS-backed infrastructure is down for longer than available runtime, DNS and dependent services recover only after storage and cluster services return.

---