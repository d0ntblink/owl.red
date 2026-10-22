terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
  }
}

provider "proxmox" {
  ssh {
    agent       = false
    username    = "root"
    private_key = file(pathexpand("~/.ssh/id_ed25519_owl_ansible"))
  }
}

variable "seed_image_path" {
  type        = string
  description = "Private controller path to the generated NoCloud seed ISO."

  validation {
    condition     = fileexists(var.seed_image_path)
    error_message = "Generate the portal bootstrap ISO before planning."
  }
}

variable "production_network_attached" {
  type    = bool
  default = true
}

variable "production_guest_enabled" {
  type    = bool
  default = true
}

resource "proxmox_virtual_environment_download_file" "debian" {
  node_name          = "edge"
  datastore_id       = "local"
  content_type       = "iso"
  file_name          = "owl-portal-debian-13-genericcloud-amd64.img"
  url                = "https://cloud.debian.org/images/cloud/trixie/20261021-2638/debian-13-genericcloud-amd64-20261021-2638.qcow2"
  checksum           = "16e0965312c56feb331049d45d2b1b5778f3f942a33d4300eedbb97527707f2bea87c0006f3e4cc7a25fadbff739c4e235a51fb9bcd1b66fd554f7f8e80ba45c"
  checksum_algorithm = "sha512"
}

resource "proxmox_virtual_environment_file" "seed" {
  node_name    = "edge"
  datastore_id = "local"
  content_type = "iso"

  source_file {
    path      = var.seed_image_path
    file_name = "owl-guest-portal-seed.iso"
  }
}

resource "proxmox_virtual_environment_vm" "portal" {
  node_name   = "edge"
  vm_id       = 104
  name        = "guest-portal-stage.owl.red"
  description = "Isolated Debian/openNDS qualification. No production bridge, VLAN, PCI device or guest DHCP authority. SSH only through edge loopback port 22104."
  tags        = ["debian", "guest", "portal", "staging", "terraform"]
  started     = true
  on_boot     = true
  protection  = true
  reboot      = false
  machine     = "q35"
  bios        = "seabios"
  boot_order  = ["scsi0"]

  kvm_arguments = join(" ", [
    "-netdev user,id=owl_portal_bootstrap,net=10.0.2.0/24,hostfwd=tcp:127.0.0.1:22104-10.0.2.15:22",
    "-device virtio-net-pci,netdev=owl_portal_bootstrap,mac=02:6f:77:00:01:04,id=owl_portal_bootstrap_nic",
    "-netdev hubport,id=owl_portal_guest,hubid=0",
    "-device virtio-net-pci,netdev=owl_portal_guest,mac=02:6f:77:30:01:04,id=owl_portal_guest_nic",
  ])

  cpu {
    cores = 1
    type  = "host"
    units = 256
  }

  memory {
    dedicated = 768
    floating  = 0
  }

  dynamic "network_device" {
    for_each = var.production_network_attached ? [true] : []
    content {
      bridge       = "vmbr0v30"
      model        = "virtio"
      mac_address  = "02:6F:77:30:03:04"
      disconnected = !var.production_guest_enabled
      firewall     = false
    }
  }

  dynamic "network_device" {
    for_each = var.production_network_attached ? [true] : []
    content {
      bridge      = "vmbr31"
      model       = "virtio"
      mac_address = "02:6F:77:31:01:04"
      firewall    = false
    }
  }

  disk {
    datastore_id = "local-lvm"
    file_id      = proxmox_virtual_environment_download_file.debian.id
    interface    = "scsi0"
    file_format  = "raw"
    size         = 8
    discard      = "on"
    ssd          = true
  }

  cdrom {
    enabled   = true
    file_id   = proxmox_virtual_environment_file.seed.id
    interface = "ide2"
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

output "staging_vm_id" {
  value = proxmox_virtual_environment_vm.portal.vm_id
}