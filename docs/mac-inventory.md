# MAC Inventory — owl.red

Personal reference. Not machine-consumed. Last updated: 2026-06-09.

---

## Infrastructure — VLAN 10

### Firewall / Router (CSE-523L / edge.pve)

| MAC | Interface | Role | IP |
|-----|-----------|------|----|
| `3c:7c:3f:25:50:6a` | onboard eth0 | Proxmox management, VLAN 10 | `10.0.10.3` |
| `e0:d4:e8:ef:2b:f2` | PCIe Intel i226-V (igb0) | WAN uplink → OPNsense passthrough | WAN |
| `6c:fe:54:70:08:30` | Intel X710 SFP+ port 0 (iX10) | Spare / future path | — |
| `6c:fe:54:70:08:31` | Intel X710 SFP+ port 1 (iX11) | 10G LAN trunk → SW SFP+1 | — |
| `90:e2:ba:0c:44:95` | OPNsense VM vNIC (VMID 100) | VLAN 10 gateway | `10.0.10.1` |
| `bc:24:11:d4:5b:7b` | Technitium LXC vNIC (VMID 200) | DNS/DHCP service | `10.0.10.30` |
| `bc:24:11:7d:37:72` | PDM LXC vNIC (VMID 231) | Proxmox Datacenter Manager | `10.0.10.31` |
| TBD | PBS VM vNIC | Proxmox Backup Server | `10.0.10.33` |

### Switch (MikroTik CSS326)

| MAC | Interface | Role | IP |
|-----|-----------|------|----|
| `48:8f:5a:0c:d1:82` | management | SwOS management | `10.0.10.2` |

### Storage Node (RSV-L4500U / storage.pve + nas)

| MAC | Interface | Role | IP |
|-----|-----------|------|----|
| `ac:1f:6b:47:87:f0` | onboard Intel I350 obnic0 | Proxmox bond0 active → SW10 | — |
| `ac:1f:6b:47:87:f1` | onboard Intel I350 obnic1 | Proxmox bond0 standby → SW12 | `10.0.10.4` |
| `ac:1f:6b:4b:b5:e7` | ASPEED AST2400 BMC | IPMI → SW14 | `10.0.10.6` |
| `f8:f2:1e:48:91:40` | Intel 82599ES SFP+ iX10 | Unraid passthrough → SW SFP+2 | `10.0.10.5` |
| `f8:f2:1e:48:91:41` | Intel 82599ES SFP+ iX11 | Unraid passthrough, spare | — |

### PDU

| MAC | Interface | Role | IP |
|-----|-----------|------|----|
| `00:c0:b7:df:67:08` | NMC2 embedded (0G-1238) | APC AP7900B management | `10.0.10.9` |

### Wireless AP (DIR-885L / OpenWrt)

| MAC | Interface | Role | IP |
|-----|-----------|------|----|
| `10:be:f5:d9:1e:37` | management | WAP management | `10.0.10.40` |

### Compute Nodes — PVE hosts (ThinkCentre M73 ×4)

| MAC | Host | Role | IP |
|-----|------|------|----|
| `00:23:24:7a:87:96` | cp1.pve | physical NIC / vmbr0 | `10.0.10.11` |
| `00:23:24:70:ef:b0` | cp2.pve | physical NIC / vmbr0 | `10.0.10.12` |
| `00:23:24:6f:c2:4b` | cp3.pve | physical NIC / vmbr0 | `10.0.10.13` |
| `00:23:24:6b:dc:f9` | worker1.pve | physical NIC / vmbr0 | `10.0.10.14` |

### Compute Nodes — Talos VMs

| MAC | VM | Role | IP |
|-----|-----|------|----|
| `02:00:00:00:00:21` | cp1.k8s (VMID 601) | k8s control plane | `10.0.10.21` |
| `02:00:00:00:00:22` | cp2.k8s (VMID 602) | k8s control plane | `10.0.10.22` |
| `02:00:00:00:00:23` | cp3.k8s (VMID 603) | k8s control plane | `10.0.10.23` |
| `02:00:00:00:00:24` | worker1.k8s (VMID 604) | k8s worker | `10.0.10.24` |

---

## Personal Devices — VLAN 20 (target)

| MAC | Device | Notes | Current IP |
|-----|--------|-------|------------|
| `5c:87:9c:fa:10:f4` | w1ngz workstation (Intel WiFi) | Main workstation | 10.0.10.188 (wrong VLAN) |
| `a0:4f:85:f6:ec:76` | paranoid-android (LG phone) | Personal phone | 10.0.10.166 (wrong VLAN) |
| `bc:cd:99:2b:3c:a7` | work laptop (KAM1WL102916) | Intel WiFi; dynamic only | 10.0.203.172 (wrong subnet?) |
| `8c:04:ba:80:b9:a8` | TBD (Dell device) | Unknown Dell; seen on VLAN 10 | 10.0.10.139 (wrong VLAN) |

---

## IoT / Smart Home

| MAC | Device | Target VLAN | Notes | Current IP |
|-----|--------|-------------|-------|------------|
| `20:0b:74:a5:15:05` | Canon printer (Canon1c2258) | VLAN 40 | AzureWave WiFi module | 10.0.10.184 (wrong VLAN) |
| `44:61:32:08:d6:2c` | ecobee thermostat | VLAN 40 | ecobee Inc. OUI | 10.0.10.185 (wrong VLAN) |
| `3c:6d:66:0e:1f:67` | NVIDIA Shield TV | VLAN 50 | Needs internet | 10.0.10.161 (wrong VLAN) |

---

## Transient / Unclassified

| MAC | OUI | Device hint | Last seen | Notes |
|-----|-----|-------------|-----------|-------|
| `04:70:56:5c:6d:3a` | Arcadyan | Boost2 mobile hotspot | 10.0.10.141 | Transient; no reservation needed |
| `84:fc:14:61:1f:df` | TBD | Unknown | 10.0.10.198 | Unidentified |

---

## Notes

- All personal/IoT devices above are currently leaking into VLAN 10 because switch ports and WAP SSID-to-VLAN steering aren't configured yet.
- `10.0.203.172` for the work laptop suggests it hit a wrong scope entirely — likely connected to a port without 802.1Q tagging or caught a different DHCP scope.
- `84:fc:14:61:1f:df` OUI lookup returned no match; could be a locally-administered MAC (randomization).
