# ---------------------------------------------------------------------------
# Technitium DNS + DHCP LXC — edge.pve
#
# Single-node LXC multi-homed to all VLANs.
# HA failover added when shared storage is available.
#
# Network layout: 5 NICs, each bridged to vmbr0 with specific vlan_id.
# This allows Technitium to receive L2 broadcast (DHCP) natively on every subnet
# and serves DNS directly via local VLAN IP without crossing the OPNsense firewall.
#
# Prerequisites (before terraform apply):
#   1. Debian 12 LXC template downloaded on edge.pve:
#      pveam update && pveam download local debian-12-standard_12.7-1_amd64.tar.zst
#   2. 10.0.10.30 must be free (MetalLB technitium pool removed — already done)
# ---------------------------------------------------------------------------

resource "proxmox_virtual_environment_container" "technitium" {
  node_name    = "edge"
  vm_id        = 200
  description  = "Technitium DNS+DHCP — single node Phase 1. Managed by Terraform."
  tags         = ["lxc", "terraform", "dns", "dhcp", "technitium"]

  started       = true
  start_on_boot = true
  unprivileged  = false

  initialization {
    hostname = "technitium"

    # During bootstrap Technitium cannot resolve itself — use public fallback.
    # After first-boot configuration, Technitium serves its own DNS.
    dns {
      servers = ["1.1.1.1", "8.8.8.8"]
    }

    # eth0 — VLAN 10 (Management & Infra)
    ip_config {
      ipv4 {
        address = "10.0.10.30/24"
        gateway = "10.0.10.1"
      }
    }
    
    # eth1 — VLAN 20 (Private)
    ip_config {
      ipv4 { address = "10.0.20.30/24" }
    }
    
    # eth2 — VLAN 30 (Guest)
    ip_config {
      ipv4 { address = "10.0.30.30/24" }
    }
    
    # eth3 — VLAN 40 (IoT No-Inter)
    ip_config {
      ipv4 { address = "10.0.40.30/24" }
    }
    
    # eth4 — VLAN 50 (IoT With-Inter)
    ip_config {
      ipv4 { address = "10.0.50.30/24" }
    }
  }

  cpu {
    cores        = 1
    architecture = "amd64"
  }

  memory {
    dedicated = 2048
    swap      = 512
  }

  disk {
    datastore_id = var.storage_pool
    size         = 8
  }

  # Native VLAN bridging — LXC sits directly on all subnets
  network_interface { name = "eth0", bridge = "vmbr0", vlan_id = 10 }
  network_interface { name = "eth1", bridge = "vmbr0", vlan_id = 20 }
  network_interface { name = "eth2", bridge = "vmbr0", vlan_id = 30 }
  network_interface { name = "eth3", bridge = "vmbr0", vlan_id = 40 }
  network_interface { name = "eth4", bridge = "vmbr0", vlan_id = 50 }

  operating_system {
    # Downloaded from: https://hydra.nixos.org/build/328082540/download/1/nixos-image-lxc-proxmox-25.11pre-git-x86_64-linux.tar.xz
    template_file_id = "local:vztmpl/nixos-image-lxc-proxmox-25.11pre-git-x86_64-linux.tar.xz"
    type             = "nixos"
  }

  features {
    nesting = true
  }
}
