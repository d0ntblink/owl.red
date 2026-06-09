# Issue 003 — Proxmox API Token Cannot Configure Raw PCI/USB Passthrough

**Date:** 2026-05-20  
**Affected resources:** `terraform/proxmox/nas/` — Unraid NAS VM (VMID 101)  
**Severity:** Medium — blocks IaC completeness; workaround exists  
**Status:** Open (workaround applied)

---

## Symptoms

`terraform apply` fails when the VM resource includes raw `hostpci` or `usb` passthrough blocks:

```
Error: error creating VM: All attempts fail:
#1: received an HTTP 500 response - Reason: only root can set 'hostpci0' config for non-mapped devices
#1: received an HTTP 500 response - Reason: only root can set 'usb0' config for real devices
```

---

## Root Cause

Proxmox 8 enforces a permission check: raw PCI device passthrough (`hostpci`) and physical USB passthrough (`usb`) can only be configured by the **root user session**, not by an API token — even `root@pam!terraform` with full Datacenter Admin privileges.

This is a Proxmox-level restriction, not a provider bug. The bpg/proxmox provider correctly passes the API token but cannot override PVE's access check for raw device references.

---

## Workaround Applied

Stripped `hostpci` and `usb` blocks from `nas.tf`. After `terraform apply` succeeds, run the following on `storage.pve.owl.red` as root:

```bash
# Add PCI passthrough
qm set 101 -hostpci0 '0000:02:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #1 (IOMMU group 52)
qm set 101 -hostpci1 '0000:03:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #2 (IOMMU group 53)
qm set 101 -hostpci2 '0000:01:00,pcie=1,rombar=0'   # NetXen NX3031 10G NIC (IOMMU group 51)

# Add USB boot flash
qm set 101 -usb0 'host=24a9:205a,usb3=1'            # Unraid boot flash (vendor 24a9 / product 205a)

# Fix boot order
qm set 101 -boot 'order=usb0;scsi0'
```

---

## Proper Fix — PVE Resource Mappings

Proxmox 8 introduced **cluster resource mappings** (`/cluster/mapping/pci`) which allow API tokens to reference pre-approved devices by name. This is the intended IaC path.

### Step 1 — Create mappings on the storage node (one-time, as root)

```bash
pvesh create /cluster/mapping/pci \
  --id hba1 \
  --map 'node=storage,path=0000:02:00.0,iommugroup=52'

pvesh create /cluster/mapping/pci \
  --id hba2 \
  --map 'node=storage,path=0000:03:00.0,iommugroup=53'

pvesh create /cluster/mapping/pci \
  --id nas-10gnic \
  --map 'node=storage,path=0000:01:00.0,iommugroup=51'
```

### Step 2 — Update `nas.tf` to use mapping names instead of raw IDs

```hcl
hostpci {
  device  = "hostpci0"
  mapping = "hba1"
  pcie    = true
  rombar  = false
}

hostpci {
  device  = "hostpci1"
  mapping = "hba2"
  pcie    = true
  rombar  = false
}

hostpci {
  device  = "hostpci2"
  mapping = "nas-10gnic"
  pcie    = true
  rombar  = false
}
```

USB passthrough for physical devices has no mapping equivalent in PVE 8. It will always require the `qm set` manual step or a root-authenticated provider.

---

## References

- [Proxmox Resource Mappings docs](https://pve.proxmox.com/wiki/PCI_Passthrough#Resource_Mapping)
- [bpg/proxmox provider — hostpci mapping attribute](https://registry.terraform.io/providers/bpg/proxmox/latest/docs/resources/virtual_environment_vm#mapping)
