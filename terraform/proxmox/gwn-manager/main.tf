terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
  }
}

provider "proxmox" {}

locals {
  controller = jsondecode(file("../../../ansible/vars/gwn-manager.json")).container
}

resource "proxmox_virtual_environment_container" "gwn_manager" {
  node_name     = local.controller.node
  vm_id         = local.controller.id
  description   = "NixOS GWN Manager; native management only."
  tags          = ["gwn", "infra", "lxc", "nixos", "terraform"]
  unprivileged  = local.controller.unprivileged
  started       = true
  start_on_boot = true

  cpu {
    cores = local.controller.cores
  }

  memory {
    dedicated = local.controller.memory_mib
    swap      = 512
  }

  disk {
    datastore_id = "local-lvm"
    size         = local.controller.disk_gib
  }

  features {
    nesting = true
  }

  initialization {
    hostname = local.controller.hostname
    dns {
      domain  = " "
      servers = [local.controller.dns]
    }
    ip_config {
      ipv4 {
        address = local.controller.address
        gateway = local.controller.gateway
      }
    }
    user_account {
      keys = [trimspace(file(pathexpand("~/.ssh/id_ed25519_owl_ansible.pub")))]
    }
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    mac_address = upper(local.controller.mac)
  }

  operating_system {
    type             = "nixos"
    template_file_id = "local:vztmpl/nixos-image-lxc-proxmox-25.11pre-git-x86_64-linux.tar.xz"
  }

  lifecycle {
    prevent_destroy = true
  }
}