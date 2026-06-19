# =============================================================================
# SCAFFOLD — NOT YET IMPORTED. VM 100 (edge.owl.red / OPNsense) is the LIVE router.
# Before ANY apply:
#   scripts/terraform-run.sh -chdir=terraform/proxmox/opnsense-vm init
#   scripts/terraform-run.sh -chdir=terraform/proxmox/opnsense-vm import \
#     proxmox_virtual_environment_vm.opnsense edge/100
#   scripts/terraform-run.sh -chdir=terraform/proxmox/opnsense-vm plan   # MUST be a no-op
# Reconcile this file until `plan` shows no changes (smbios/efi/disk-detail diffs are
# expected to need tweaks). NEVER apply against the running router until plan is clean.
# edge.owl.red is PINNED to the edge node (PCIe NIC passthrough) — do not migrate.
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

# Credentials via env (scripts/terraform-run.sh injects root@pam from Bitwarden):
#   PROXMOX_VE_ENDPOINT=https://10.0.10.3:8006/  PROXMOX_VE_USERNAME=root@pam
#   PROXMOX_VE_PASSWORD=<bw>  PROXMOX_VE_INSECURE=true
provider "proxmox" {}

resource "proxmox_virtual_environment_vm" "opnsense" {
  name        = "edge.owl.red"
  node_name   = "edge"
  vm_id       = 100
  description = "OPNsense router/firewall. PINNED to edge (PCIe NIC passthrough hostpci0=0000:01:00, hostpci1=0000:04:00); migration unsupported."
  tags        = ["manual", "network", "opnsense", "router"]

  started    = false # Terraform must NEVER start/stop the router
  on_boot    = true
  protection = true  # disable in the PVE UI before any destroy

  machine = "q35"
  # bios: default seabios (live VM uses seabios, not OVMF)

  cpu {
    cores   = 4
    sockets = 1
    type    = "host"
    flags   = ["+aes"]
  }

  memory {
    dedicated = 12288
    floating  = 0 # balloon disabled
  }

  scsi_hardware = "virtio-scsi-pci"

  disk {
    datastore_id = "local-lvm"
    interface    = "sata0"
    size         = 64
    discard      = "on"
    ssd          = true
    file_format  = "raw"
  }

  boot_order = ["sata0"]

  operating_system {
    type = "other"
  }

  # ---------------------------------------------------------------------------
  # PCIe NIC passthrough — apply out-of-band on the edge node as root (issue 003):
  #   qm set 100 -hostpci0 '0000:01:00,pcie=1'
  #   qm set 100 -hostpci1 '0000:04:00,pcie=1'
  # ---------------------------------------------------------------------------
}
