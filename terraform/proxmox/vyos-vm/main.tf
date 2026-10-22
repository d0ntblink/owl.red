terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
  }
}

provider "proxmox" {}

variable "production_running" {
  type    = bool
  default = true
}

variable "production_active" {
  type    = bool
  default = true
}

variable "guest_transit_attached" {
  type    = bool
  default = true
}

locals {
  image = jsondecode(file("${path.module}/../../../vyos/image.json"))
}

resource "proxmox_virtual_environment_download_file" "image" {
  node_name          = "edge"
  datastore_id       = "local"
  content_type       = "iso"
  file_name          = local.image.filename
  url                = local.image.url
  checksum           = local.image.sha256
  checksum_algorithm = "sha256"
}

resource "proxmox_virtual_environment_vm" "vyos_lab" {
  name        = "edge-lab.owl.red"
  node_name   = "edge"
  vm_id       = 102
  description = "Permanent non-production router lab. Private virtual WAN and loopback-only SSH via edge; no production bridge or PCI devices."
  tags        = ["infra", "lab", "router", "terraform", "vyos"]

  started    = true
  on_boot    = false
  protection = true
  machine    = "q35"
  bios       = "seabios"

  kvm_arguments = join(" ", [
    "-netdev hubport,id=owl_lab_wan,hubid=0",
    "-device virtio-net-pci,netdev=owl_lab_wan,mac=02:76:79:00:00:01,id=owl_lab_wan_nic",
    "-netdev user,id=owl_lab_lan,restrict=on,net=192.0.2.0/24,host=192.0.2.254,dhcpstart=192.0.2.250,hostfwd=tcp:127.0.0.1:22102-192.0.2.1:22",
    "-device virtio-net-pci,netdev=owl_lab_lan,mac=02:76:79:00:00:02,id=owl_lab_lan_nic",
  ])

  cpu {
    cores   = 2
    sockets = 1
    type    = "host"
    flags   = ["+aes"]
    units   = 256
  }

  memory {
    dedicated = 4096
    floating  = 0
  }

  disk {
    datastore_id = "local-lvm"
    interface    = "sata0"
    size         = 64
    discard      = "on"
    ssd          = true
    file_format  = "raw"
  }

  cdrom {
    enabled   = true
    file_id   = proxmox_virtual_environment_download_file.image.id
    interface = "ide3"
  }

  boot_order = ["sata0", "ide3"]

  serial_device {
    device = "socket"
  }

  operating_system {
    type = "l26"
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = local.image.verified && local.image.channel == "rolling" && local.image.qualification.native_suricata
      error_message = "The staging VM requires the authenticated, pinned rolling image with qualified native Suricata files."
    }
  }
}

output "staging_vm_id" {
  value = proxmox_virtual_environment_vm.vyos_lab.vm_id
}

resource "proxmox_virtual_environment_vm" "vyos_production" {
  name        = var.production_active ? "edge.owl.red" : "edge-next.owl.red"
  node_name   = "edge"
  vm_id       = 103
  description = var.production_active ? "Active production VyOS router. Direct WAN/LAN PCI passthrough; VM 100 retained stopped for rollback." : "Production router replacement in isolated preparation; no physical PCI devices."
  tags        = var.production_active ? ["infra", "router", "terraform", "vyos"] : ["infra", "router", "staging", "terraform", "vyos"]
  started     = var.production_running
  on_boot     = var.production_active
  protection  = true
  reboot      = false
  machine     = "q35"
  bios        = "seabios"

  kvm_arguments = var.production_active ? "" : join(" ", [
    "-netdev hubport,id=owl_stage_wan,hubid=0",
    "-device virtio-net-pci,netdev=owl_stage_wan,mac=e0:d4:e8:ef:2b:f2,id=owl_stage_wan_nic",
    "-netdev user,id=owl_stage_lan,restrict=on,net=10.0.10.0/24,host=10.0.10.254,dhcpstart=10.0.10.250,hostfwd=tcp:127.0.0.1:22103-10.0.10.1:22",
    "-device virtio-net-pci,netdev=owl_stage_lan,mac=6c:fe:54:70:08:31,id=owl_stage_lan_nic",
  ])

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
    flags   = ["+aes"]
  }

  memory {
    dedicated = var.production_active ? 12288 : 4096
    floating  = 0
  }

  disk {
    datastore_id = "local-lvm"
    interface    = "sata0"
    size         = 64
    discard      = "on"
    ssd          = true
    file_format  = "raw"
  }

  cdrom {
    enabled   = true
    file_id   = proxmox_virtual_environment_download_file.image.id
    interface = "ide3"
  }

  boot_order = ["sata0", "ide3"]

  dynamic "hostpci" {
    for_each = var.production_active ? { hostpci0 = "0000:01:00", hostpci1 = "0000:04:00" } : {}
    content {
      device = hostpci.key
      id     = hostpci.value
      pcie   = true
    }
  }

  dynamic "network_device" {
    for_each = var.production_active && var.guest_transit_attached ? [true] : []
    content {
      bridge      = "vmbr31"
      model       = "virtio"
      mac_address = "02:6F:77:31:00:01"
      firewall    = false
    }
  }

  serial_device {
    device = "socket"
  }

  operating_system {
    type = "l26"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "production_vm_id" {
  value = proxmox_virtual_environment_vm.vyos_production.vm_id
}