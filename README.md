# owl.red : Home Network Infrastructure

> **This repo is the single source of truth for the `owl.red` network.**  
> All changes network, infrastructure, k8s, config : are made here first, then applied.  
> No configuration is managed outside this repo except for initial hardware bootstrap.

## Quick Reference

### VLANs

| VLAN | Name | Subnet | Gateway | DHCP | Purpose |
|------|------|--------|---------|------|---------|
| 10 | `network-devices` | `10.0.10.0/24` | `10.0.10.1` | Technitium `10.0.10.100-199` | Infrastructure management; known devices use MAC reservations |
| 20 | `private-net` | `10.0.20.0/24` | `10.0.20.1` | Technitium `10.0.20.100-254` | Trusted wired and WiFi clients |
| 30 | `guest-net` | `10.0.30.0/24` | `10.0.30.1` | Technitium `10.0.30.100-254` | Guest WiFi with captive portal |
| 40 | `iot-no-inter` | `10.0.40.0/24` | `10.0.40.1` | Technitium `10.0.40.100-254` | IoT with local-only access |
| 50 | `iot-with-inter` | `10.0.50.0/24` | `10.0.50.1` | Technitium `10.0.50.100-254` | IoT with internet, no lateral movement |

### VLAN 10 Infrastructure Hosts

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.10.1` | `edge.owl.red` | OPNsense VM | VLAN 10 gateway, firewall, captive portal |
| `10.0.10.2` | `switch.owl.red` | MikroTik CSS326 | Switch management |
| `10.0.10.3` | `edge.pve.owl.red` | CSE-523L Proxmox | Router node PVE host |
| `10.0.10.4` | `storage.pve.owl.red` | RSV-L4500U Proxmox | Storage node PVE host |
| `10.0.10.5` | `nas.owl.red` | Unraid | NFS/SMB storage, Plex media server |
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
| `10.0.10.31` | `pdm.owl.red` | PDM VM on storage.pve | Proxmox Datacenter Manager |
| `10.0.10.33` | `pbs.owl.red` | PBS VM on storage.pve | Proxmox Backup Server |
| `10.0.10.40` | `ap.owl.red` | DIR-885L OpenWrt | WAP management |
### VLAN 50 IoT Hosts (internet permitted)

| IP | Hostname | Device | Purpose |
|----|----------|--------|---------|
| `10.0.50.10` | `ecobee.owl.red` | Ecobee thermostat | Smart thermostat — needs cloud API access |
### Service VIPs and Pools

| IP / Range | Name | Backing Service | Notes |
|------------|------|-----------------|-------|
| `10.0.10.30` | `ns1.owl.red` | Technitium LXC on edge.pve | DNS service endpoint |
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
| `SW02` | `PP25` | `cp1.pve.owl.red` | VLAN 10 access | Active |
| `SW04` | `PP26` | `cp2.pve.owl.red` | VLAN 10 access | Active |
| `SW06` | `PP27` | `cp3.pve.owl.red` | VLAN 10 access | Active |
| `SW08` | `PP28` | `worker1.pve.owl.red` | VLAN 10 access | Active |
| `SW10` | `PP29` | `storage.pve.owl.red` | VLAN 10 access | Active, obnic0 |
| `SW12` | `PP30` | `storage.pve.owl.red` | VLAN 10 access | Active, obnic1 (bond standby) |
| `SW14` | `PP31` | `ipmi.storage.owl.red` | VLAN 10 access | Active |
| `SW16` | `PP32` | `pdu.owl.red` | VLAN 10 access | Active |
| `SW18` | `PP33` | `ap.owl.red` | 802.1Q trunk `10/20/30/40/50` | Active, 1G |
| `SW22` | `PP35` | `Network Cabinet` | 802.1Q trunk `10/20/30/40/50` | Active |
| `SW24` | `PP36` | `edge.pve.owl.red` eth0 | VLAN 10 management | Active |
| `SFP+1` | `PP16 to PP37` | `edge.owl.red` SFP+ passthrough | 10G OPNsense uplink path | Active |
| `SFP+2` | `PP39` | `nas.owl.red` SFP+ (Unraid) | 10G storage uplink | Active |

---

## Infrastructure Inventory

### Firewall / Router : Supermicro CSE-523L-505B

| Field | Value |
|-------|-------|
| Chassis | Supermicro CSE-523L-505B (2U) |
| CPU | Intel i3 8300 |
| Motherboard | Asus PRIME B365M |
| RAM | 32 GB (4 × 8 GB) |
| Hypervisor | Proxmox VE — `edge.pve.owl.red` `10.0.10.3` |
| OPNsense VM | `edge.owl.red` `10.0.10.1` — pinned; PCIe NIC passthrough, do not migrate |

| Interface | Hardware | MAC | Role | Speed |
|-----------|----------|-----|------|-------|
| `eth0` | onboard NIC | `3c:7c:3f:25:50:6a` | Proxmox management, VLAN 10 → SW24 | 1G |
| `igb0` | passthrough Intel i226-V | `e0:d4:e8:ef:2b:f2` | WAN uplink | 2.5G |
| `iX10` | Intel X710 SFP+ port 0 | `6c:fe:54:70:08:30` | Spare / future path | 10G |
| `iX11` | Intel X710 SFP+ port 1 | `6c:fe:54:70:08:31` | 10G LAN trunk → SW SFP+1 | 10G |

### Switch : MikroTik CSS326-24G-2S+RM

| Field | Value |
|-------|-------|
| Model | MikroTik CSS326-24G-2S+RM |
| OS | SwOS `2.18` |
| Management IP | `10.0.10.2` (`switch.owl.red`) |
| Management MAC | `48:8f:5a:0c:d1:82` |
| VLAN mode | 802.1Q — access + trunk by port |
| IaC source | `ansible/switch_configs/css326.yml` |

### Storage Node : RSV-L4500U / Supermicro X10SRi-F

| Field | Value | Info |
|-------|-------|------|
| Chassis | RSV-L4500U (4U) | |
| Platform | Supermicro X10SRi-F | LGA 2011 / Xeon |
| RAM | 32 GB | 4 × 8 GB |
| Hypervisor | Proxmox VE | `storage.pve.owl.red` — `10.0.10.4` (bond0 via obnic0+obnic1) |
| Unraid | bare metal | `nas.owl.red` — `10.0.10.5`; VM migration planned |
| IPMI | `10.0.10.6` | Always-on BMC |
| PDM | `10.0.10.31` | Proxmox Datacenter Manager workload |
| PBS | `10.0.10.33` | Proxmox Backup Server workload |
| Passthrough NIC | Intel X710 2-port SFP+ | Passed to Unraid → SW SFP+2 |
| Passthrough HBA 1 | LSI 9207-8i | Passed to Unraid for direct disk access |
| Passthrough HBA 2 | LSI 9207-8i | Passed to Unraid for direct disk access |
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
| Uplink | `SW18` via `PP33` — 802.1Q trunk VLANs `10/20/30/40/50`, 1G |

| SSID | VLAN | Notes |
|------|------|-------|
| `owl.red` | `20` | Trusted clients |
| `silence of the lans` | `30` | Guest clients behind captive portal |
| `owl.red-iot` | `40` or `50` | IoT segment depending device policy |

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
| Distribution | Talos Linux + vanilla Kubernetes | Current repo standard |
| Control plane nodes | `3` | Quorum survives one control-plane failure |
| Worker nodes | `1` | General workload capacity |
| CNI | Flannel (VXLAN) | Current network overlay |
| Placement policy | Availability first | Critical workloads can land on all nodes |
| Control-plane fallback | Enabled | Via tolerations and bounded requests |
| Ingress strategy | Traefik + MetalLB | Shared ingress VIP on VLAN 10 |
| DNS strategy | Technitium LXC on `edge.pve` | Zone sync job runs on k8s; LXC serves DNS/DHCP for all VLANs |
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
| DHCP (All VLANs) | Technitium | Multi-homed IPs | Native L2 broadcast via LXC 5-NIC config |
| Authoritative DNS | Technitium | Multi-homed IPs | Hosted in LXC on edge.pve, Fleet-managed zone sync |
| Ingress and TLS | Traefik + cert-manager | `10.0.10.201` | Internal ingress VIP for cluster web services; not a public origin endpoint |
| Guest captive portal | OPNsense | `https://captive.owl.red` | RFC 8910 / 8908 path |

