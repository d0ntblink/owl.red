resource "proxmox_virtual_environment_vm" "nas" {
  name      = "nas.owl.red"
  node_name = "storage"
  vm_id     = 101
  tags      = ["nas", "passthrough", "storage", "unraid", "slackware", "10.0.10.5"]

  description = <<-EOT
    **nas.owl.red** — Unraid NAS (10.0.10.5)

    Passthrough devices (managed via qm set post-apply):
    - hostpci0: 0000:01:00 — LSI SAS3008 HBA #1 (IOMMU group 52)
    - hostpci1: 0000:03:00 — LSI SAS3008 HBA #2 (IOMMU group 54)
    - hostpci2: 0000:02:00 — NVIDIA GeForce GTX 1060 6GB (IOMMU group 53)
    - hostpci3: 0000:06:00 — Intel 82599ES 10G (Dual Port, IOMMU groups 57/58)
    - usb0: 24a9:205a — Virtual USB gadget (dummy_hcd, see notes/issues/004-unraid-usb-gadget-license.md)

    Network: Intel 82599ES SFP+ 10G passthrough (auto vfio-pci binding by Proxmox)

    USB boot flash replaced with software gadget. Physical USB removed from server.
    Image: /var/lib/unraid-usb/unraid-license-usb.img (sparse, ~14G on disk)
    Service: unraid-usb-gadget.service (starts before pve-guests.service)

    protection=true is set — disable it in the PVE UI before destroying.
  EOT

  on_boot = true   # auto-start on host boot (after gadget service brings up virtual USB)
  started = false  # Terraform must not start/stop this VM — passthrough + live HBA data

  # Prevent accidental deletion or modification via PVE UI/API
  protection = true

  machine = "q35"
  bios    = "ovmf"

  cpu {
    cores   = 6
    sockets = 1
    type    = "host"
    flags   = ["+pcid", "+md-clear", "+spec-ctrl", "+ssbd", "+ibpb"]
  }

  memory {
    dedicated = 24576
    floating  = 0 # ballooning disabled — Unraid does not support it
  }

  agent {
    enabled = false # no QEMU guest agent in Unraid
  }

  tablet_device = false # headless VM, no tablet input needed

  serial_device {} # serial0 socket — clean console via: qm terminal 101 -iface serial0

  # OVMF EFI vars disk — small, on local-lvm SSD
  efi_disk {
    datastore_id      = "local-lvm"
    file_format       = "raw"
    type              = "4m"
    pre_enrolled_keys = false
  }

  # TPM v2 — present but NOT used for license binding (Unraid 7 blocks BOCHS/virtual TPM).
  # License is bound via virtual USB gadget instead. See notes/issues/004-unraid-usb-gadget-license.md
  tpm_state {
    datastore_id = "local-lvm"
    version      = "v2.0"
  }

  # 32 GiB emulated SSD — Unraid appdata / cache virtual disk
  # This is a NEW empty disk on local-lvm. It does NOT touch HBA-attached drives.
  disk {
    datastore_id = "local-lvm"
    interface    = "scsi0"
    size         = 32
    discard      = "on"
    ssd          = true
    file_format  = "raw"
  }

  scsi_hardware = "virtio-scsi-pci"

  # ---------------------------------------------------------------------------
  # PCI + USB passthrough — CANNOT be managed via bpg/proxmox API token.
  # Proxmox requires root user session. See notes/issues/003.
  #
  # After terraform apply, run on storage node as root:
  #   qm set 101 -hostpci0 '0000:01:00,pcie=1,rombar=0'
  #   qm set 101 -hostpci1 '0000:03:00,pcie=1,rombar=0'
  #   qm set 101 -hostpci2 '0000:02:00,pcie=1,rombar=0'
  #   qm set 101 -hostpci3 '0000:06:00,pcie=1,rombar=0'
  #   qm set 101 -usb0 'host=24a9:205a,usb3=1'
  # ---------------------------------------------------------------------------

  boot_order = ["scsi0"]  # internal boot; USB is attached for license only, not booted

  startup {
    order      = 2
    up_delay   = 60
    down_delay = 60
  }
}
