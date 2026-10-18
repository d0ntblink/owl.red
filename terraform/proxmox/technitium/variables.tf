variable "storage_pool" {
  description = "Proxmox storage pool for VMs (e.g., local-lvm)"
  type        = string
  default     = "local-lvm"
}

variable "technitium_vlan_stage" {
  description = "Explicit attachment count for active VLANs 20,40,50 then dormant guest 30; zero preserves native management only."
  type        = number
  default     = 3

  validation {
    condition     = contains([0, 1, 2, 3, 4], var.technitium_vlan_stage)
    error_message = "Select a separately reviewed attachment stage from 0 to 4; NIC updates require a container restart."
  }
}