### DHCP and DNS Plan

| VLAN | DHCP Authority | Range | Router | DNS | Notes |
|------|----------------|-------|--------|-----|-------|
| `10` | Technitium | `10.0.10.100-199` | `10.0.10.1` | `10.0.10.30` | Known infrastructure devices use reservations |
| `20` | Technitium | `10.0.20.100-254` | `10.0.20.1` | `10.0.20.30` | Trusted wired and WiFi clients |
| `30` | Technitium | `10.0.30.100-254` | `10.0.30.1` | `10.0.30.30` | Guest scope with captive portal signaling |
| `40` | Technitium | `10.0.40.100-254` | `10.0.40.1` | `10.0.40.30` | IoT local-only policy |
| `50` | Technitium | `10.0.50.100-254` | `10.0.50.1` | `10.0.50.30` | IoT with internet, no lateral movement |

Technitium is authoritative for `owl.red` and runs as a multi-homed LXC on `edge.pve` with native interfaces on all VLANs. DNS records are Git-managed and reconciled by a Fleet-managed sync job. If Technitium is not serving the zone authoritatively, clients can fall through to public DNS and internal service names such as `dns.owl.red` or `rancher.owl.red` will resolve incorrectly.

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
| Technitium LXC | LX1500GU UPS | Starts automatically with `edge.pve` | DNS and DHCP are available immediately |
| Remaining k8s nodes | Separate power path | Quorum-based cluster survival | One control-plane loss is tolerable |

Known gap: if all UPS-backed infrastructure is down for longer than available runtime, DNS and dependent services recover only after storage and cluster services return.

---