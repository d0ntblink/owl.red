# Device Inventory

Stable hardware, platform and device-identity reference for `owl.red`.
Update records when hardware, OS family, device role, placement or persistent
interfaces change. Software releases, uptime, health readings, free space,
DHCP leases and deployment progress belong in configuration or operational guides.

## Record Format

Each device has one immutable lowercase `id`, a matching heading anchor and a
`Field | Value` table. Required keys are `id`, `kind`, `model`, `platform`,
`role` and `parent`; optional keys add hardware detail. `parent` refers to
another device ID or `None`. Interface tables always use the same four columns.
Capacities use GB/TB for physical disks and GiB for memory/virtual disks.

The [device address registry](../gitops/technitium/dhcp-reservations.json) is
the source for configured allocations. Addresses below identify management
endpoints or explicit allocations, not proof of a current lease or connection.
Secrets and authentication material are excluded.

## Device Index

| ID | Device | Kind | Platform | Management / Allocation |
|----|--------|------|----------|-------------------------|
| [edge-pve](#edge-pve) | Edge hypervisor | physical-host | Proxmox VE | `edge.pve.owl.red` / `10.0.10.3` |
| [storage-pve](#storage-pve) | Storage hypervisor | physical-host | Proxmox VE | `storage.pve.owl.red` / `10.0.10.4` |
| [storage-bmc](#storage-bmc) | Storage remote management | management-controller | IPMI | `ipmi.storage.owl.red` / `10.0.10.6` |
| [cp1-pve](#cp1-pve) | Compute host 1 | physical-host | Proxmox VE | `cp1.pve.owl.red` / `10.0.10.11` |
| [cp2-pve](#cp2-pve) | Compute host 2 | physical-host | Proxmox VE | `cp2.pve.owl.red` / `10.0.10.12` |
| [cp3-pve](#cp3-pve) | Compute host 3 | physical-host | Proxmox VE | `cp3.pve.owl.red` / `10.0.10.13` |
| [worker1-pve](#worker1-pve) | Compute host 4 | physical-host | Proxmox VE | `worker1.pve.owl.red` / `10.0.10.14` |
| [switch-core](#switch-core) | Core switch | network-appliance | SwOS | `switch.owl.red` / `10.0.10.2` |
| [switch-rack-poe](#switch-rack-poe) | Rack PoE access switch | network-appliance | MokerLink unmanaged Ethernet switch | No management address |
| [ap-main](#ap-main) | Wireless access point | network-appliance | OpenWrt | `ap.owl.red` / `10.0.10.40` |
| [pdu-rack](#pdu-rack) | Rack power distribution | power-appliance | APC appliance firmware | `pdu.owl.red` / `10.0.10.9` |
| [ups-rack](#ups-rack) | Rack UPS | power-appliance | USB HID UPS | USB on storage host |
| [router-edge](#router-edge) | Production router | virtual-machine | VyOS | `edge.owl.red` / `10.0.10.1` |
| [router-lab](#router-lab) | Isolated router lab | virtual-machine | VyOS | No production allocation |
| [nas](#nas) | Central NAS | virtual-machine | Unraid | `nas.owl.red` / `10.0.10.5` |
| [dns](#dns) | DNS and DHCP | container | NixOS | `ns1.owl.red` / `10.0.10.30` |
| [pdm](#pdm) | Datacenter manager | container | Debian / Proxmox Datacenter Manager | `pdm.owl.red` / `10.0.10.31` |
| [cp1-k8s](#cp1-k8s) | Kubernetes control plane 1 | virtual-machine | Talos Linux | `cp1.k8s.owl.red` / `10.0.10.21` |
| [cp2-k8s](#cp2-k8s) | Kubernetes control plane 2 | virtual-machine | Talos Linux | `cp2.k8s.owl.red` / `10.0.10.22` |
| [cp3-k8s](#cp3-k8s) | Kubernetes control plane 3 | virtual-machine | Talos Linux | `cp3.k8s.owl.red` / `10.0.10.23` |
| [worker1-k8s](#worker1-k8s) | Kubernetes worker | virtual-machine | Talos Linux | `worker1.k8s.owl.red` / `10.0.10.24` |
| [workstation-w1ngz](#workstation-w1ngz) | Main workstation | client | Windows | `w1ngz.owl.red` / VLAN 20 allocation |
| [phone-paranoid](#phone-paranoid) | Personal phone | client | Android | `paranoid-android.owl.red` / VLAN 20 allocation |
| [laptop-work](#laptop-work) | Work laptop | client | Not documented | `KAM1WL102916` / DHCP |
| [tablet-bedside](#tablet-bedside) | Bedside tablet | client | Android | VLAN 20 allocation |
| [printer-canon](#printer-canon) | Network printer | appliance | Canon appliance firmware | `printer.owl.red` / VLAN 40 allocation |
| [printer-bambu](#printer-bambu) | 3D printer | appliance | Bambu appliance firmware | `bambu.owl.red` / VLAN 40 allocation |
| [thermostat-ecobee](#thermostat-ecobee) | Thermostat | appliance | ecobee appliance firmware | `ecobee.owl.red` / VLAN 50 allocation |
| [media-shield](#media-shield) | Media player | appliance | Android TV | `shield.owl.red` / private VLAN 20 |
| [camera-foyer](#camera-foyer) | Foyer camera | appliance | Thingino / Buildroot Linux | `wuuk-ptz-foyer.owl.red` / VLAN 40 allocation |
| [camera-office](#camera-office) | Office camera | appliance | Thingino / Buildroot Linux | `wuuk-ptz-office.owl.red` / VLAN 40 allocation |

## Physical Infrastructure

### edge-pve

| Field | Value |
|-------|-------|
| id | `edge-pve` |
| kind | physical-host |
| model | Supermicro CSE-523L-505B chassis |
| platform | Proxmox VE |
| role | Router and independent DNS/DHCP infrastructure host |
| parent | None |
| hostname | `edge.pve.owl.red` |
| location | Network cabinet |
| motherboard | ASUS PRIME B365M-A |
| cpu | Intel Core i3-8100; 4 cores / 4 threads |
| memory | 32 GiB DDR4; four 8 GiB DIMMs |
| boot_storage | Samsung SSD 860 EVO M.2 250 GB; serial `S413NS0R510123L` |
| expansion | Intel X710 dual-port SFP+ and Intel I226-V; assigned to router guest |
| guest_ids | `102`, `103`, `200` |
| configuration | [Ansible inventory](../ansible/inventory/hosts.yml), [router VM definition](../terraform/proxmox/vyos-vm/main.tf) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `onboard` / Realtek Gigabit Ethernet | `3c:7c:3f:25:50:6a` | `10.0.10.3` | SW24 / PP36; Proxmox management |
| Intel I226-V passthrough | `e0:d4:e8:ef:2b:f2` | WAN | Router WAN; PCI `0000:04:00.0` |
| Intel X710 port 0 passthrough | `6c:fe:54:70:08:30` | Not assigned | Spare SFP+; PCI `0000:01:00.0` |
| Intel X710 port 1 passthrough | `6c:fe:54:70:08:31` | Router LAN | SW SFP+1; PCI `0000:01:00.1` |

### storage-pve

| Field | Value |
|-------|-------|
| id | `storage-pve` |
| kind | physical-host |
| model | Rosewill RSV-L4500U chassis |
| platform | Proxmox VE |
| role | NAS virtualization and direct storage-device passthrough |
| parent | None |
| hostname | `storage.pve.owl.red` |
| location | Network cabinet |
| motherboard | Supermicro X10SRi-F |
| cpu | Intel Xeon E5-2620 v4; 8 enabled cores, SMT disabled |
| memory | 32 GiB DDR4; four 8 GiB DIMMs, four unpopulated slots |
| boot_storage | Samsung SSD 870 EVO 250 GB; serial `S6PDNM0RC03199Y` |
| management_network | Active-backup bond over the two Intel I350 ports |
| passthrough | Two Broadcom/LSI SAS3008 HBAs, Intel 82599ES dual-port SFP+, NVIDIA GTX 1060 6 GB |
| usb | CyberPower USB UPS and Philips USB device assigned to NAS |
| guest_ids | `101` |
| configuration | [NAS VM definition](../terraform/proxmox/nas/nas.tf), [Unraid management](guides/unraid-making-changes.md) |

Permanent interface MACs are listed below; a bonded slave can present the bond
MAC rather than its permanent address.

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `obnic0` / Intel I350 | `ac:1f:6b:47:87:f0` | Bond `10.0.10.4` | SW10 / PP29; PCI `0000:05:00.0` |
| `obnic1` / Intel I350 | `ac:1f:6b:47:87:f1` | Bond member | SW12 / PP30; PCI `0000:05:00.1` |
| Intel 82599ES port 0 passthrough | `f8:f2:1e:48:91:40` | NAS `10.0.10.5` | SW SFP+2; PCI `0000:06:00.0` |
| Intel 82599ES port 1 passthrough | `f8:f2:1e:48:91:41` | Not assigned | Spare SFP+; PCI `0000:06:00.1` |

### storage-bmc

| Field | Value |
|-------|-------|
| id | `storage-bmc` |
| kind | management-controller |
| model | Supermicro X10SRi-F BMC / ASPEED AST2400 |
| platform | IPMI |
| role | Independent storage-host console and hardware management |
| parent | `storage-pve` |
| hostname | `ipmi.storage.owl.red` |
| access | Dedicated management Ethernet; ATEN virtual keyboard/mouse |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Dedicated BMC Ethernet | `ac:1f:6b:4b:b5:e7` | `10.0.10.6` | SW14 / PP31 |

### cp1-pve

| Field | Value |
|-------|-------|
| id | `cp1-pve` |
| kind | physical-host |
| model | Lenovo ThinkCentre M73; machine type `10AY001RUS` |
| platform | Proxmox VE |
| role | Kubernetes control-plane and datacenter-manager host |
| parent | None |
| hostname | `cp1.pve.owl.red` |
| serial | `MJ01XA9G` |
| motherboard | Lenovo SHARKBAY |
| cpu | Intel Core i3-4130T; 2 cores / 4 threads |
| memory | 16 GiB DDR3; two 8 GiB DIMMs |
| boot_storage | Samsung SSD 870 EVO 250 GB; serial `S61VNJ0NC21690X` |
| guest_ids | `601`, `231` |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `nic0` / Intel I217-V | `00:23:24:7a:87:96` | `10.0.10.11` | SW02 / PP25; `vmbr0` bridge |

### cp2-pve

| Field | Value |
|-------|-------|
| id | `cp2-pve` |
| kind | physical-host |
| model | Lenovo ThinkCentre M73; machine type `10AY001RUS` |
| platform | Proxmox VE |
| role | Kubernetes control-plane host |
| parent | None |
| hostname | `cp2.pve.owl.red` |
| serial | `MG006Q5M` |
| motherboard | Lenovo SHARKBAY |
| cpu | Intel Core i3-4130T; 2 cores / 4 threads |
| memory | 16 GiB DDR3; two 8 GiB DIMMs |
| boot_storage | Samsung SSD 870 EVO 250 GB; serial `S61VNJ0NC21700V` |
| guest_ids | `602` |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `nic0` / Intel I217-V | `00:23:24:70:ef:b0` | `10.0.10.12` | SW04 / PP26; `vmbr0` bridge |

### cp3-pve

| Field | Value |
|-------|-------|
| id | `cp3-pve` |
| kind | physical-host |
| model | Lenovo ThinkCentre M73; machine type `10AY001RUS` |
| platform | Proxmox VE |
| role | Kubernetes control-plane host |
| parent | None |
| hostname | `cp3.pve.owl.red` |
| serial | `MJ00XLD9` |
| motherboard | Lenovo SHARKBAY |
| cpu | Intel Core i3-4130T; 2 cores / 4 threads |
| memory | 16 GiB DDR3; two 8 GiB DIMMs |
| boot_storage | Samsung SSD 870 EVO 250 GB; serial `S61VNJ0NC21692Y` |
| guest_ids | `603` |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `nic0` / Intel I217-V | `00:23:24:6f:c2:4b` | `10.0.10.13` | SW06 / PP27; `vmbr0` bridge |

### worker1-pve

| Field | Value |
|-------|-------|
| id | `worker1-pve` |
| kind | physical-host |
| model | Lenovo ThinkCentre M73; machine type `10AY001RUS` |
| platform | Proxmox VE |
| role | Kubernetes worker host |
| parent | None |
| hostname | `worker1.pve.owl.red` |
| serial | `MJ00Z08W` |
| motherboard | Lenovo SHARKBAY |
| cpu | Intel Core i3-4130T; 2 cores / 4 threads |
| memory | 16 GiB DDR3; two 8 GiB DIMMs |
| boot_storage | Samsung SSD 870 EVO 250 GB; serial `S6PDNJ0R502989L` |
| guest_ids | `604` |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `nic0` / Intel I217-V | `00:23:24:6b:dc:f9` | `10.0.10.14` | SW08 / PP28; `vmbr0` bridge |

### switch-core

| Field | Value |
|-------|-------|
| id | `switch-core` |
| kind | network-appliance |
| model | MikroTik CSS326-24G-2S+RM |
| platform | SwOS |
| role | Core Layer-2 switching and VLAN trunks |
| parent | None |
| hostname | `switch.owl.red` |
| location | Network cabinet |
| ports | 24 Gigabit RJ45 ports and 2 SFP+ cages |
| numbering | Front columns are staggered: top row even, bottom row odd |
| configuration | [Switch configuration](../ansible/switch_configs/css326.yml) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Management | `48:8f:5a:0c:d1:82` | `10.0.10.2` | Native management network |

### switch-rack-poe

| Field | Value |
|-------|-------|
| id | `switch-rack-poe` |
| kind | network-appliance |
| model | MokerLink POE-G083GS |
| platform | Unmanaged Gigabit Ethernet / IEEE 802.3af/at PoE switch |
| role | Downstream rack access switch and PoE source; it is not the VLAN configuration owner |
| parent | `switch-core` |
| management | Unmanaged; no management address or configuration interface |
| location | Rack; between the network-cabinet CSS326 and rack devices, per owner |
| interfaces | 8 PoE+ Gigabit RJ45 ports (ports 1-8); 2 Gigabit RJ45 uplinks (ports 9-10); 1 Gigabit SFP uplink (port 11) |
| poe_budget | 120 W total advertised; up to 30 W per PoE port |
| port_features | Advertised QoS priority on PoE ports 1-2; PoE watchdog/AI restart advertised but trigger, scope and disable control are not verified |
| dip_switch | Default/Extend; current position not recorded. Extend is advertised to isolate PoE ports 1-8 from each other while allowing uplink communication; it is not documented as configurable 802.1Q VLAN management. |
| topology_notes | Owner confirms switch is installed inline between the network-cabinet CSS326 and rack. Exact CSS326 port, selected MokerLink uplink, attached endpoint-to-port map and end-to-end VLAN transparency are not recorded here. See [decision 023](decisions/023-mokerlink-poe-rack-switch.md). |
| specification | [Manufacturer POE-G083GS product page](https://www.mokerlink.com/index.php?route=product/product&product_id=377) |

### ap-main

| Field | Value |
|-------|-------|
| id | `ap-main` |
| kind | network-appliance |
| model | D-Link DIR-885L |
| platform | OpenWrt 25.12.2; approved rollback 2026-10-22; unexpected restarts and client connectivity remain unresolved |
| role | VLAN-aware Layer-2 wireless access point |
| parent | None |
| hostname | `ap.owl.red` |
| radios | 2.4 GHz channel 1 HT20, 8 dBm: guest/local-IoT/cloud-IoT; 5 GHz channel 36 VHT80, 12 dBm: private |
| management | Native untagged management; LAN4 local recovery connection |
| networks | VLAN 20 private; VLAN 30 guest; VLAN 40 local IoT; VLAN 50 cloud IoT |
| services | Routing, DNS, DHCP and captive-portal enforcement run off the AP |
| configuration | [AP inventory variables](../ansible/inventory/group_vars/aps.yml), [Wi-Fi architecture](guides/wifi-architecture.md), [Wi-Fi maintenance](guides/wifi-password-rotation.md) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Management bridge | `10:be:f5:d9:1e:37` | `10.0.10.40` | SW18 / PP33; native management plus tagged client VLANs |

### pdu-rack

| Field | Value |
|-------|-------|
| id | `pdu-rack` |
| kind | power-appliance |
| model | APC AP7900B |
| platform | APC appliance firmware |
| role | Managed rack power distribution |
| parent | None |
| hostname | `pdu.owl.red` |
| controller | Embedded NMC2, hardware identifier `0G-1238` |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Management Ethernet | `00:c0:b7:df:67:08` | `10.0.10.9` | SW16 / PP32 |

### ups-rack

| Field | Value |
|-------|-------|
| id | `ups-rack` |
| kind | power-appliance |
| model | CyberPower LX1500GU |
| serial | `QAKLO7008640` |
| platform | USB HID UPS |
| role | Rack battery-backed power |
| parent | None |
| usb_identity | `0764:0501`; CP1500 AVR controller family |
| monitoring_connection | USB on `storage-pve` |
| protected_circuits | Not documented; do not infer outlet coverage from USB attachment |

## Virtual Infrastructure

### router-edge

| Field | Value |
|-------|-------|
| id | `router-edge` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | VyOS |
| role | Production routing, firewall, RA and LAN NTP |
| parent | `edge-pve` |
| hostname | `edge.owl.red` |
| guest_id | `103` |
| cpu | 4 vCPU |
| memory | 12 GiB |
| storage | 64 GiB local virtual disk |
| placement | Pinned to edge host by WAN/LAN PCI passthrough |
| configuration | [Native router configuration](../vyos/), [VM definition](../terraform/proxmox/vyos-vm/main.tf) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| WAN / Intel I226-V | `e0:d4:e8:ef:2b:f2` | ISP-assigned | Physical WAN |
| LAN / Intel X710 | `6c:fe:54:70:08:31` | `10.0.10.1` | SW SFP+1; client VLAN gateways use `10.0.<VLAN>.1` |
| Spare X710 port | `6c:fe:54:70:08:30` | Not assigned | Physical spare |

### router-lab

| Field | Value |
|-------|-------|
| id | `router-lab` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | VyOS |
| role | Isolated router configuration qualification |
| parent | `edge-pve` |
| hostname | `edge-lab.owl.red` |
| guest_id | `102` |
| cpu | 2 vCPU |
| memory | 4 GiB |
| storage | 64 GiB local virtual disk |
| network | No production NIC passthrough; lab-only interfaces and addressing |
| configuration | [Lab profile and procedures](../vyos/) |

### nas

| Field | Value |
|-------|-------|
| id | `nas` |
| kind | virtual-machine |
| model | QEMU q35 VM, UEFI |
| platform | Unraid |
| role | Central application state, files, media and infrastructure storage |
| parent | `storage-pve` |
| hostname | `nas.owl.red` |
| guest_id | `101` |
| cpu | 6 vCPU |
| memory | 24 GiB |
| guest_disk | 32 GiB local virtual disk |
| usb_passthrough | Philips device `24a9:205a` |
| storage_passthrough | Broadcom/LSI SAS3008 HBAs at `0000:01:00.0` and `0000:03:00.0` |
| gpu_passthrough | NVIDIA GeForce GTX 1060 6 GB at `0000:02:00.0` |
| network_passthrough | Intel 82599ES dual-port SFP+ at `0000:06:00` |
| array | Ten data disks, 46 TB nominal; one 6 TB parity disk |
| pools | Separate 500 GB `ssd` XFS and 500 GB `cache` Btrfs pools |
| configuration | [VM definition](../terraform/proxmox/nas/nas.tf), [storage design](guides/shared-storage.md) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Intel 82599ES port 0 | `f8:f2:1e:48:91:40` | `10.0.10.5` | SW SFP+2 / PP39 |
| Intel 82599ES port 1 | `f8:f2:1e:48:91:41` | Not assigned | Physical spare |

| Slot | Model | Serial | Capacity | Filesystem / Role |
|------|-------|--------|----------|-------------------|
| parity | Seagate ST6000VN0033-2EE110 | `ZAD9M7A0` | 6 TB | Array parity |
| disk1 | Seagate ST4000VN008-2DR166 | `ZGY16VP5` | 4 TB | XFS data |
| disk2 | Seagate ST4000VN008-2DR166 | `ZGY16V7Q` | 4 TB | XFS data |
| disk3 | Seagate ST4000VN008-2DR166 | `ZGY1AWG4` | 4 TB | XFS data |
| disk4 | WDC WD60EDAZ-11U78B0 | `WD-WX32D44RFVXX` | 6 TB | XFS data |
| disk5 | WDC WD60EFPX-68C5ZN0 | `WD-WXK2AA2DA8VY` | 6 TB | XFS data |
| disk6 | WDC WD40EFAX-68JH4N1 | `WD-WX22D21F554A` | 4 TB | XFS data |
| disk7 | WDC WD40EFAX-68JH4N1 | `WD-WX52D319ZFSY` | 4 TB | XFS data |
| disk8 | WDC WD40EFAX-68JH4N1 | `WD-WX22DB0NYN5J` | 4 TB | XFS data |
| disk9 | WDC WD40EFAX-68JH4N1 | `WD-WX92D414PRCX` | 4 TB | XFS data |
| disk10 | WDC WD60EDAZ-11U78B0 | `WD-WX22D34LY067` | 6 TB | XFS data |
| cache | WDC WDS500G1R0B-68A4Z0 | `204192800343` | 500 GB | Btrfs pool |
| ssd | Samsung SSD 860 EVO | `S4XANE0M734128N` | 500 GB | XFS pool |

### dns

| Field | Value |
|-------|-------|
| id | `dns` |
| kind | container |
| model | Proxmox LXC |
| platform | NixOS |
| role | Technitium internal DNS and DHCP |
| parent | `edge-pve` |
| hostname | `ns1.owl.red`; container hostname `technitium` |
| guest_id | `200` |
| cpu | 1 vCPU |
| memory | 2 GiB |
| storage | 8 GiB local root filesystem |
| configuration | [NixOS host](../nix/hosts/technitium/), [DNS/DHCP definitions](../gitops/technitium/) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `eth0` | `bc:24:11:d4:5b:7b` | `10.0.10.30`; `fde4:cabf:d798:10::30` | Native management on `vmbr0` |
| `eth1` | `bc:24:11:81:1b:26` | `10.0.20.30`; `fde4:cabf:d798:20::30` | VLAN 20 on `vmbr0` |
| `eth2` | `bc:24:11:fb:8f:c6` | `10.0.40.30`; `fde4:cabf:d798:40::30` | VLAN 40 on `vmbr0` |
| `eth3` | `bc:24:11:1f:41:73` | `10.0.50.30`; `fde4:cabf:d798:50::30` | VLAN 50 on `vmbr0` |
| `eth4` | `bc:24:11:9f:ec:68` | `10.0.30.30`; `fde4:cabf:d798:30::30` | VLAN 30 on `vmbr0` |

### pdm

| Field | Value |
|-------|-------|
| id | `pdm` |
| kind | container |
| model | Proxmox LXC |
| platform | Debian / Proxmox Datacenter Manager |
| role | Centralized Proxmox administration |
| parent | `cp1-pve` |
| hostname | `pdm.owl.red` |
| guest_id | `231` |
| cpu | 2 vCPU |
| memory | 4 GiB |
| storage | 20 GiB local root filesystem |
| configuration | [Guest definition](../terraform/proxmox/pdm/), [ingress configuration](../gitops/pdm/) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| `eth0` | `bc:24:11:7d:37:72` | `10.0.10.31` | Host `vmbr0` |

### cp1-k8s

| Field | Value |
|-------|-------|
| id | `cp1-k8s` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | Talos Linux |
| role | Kubernetes control plane and etcd member |
| parent | `cp1-pve` |
| hostname | `cp1.k8s.owl.red`; Kubernetes name `cp1-talos` |
| guest_id | `601` |
| cpu | 2 vCPU |
| memory | 10 GiB |
| storage | 40 GiB local virtual disk |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| VirtIO Ethernet | `02:00:00:00:00:21` | `10.0.10.21` | Host `vmbr0` |

### cp2-k8s

| Field | Value |
|-------|-------|
| id | `cp2-k8s` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | Talos Linux |
| role | Kubernetes control plane and etcd member |
| parent | `cp2-pve` |
| hostname | `cp2.k8s.owl.red`; Kubernetes name `cp2-talos` |
| guest_id | `602` |
| cpu | 2 vCPU |
| memory | 10 GiB |
| storage | 40 GiB local virtual disk |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| VirtIO Ethernet | `02:00:00:00:00:22` | `10.0.10.22` | Host `vmbr0` |

### cp3-k8s

| Field | Value |
|-------|-------|
| id | `cp3-k8s` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | Talos Linux |
| role | Kubernetes control plane and etcd member |
| parent | `cp3-pve` |
| hostname | `cp3.k8s.owl.red`; Kubernetes name `cp3-talos` |
| guest_id | `603` |
| cpu | 2 vCPU |
| memory | 10 GiB |
| storage | 40 GiB local virtual disk |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| VirtIO Ethernet | `02:00:00:00:00:23` | `10.0.10.23` | Host `vmbr0` |

### worker1-k8s

| Field | Value |
|-------|-------|
| id | `worker1-k8s` |
| kind | virtual-machine |
| model | QEMU q35 VM |
| platform | Talos Linux |
| role | Kubernetes worker |
| parent | `worker1-pve` |
| hostname | `worker1.k8s.owl.red`; Kubernetes name `worker1-talos` |
| guest_id | `604` |
| cpu | 4 vCPU |
| memory | 12 GiB |
| storage | 40 GiB local virtual disk |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| VirtIO Ethernet | `02:00:00:00:00:24` | `10.0.10.24` | Host `vmbr0` |

## Clients And Appliances

### workstation-w1ngz

| Field | Value |
|-------|-------|
| id | `workstation-w1ngz` |
| kind | client |
| model | Dell Precision 5530 |
| platform | Windows |
| role | Main workstation and infrastructure controller |
| parent | None |
| hostname | `W1NGZ`; network identity `w1ngz.owl.red` |
| motherboard | Dell `0FP2W2` |
| cpu | Intel Core i9-8950HK |
| memory | 32 GiB |
| gpu | Intel UHD Graphics 630 and NVIDIA Quadro P2000 |
| storage | Samsung SSD 850 EVO M.2 500 GB; serial `S33DNX0H907136P` |
| network_policy | Trusted private Wi-Fi; separate native-management Ethernet path |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Intel Wireless-AC 9260 | `5c:87:9c:fa:10:f4` | Allocation `10.0.20.10` | Private Wi-Fi |
| Realtek USB Gigabit Ethernet | `84:3a:5b:87:91:dd` | DHCP | Native-management client path through SW22 / PP35 |

### phone-paranoid

| Field | Value |
|-------|-------|
| id | `phone-paranoid` |
| kind | client |
| model | LG smartphone; exact model not documented |
| platform | Android |
| role | Personal mobile client |
| parent | None |
| hostname | `paranoid-android.owl.red` |
| network_policy | Trusted private VLAN 20 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi identity | `a0:4f:85:f6:ec:76` | Allocation `10.0.20.11` | Private Wi-Fi |

### laptop-work

| Field | Value |
|-------|-------|
| id | `laptop-work` |
| kind | client |
| model | Work laptop; exact model not documented |
| platform | Not documented |
| role | Workstation for work use |
| parent | None |
| hostname | `KAM1WL102916` |
| addressing | Dynamic DHCP; no fixed reservation |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi identity | `bc:cd:99:2b:3c:a7` | DHCP | Trusted client network |
| Additional interface, type unclassified | `24:fb:e3:7c:cf:da` | DHCP | Associated hostname; not a separate fixed allocation |

### tablet-bedside

| Field | Value |
|-------|-------|
| id | `tablet-bedside` |
| kind | client |
| model | Lenovo Tab M10 FHD Plus `TB-X606FA` |
| platform | Android |
| role | Bedside dashboard, alarm clock and media playback |
| parent | None |
| serial | `HVA0GSZV` |
| cpu | MediaTek MT8768; eight ARM64 cores |
| gpu | PowerVR Rogue GE8320 |
| memory | 2 GiB |
| storage | 32 GB eMMC |
| display | 1200 x 1920 |
| dock | Lenovo HA-200 |
| allocation | VLAN 20; address-plan identity `tablet.owl.red` / `10.0.20.12` |
| configuration | [Tablet runbook](../nix/android-tablet/README.md) |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Hardware Wi-Fi | `78:d6:dc:00:01:75` | DHCP | Per-SSID privacy identity may differ; reservation must use the selected SSID identity |
| Bluetooth | `78:d6:dc:08:01:75` | Not applicable | Local Bluetooth; not an IP reservation |

### printer-canon

| Field | Value |
|-------|-------|
| id | `printer-canon` |
| kind | appliance |
| model | Canon network printer; device name `Canon1c2258` |
| platform | Canon appliance firmware |
| role | Local network printing |
| parent | None |
| hostname | `printer.owl.red` |
| network_policy | Local-only VLAN 40 |
| network_module | AzureWave Wi-Fi |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi | `20:0b:74:a5:15:05` | Allocation `10.0.40.10` | Local-IoT Wi-Fi |

### printer-bambu

| Field | Value |
|-------|-------|
| id | `printer-bambu` |
| kind | appliance |
| model | Bambu Lab A1 |
| platform | Bambu appliance firmware |
| role | Local 3D printing |
| parent | None |
| hostname | `bambu.owl.red` |
| network_policy | Local-only VLAN 40 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi | `80:65:99:a1:5f:9c` | Allocation `10.0.40.11` | Local-IoT Wi-Fi |

### thermostat-ecobee

| Field | Value |
|-------|-------|
| id | `thermostat-ecobee` |
| kind | appliance |
| model | ecobee thermostat; exact model not documented |
| platform | ecobee appliance firmware |
| role | Thermostat and cloud-connected home automation |
| parent | None |
| hostname | `ecobee.owl.red` |
| network_policy | Internet-connected IoT VLAN 50 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi | `44:61:32:08:d6:2c` | Allocation `10.0.50.10` | Cloud-IoT Wi-Fi |

### media-shield

| Field | Value |
|-------|-------|
| id | `media-shield` |
| kind | appliance |
| model | NVIDIA Shield TV; hardware generation not documented |
| platform | Android TV |
| role | Internet and local-media playback |
| parent | None |
| hostname | `shield.owl.red` |
| network_policy | Private VLAN 20; owner moved Wi-Fi on 2026-10-22 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi identity verified by owner move and DHCP | `3c:6d:66:0e:1f:67` | `10.0.20.100` | Private VLAN 20 |

### camera-foyer

| Field | Value |
|-------|-------|
| id | `camera-foyer` |
| kind | appliance |
| model | WUUK Y0510 PTZ camera |
| platform | Thingino / Buildroot Linux |
| role | Foyer monitoring |
| parent | None |
| hostname | `wuuk-ptz-foyer.owl.red` |
| wifi_chipset | SSV6158 |
| soc | `t31x` platform; exact variant not documented |
| image_sensor | `SC4336P` |
| flash | `ZB25VQ128` |
| network_policy | Local-only VLAN 40 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi / `wlan0` | `02:7f:f6:05:40:fc` | Allocation `10.0.40.12` | `owl.red-iot-local`; 2.4 GHz |

### camera-office

| Field | Value |
|-------|-------|
| id | `camera-office` |
| kind | appliance |
| model | WUUK Y0510 PTZ camera |
| platform | Thingino / Buildroot Linux |
| role | Office monitoring |
| parent | None |
| hostname | `wuuk-ptz-office.owl.red` |
| wifi_chipset | SSV6158 |
| soc | `t31x` platform; exact variant not documented |
| image_sensor | `SC4336P` |
| flash | `ZB25VQ128` |
| network_policy | Local-only VLAN 40 |

| Interface | MAC | Address | Connection |
|-----------|-----|---------|------------|
| Wi-Fi / `wlan0` | `02:2d:1f:56:ee:b8` | Allocation `10.0.40.13` | `owl.red-iot-local`; 2.4 GHz |

## Rack Connections

Blue cables identify infrastructure uplinks/trunks; purple identifies endpoint
and room-drop patching; aqua identifies SFP+ DAC links. Patch-panel ports are
passive cable paths, not separately discoverable network devices.

| Switch Port | Patch Path | Device / Purpose |
|-------------|------------|------------------|
| SW02 | PP25 | `cp1-pve` |
| SW04 | PP26 | `cp2-pve` |
| SW06 | PP27 | `cp3-pve` |
| SW08 | PP28 | `worker1-pve` |
| SW10 | PP29 | `storage-pve` first management NIC |
| SW12 | PP30 | `storage-pve` second management NIC |
| SW14 | PP31 | `storage-bmc` |
| SW16 | PP32 | `pdu-rack` |
| SW18 | PP33 | `ap-main` VLAN uplink |
| Unknown | Network cabinet to rack | `switch-core` uplink to downstream `switch-rack-poe`; exact CSS326 port, MokerLink uplink port and VLAN behavior not yet recorded |
| SW22 | PP35 | Native-management client path |
| SW24 | PP36 | `edge-pve` management |
| SFP+1 | PP16 to PP37 | `router-edge` LAN passthrough |
| SFP+2 | PP39 | `nas` SFP+ passthrough |

## Service Addresses

These are service identities, not additional hardware devices.

| Identity | Address | Function |
|----------|---------|----------|
| Kubernetes API | `10.0.10.20:6443` | Shared control-plane VIP |
| Internal DNS | `10.0.10.30` and VLAN-local DNS interfaces | Technitium in `dns` container |
| Internal ingress | `10.0.10.201` | Traefik / MetalLB; `rancher.owl.red`, `dns.owl.red`, `home.owl.red`, `traefik.owl.red` |
| Load-balancer allocations | `10.0.10.200-250` | MetalLB service-address pool |

## Unclassified Network Identities

These identifiers have no verified device record; they are not fixed allocations.
Randomized addresses and historical leases are not stable asset identities.

| MAC | Classification |
|-----|----------------|
| `8c:04:ba:80:b9:a8` | Dell-associated identity; device model/function not documented |
| `04:70:56:5c:6d:3a` | Arcadyan Boost2 hotspot identity; no permanent reservation |
| `84:fc:14:61:1f:df` | Device identity not classified |

## Configuration References

- [Ansible host inventory](../ansible/inventory/hosts.yml)
- [DHCP allocation registry](../gitops/technitium/dhcp-reservations.json)
- [Internal DNS records](../gitops/technitium/zones/owl.red.zone)
- [Virtualization configuration](../terraform/proxmox/)
- [Network and device change procedures](guides/changing-owl-red.md)