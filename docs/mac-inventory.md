# MAC Inventory — owl.red

Personal reference. Not machine-consumed. Allocation decisions updated: 2026-10-14.
Recorded MACs and prior addresses were not re-probed during this allocation update.

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

| MAC | Device | Notes | Prior Recorded IP | Target Allocation |
|-----|--------|-------|-------------------|-------------------|
| `5c:87:9c:fa:10:f4` | w1ngz workstation (Intel WiFi) | Main workstation | `10.0.10.188` | `w1ngz.owl.red` - `10.0.20.10` |
| `a0:4f:85:f6:ec:76` | paranoid-android (LG phone) | Personal phone | `10.0.10.166` | `paranoid-android.owl.red` - `10.0.20.11` |
| `bc:cd:99:2b:3c:a7` | work laptop (KAM1WL102916) | Intel WiFi; dynamic only | `10.0.203.172` | VLAN 20 dynamic pool `10.0.20.100-199`; no fixed lease |

---

## IoT / Smart Home

| MAC | Device | Target VLAN | Notes | Prior Recorded Address | Target Allocation |
|-----|--------|-------------|-------|------------------------|-------------------|
| `20:0b:74:a5:15:05` | Canon printer (Canon1c2258) | VLAN 40 | AzureWave WiFi module; local only | `10.0.10.184` | `printer.owl.red` - `10.0.40.10` |
| `80:65:99:a1:5f:9c` | Bambu Lab A1 3D printer | VLAN 40 | Local only | Not recorded | `bambu.owl.red` - `10.0.40.11` |
| `44:61:32:08:d6:2c` | ecobee thermostat | VLAN 50 | ecobee Inc. OUI; needs cloud API | `10.0.10.185` | `ecobee.owl.red` - `10.0.50.10` |
| `3c:6d:66:0e:1f:67` | NVIDIA Shield TV | VLAN 50 | Needs internet; local media access requires explicit inter-VLAN policy | `10.0.10.161` | `shield.owl.red` - `10.0.50.11` |
| `78:d6:dc:00:01:75` | Lenovo Tab M10 FHD Plus (`TB-X606FA`, serial `HVA0GSZV`) | VLAN 20 | Hardware WLAN MAC shown in About tablet, 2026-10-13; bedside dashboard, alarms and media; HA-200 dock | Recorded SSID uses the MAC below | Planned `tablet.owl.red` - `10.0.20.12`; lease MAC pending |
| `82:f3:5c:c9:92:46` | Lenovo TB-X606FA - observed active WiFi | VLAN 20 | Locally administered MAC on `TELUS2221`, distinct from hardware WLAN MAC; not verified for the target SSID | `10.0.10.166/16` (DHCP, observed 2026-10-13) | Same pending tablet allocation; not a second reservation |
| `78:d6:dc:08:01:75` | Lenovo TB-X606FA - Bluetooth | N/A | Bluetooth address shown in About tablet, 2026-10-13 | N/A | N/A; not an IP interface |
| `02:7f:f6:05:40:fc` | WUUK Y0510 (wuuk-ptz-foyer) sc4336p t31x ZB25VQ128 | VLAN 40 | Local-only policy approved 2026-10-14 | `10.0.10.186` (prior recorded reservation) | `wuuk-ptz-foyer.owl.red` - `10.0.40.12` |
| `02:2d:1f:56:ee:b8` | WUUK Y0510 (wuuk-ptz-office) sc4336p t31x ZB25VQ128 | VLAN 40 | Local-only policy approved 2026-10-14 | `10.0.10.124` (prior recorded reservation) | `wuuk-ptz-office.owl.red` - `10.0.40.13` |

---

## Transient / Unclassified

| MAC | OUI | Device hint | Last seen | Notes |
|-----|-----|-------------|-----------|-------|
| `8c:04:ba:80:b9:a8` | Dell (recorded) | Unidentified Dell device | `10.0.10.139` | Identify owner/function before choosing a VLAN or fixed lease |
| `04:70:56:5c:6d:3a` | Arcadyan | Boost2 mobile hotspot | 10.0.10.141 | Transient; no reservation needed |
| `84:fc:14:61:1f:df` | TBD | Unknown | 10.0.10.198 | Unidentified |

---

## Allocation Status

- The [DHCP registry](../gitops/technitium/dhcp-reservations.json) is the machine-consumed source for target allocations. Confirmed reservations have matching [DNS records](../gitops/technitium/zones/owl.red.zone), except the existing PDM ingress/backend split.
- The tablet's VLAN 20 address is reserved in the plan only: `status: pending`, lease MAC `TBD`, and no static DNS record. Verify the MAC on its target SSID before confirming the lease. Current SSH/ADB endpoints are unchanged.
- The work laptop is recorded under VLAN 20 `dynamicClients` metadata, which the sync ignores. It must remain dynamic rather than receive an invented fixed lease.
- WAN, spare NICs and Bluetooth are not missing DHCP clients. Unidentified and transient devices above remain explicitly unallocated rather than receive guessed identities or policies.
- A DHCP reservation does not select a VLAN. Switch-port/SSID steering, firewall policy, lease renewal, and removal of any legacy camera reservations are separate cutover work. See [rollout and rollback](../gitops/technitium/README.md#device-allocation-and-migration).

---

## Notes

- The tablet's MAC/IP above were verified on 2026-10-13; target VLAN 20 and the pending hostname/address were selected on 2026-10-14. The LG phone's `10.0.10.166` entry is an older observation, not a reservation or a confirmed simultaneous IP conflict. See [tablet management](../nix/android-tablet/README.md) for SSH and deployment details.
- The prior personal/IoT addresses were recorded before verified per-VLAN steering. An address or SSID alone does not prove VLAN membership.
- The work laptop's `10.0.203.172` lies within the recorded flat `10.0.0.0/16` baseline; it does not by itself prove a rogue DHCP scope. Its target remains VLAN 20 dynamic DHCP.
- `84:fc:14:61:1f:df` OUI lookup returned no match; could be a locally-administered MAC (randomization).
