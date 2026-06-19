# =============================================================================
# SCAFFOLD — NOT YET IMPORTED. LXC 231 (pdm) exists (bootstrapped by
# scripts/pdm-lxc-ha-bootstrap.sh) and is HA-managed by Proxmox ha-manager,
# currently pinned to cp1 (non-shared storage). Before ANY apply:
#   scripts/terraform-run.sh -chdir=terraform/proxmox/pdm init
#   scripts/terraform-run.sh -chdir=terraform/proxmox/pdm import \
#     proxmox_virtual_environment_container.pdm cp1/231
#   scripts/terraform-run.sh -chdir=terraform/proxmox/pdm plan   # MUST be a no-op
# Set operating_system.template_file_id to the real Debian template and reconcile
# until plan is clean. started=false so Terraform never fights ha-manager for power.
# =============================================================================
terraform {
  # Remote state DEFERRED — see docs/decisions/015-terraform-remote-state-deferred.md (local, git-ignored).
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
  }
}

provider "proxmox" {}

resource "proxmox_virtual_environment_container" "pdm" {
  node_name     = "cp1"
  vm_id         = 231
  description   = "Proxmox Datacenter Manager (PDM). Bootstrapped by scripts/pdm-lxc-ha-bootstrap.sh; HA via ha-manager."
  tags          = ["10.0.10.31", "debian", "infra", "monitor", "pdm"]
  unprivileged  = true
  started       = false # power/HA owned by Proxmox ha-manager, not Terraform
  start_on_boot = true

  cpu {
    cores = 2
  }

  memory {
    dedicated = 4096
    swap      = 512
  }

  features {
    nesting = true
    # NOTE: live container also has keyctl=1; reconcile at import (bpg support varies by version).
  }

  disk {
    datastore_id = "local-lvm"
    size         = 20
  }

  network_interface {
    name        = "eth0"
    bridge      = "vmbr0"
    mac_address = "BC:24:11:7D:37:72"
  }

  initialization {
    hostname = "pdm"
    ip_config {
      ipv4 {
        address = "10.0.10.31/24"
        gateway = "10.0.10.1"
      }
    }
  }

  operating_system {
    type = "debian"
    # template_file_id = "local:vztmpl/<debian template used at create time>"  # set before import
  }
}
