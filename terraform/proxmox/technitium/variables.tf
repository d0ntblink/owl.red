variable "storage_pool" {
  description = "Proxmox storage pool for VMs (e.g., local-lvm)"
  type        = string
  default     = "local-lvm"
}
