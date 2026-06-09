terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
    talos = {
      source  = "siderolabs/talos"
      version = "0.6.1"
    }
  }
}

# Credentials via environment variables (no secrets in code):
#   PROXMOX_VE_ENDPOINT   = https://10.0.10.11:8006/
#   PROXMOX_VE_API_TOKEN  = root@pam!terraform=<secret>
#   PROXMOX_VE_INSECURE   = true
provider "proxmox" {}

# ---------------------------------------------------------------------------
# Node definitions
# ---------------------------------------------------------------------------

locals {
  cluster_name     = "owl-k8s"
  cluster_endpoint = "https://10.0.10.20:6443" # Control Plane VIP
  talos_version    = "v1.7.5"
  gateway          = "10.0.10.1"
  nameservers      = ["10.0.10.1", "1.1.1.1"]

  control_planes = {
    "cp1-talos" = { node = "cp1", vmid = 601, ip = "10.0.10.21/16", mac = "02:00:00:00:00:21", cores = 2, memory = 10240 }
    "cp2-talos" = { node = "cp2", vmid = 602, ip = "10.0.10.22/16", mac = "02:00:00:00:00:22", cores = 2, memory = 10240 }
    "cp3-talos" = { node = "cp3", vmid = 603, ip = "10.0.10.23/16", mac = "02:00:00:00:00:23", cores = 2, memory = 10240 }
  }

  workers = {
    "worker1-talos" = { node = "worker1", vmid = 604, ip = "10.0.10.24/16", mac = "02:00:00:00:00:24", cores = 4, memory = 12288 }
  }

  all_vms = merge(local.control_planes, local.workers)
}

# ---------------------------------------------------------------------------
# Talos cluster secrets (PKI, tokens) - generated once, stored in state
# ---------------------------------------------------------------------------

resource "talos_machine_secrets" "this" {}

# ---------------------------------------------------------------------------
# Machine configurations
# ---------------------------------------------------------------------------

data "talos_machine_configuration" "controlplane" {
  cluster_name     = local.cluster_name
  cluster_endpoint = local.cluster_endpoint
  machine_type     = "controlplane"
  machine_secrets  = talos_machine_secrets.this.machine_secrets
  talos_version    = local.talos_version
}

data "talos_machine_configuration" "worker" {
  cluster_name     = local.cluster_name
  cluster_endpoint = local.cluster_endpoint
  machine_type     = "worker"
  machine_secrets  = talos_machine_secrets.this.machine_secrets
  talos_version    = local.talos_version
}

# ---------------------------------------------------------------------------
# Proxmox VMs
# ---------------------------------------------------------------------------

resource "proxmox_virtual_environment_vm" "control_planes" {
  for_each = local.control_planes

  name        = each.key
  description = "Talos Linux Control Plane - Managed by Terraform"
  tags        = ["talos", "terraform", "k8s", "controlplane"]
  node_name   = each.value.node
  vm_id       = each.value.vmid
  machine     = "q35"
  started     = true

  cpu {
    cores = each.value.cores
    type  = "host"
  }

  memory {
    dedicated = each.value.memory
  }

  disk {
    datastore_id = "local-lvm"
    interface    = "scsi0"
    size         = 40
    file_format  = "raw"
  }

  cdrom {
    enabled   = true
    file_id   = "local:iso/talos-v1.7.5-metal-amd64.iso"
    interface = "ide2"
  }

  boot_order = ["scsi0", "ide2"]

  network_device {
    bridge      = "vmbr0"
    mac_address = each.value.mac
  }

  operating_system {
    type = "l26"
  }
}

resource "proxmox_virtual_environment_vm" "workers" {
  for_each = local.workers

  name        = each.key
  description = "Talos Linux Worker - Managed by Terraform"
  tags        = ["talos", "terraform", "k8s", "worker"]
  node_name   = each.value.node
  vm_id       = each.value.vmid
  machine     = "q35"
  started     = true

  cpu {
    cores = each.value.cores
    type  = "host"
  }

  memory {
    dedicated = each.value.memory
  }

  disk {
    datastore_id = "local-lvm"
    interface    = "scsi0"
    size         = 40
    file_format  = "raw"
  }

  cdrom {
    enabled   = true
    file_id   = "local:iso/talos-v1.7.5-metal-amd64.iso"
    interface = "ide2"
  }

  boot_order = ["scsi0", "ide2"]

  network_device {
    bridge      = "vmbr0"
    mac_address = each.value.mac
  }

  operating_system {
    type = "l26"
  }
}

# ---------------------------------------------------------------------------
# Apply machine configs (after VMs boot into maintenance mode)
# ---------------------------------------------------------------------------

resource "talos_machine_configuration_apply" "control_planes" {
  for_each = local.control_planes

  client_configuration        = talos_machine_secrets.this.client_configuration
  machine_configuration_input = data.talos_machine_configuration.controlplane.machine_configuration
  node                        = split("/", each.value.ip)[0]
  endpoint                    = split("/", each.value.ip)[0]

  config_patches = [
    yamlencode({
      machine = {
        network = {
          hostname = each.key
          interfaces = [{
            deviceSelector = {
              hardwareAddr = each.value.mac
            }
            addresses = [each.value.ip]
            routes = [{
              network = "0.0.0.0/0"
              gateway = local.gateway
            }]
            vip = {
              ip = "10.0.10.20"
            }
          }]
          nameservers = local.nameservers
        }
      }
    })
  ]

  depends_on = [proxmox_virtual_environment_vm.control_planes]
}

resource "talos_machine_configuration_apply" "workers" {
  for_each = local.workers

  client_configuration        = talos_machine_secrets.this.client_configuration
  machine_configuration_input = data.talos_machine_configuration.worker.machine_configuration
  node                        = split("/", each.value.ip)[0]
  endpoint                    = split("/", each.value.ip)[0]

  config_patches = [
    yamlencode({
      machine = {
        network = {
          hostname = each.key
          interfaces = [{
            deviceSelector = {
              hardwareAddr = each.value.mac
            }
            addresses = [each.value.ip]
            routes = [{
              network = "0.0.0.0/0"
              gateway = local.gateway
            }]
          }]
          nameservers = local.nameservers
        }
      }
    })
  ]

  depends_on = [proxmox_virtual_environment_vm.workers]
}

# ---------------------------------------------------------------------------
# Bootstrap etcd (run once on cp1)
# ---------------------------------------------------------------------------

resource "talos_machine_bootstrap" "this" {
  client_configuration = talos_machine_secrets.this.client_configuration
  node                 = "10.0.10.21"
  endpoint             = "10.0.10.21"

  depends_on = [talos_machine_configuration_apply.control_planes]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "talosconfig" {
  value     = talos_machine_secrets.this.client_configuration
  sensitive = true
}
