# ---------------------------------------------------------------------------
# Technitium DNS + DHCP LXC — edge.pve
#
# Single-node Phase 1. HA failover added when shared storage is available.
#
# Network layout (multi-interface — one IP per VLAN, no relay):
#   eth0  VLAN 10  10.0.10.30/24   management + DNS VIP  GW 10.0.10.1
#   eth1  VLAN 20  10.0.20.2/24    private-net
#   eth2  VLAN 30  10.0.30.2/24    guest-net
#   eth3  VLAN 40  10.0.40.2/24    iot-no-inter
#   eth4  VLAN 50  10.0.50.2/24    iot-with-inter
#
# DHCP ranges (all VLANs): x.x.x.100–199
# DNS pushed to clients: VLAN-local Technitium IP (avoids inter-VLAN DNS traffic
# — required for VLANs 40/50 where OPNsense blocks cross-VLAN traffic)
#
# Prerequisites (manual, before terraform apply):
#   1. vmbr0 on edge.pve must be VLAN-aware (set in Proxmox network config)
#   2. SW05 (switch port 5) must be trunked — see ansible/switch_configs/css326.yml
#   3. Debian 12 LXC template downloaded on edge.pve:
#      pveam update && pveam download local debian-12-standard_12.7-1_amd64.tar.zst
#   4. MetalLB technitium-dns service removed from k8s before apply
#      (so 10.0.10.30 is free to assign statically to this LXC)
# ---------------------------------------------------------------------------

resource "proxmox_virtual_environment_container" "technitium" {
  node_name    = "edge"
  vm_id        = 200
  description  = "Technitium DNS+DHCP — single node Phase 1. Managed by Terraform."
  tags         = ["lxc", "terraform", "dns", "dhcp", "technitium"]

  started       = true
  start_on_boot = true
  unprivileged  = true

  initialization {
    hostname = "technitium"

    # During bootstrap Technitium cannot resolve itself — use public fallback.
    # After first-boot configuration, Technitium serves its own DNS.
    dns {
      servers = ["1.1.1.1", "8.8.8.8"]
    }

    # eth0 — VLAN 10, primary management interface + DNS VIP
    ip_config {
      ipv4 {
        address = "10.0.10.30/24"
        gateway = "10.0.10.1"
      }
    }

    # eth1 — VLAN 20 private-net (no gateway; routed via eth0 default route)
    ip_config {
      ipv4 { address = "10.0.20.2/24" }
    }

    # eth2 — VLAN 30 guest-net
    ip_config {
      ipv4 { address = "10.0.30.2/24" }
    }

    # eth3 — VLAN 40 iot-no-inter
    ip_config {
      ipv4 { address = "10.0.40.2/24" }
    }

    # eth4 — VLAN 50 iot-with-inter
    ip_config {
      ipv4 { address = "10.0.50.2/24" }
    }
  }

  cpu {
    cores        = 1
    architecture = "amd64"
  }

  memory {
    dedicated = 512
    swap      = 256
  }

  disk {
    datastore_id = var.storage_pool
    size         = 8
  }

  # eth0 — VLAN 10, native/management
  network_interface {
    name    = "eth0"
    bridge  = "vmbr0"
    vlan_id = 10
  }

  # eth1 — VLAN 20
  network_interface {
    name    = "eth1"
    bridge  = "vmbr0"
    vlan_id = 20
  }

  # eth2 — VLAN 30
  network_interface {
    name    = "eth2"
    bridge  = "vmbr0"
    vlan_id = 30
  }

  # eth3 — VLAN 40
  network_interface {
    name    = "eth3"
    bridge  = "vmbr0"
    vlan_id = 40
  }

  # eth4 — VLAN 50
  network_interface {
    name    = "eth4"
    bridge  = "vmbr0"
    vlan_id = 50
  }

  operating_system {
    # Download on edge.pve: pveam download local debian-12-standard_12.7-1_amd64.tar.zst
    template_file_id = "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst"
    type             = "debian"
  }

  features {
    nesting = false
  }
}
