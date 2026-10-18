# ---------------------------------------------------------------------------
# Technitium DNS + DHCP LXC — edge.pve
#
# Single-node LXC multi-homed to all VLANs.
# HA failover added when shared storage is available.
#
# Network layout: preserve the accepted native management NIC; attach reviewed
# tagged interfaces incrementally through technitium_vlan_stage. DHCP activation
# is separately guarded and is not implied by attaching a network interface.
#
# Prerequisites (before terraform apply):
#   1. The declared NixOS LXC template is available on edge.pve.
#   2. 10.0.10.30 must be free (MetalLB technitium pool removed — already done)
# ---------------------------------------------------------------------------

locals {
  technitium_attached_vlans = slice([20, 40, 50, 30], 0, var.technitium_vlan_stage)
}

resource "proxmox_virtual_environment_container" "technitium" {
  node_name   = "edge"
  vm_id       = 200
  description = "Technitium DNS+DHCP — single node Phase 1. Managed by Terraform."
  tags        = ["lxc", "terraform", "dns", "dhcp", "technitium"]

  started       = true
  start_on_boot = true
  unprivileged  = false

  initialization {
    hostname = "technitium"

    # During bootstrap Technitium cannot resolve itself — use public fallback.
    # After first-boot configuration, Technitium serves its own DNS.
    dns {
      domain  = " "
      servers = ["1.1.1.1", "8.8.8.8"]
    }

    # eth0 — native management, unchanged until its separate tagging transition
    ip_config {
      ipv4 {
        address = "10.0.10.30/24"
        gateway = "10.0.10.1"
      }
    }

    dynamic "ip_config" {
      for_each = local.technitium_attached_vlans
      content {
        ipv4 {
          address = "10.0.${ip_config.value}.30/24"
        }
      }
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
  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    mac_address = "BC:24:11:D4:5B:7B"
  }
  dynamic "network_interface" {
    for_each = local.technitium_attached_vlans
    content {
      name    = "eth${network_interface.key + 1}"
      bridge  = "vmbr0"
      vlan_id = network_interface.value
    }
  }

  operating_system {
    # Downloaded from: https://hydra.nixos.org/build/328082540/download/1/nixos-image-lxc-proxmox-25.11pre-git-x86_64-linux.tar.xz
    template_file_id = "local:vztmpl/nixos-image-lxc-proxmox-25.11pre-git-x86_64-linux.tar.xz"
    type             = "nixos"
  }

  features {
    nesting = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
