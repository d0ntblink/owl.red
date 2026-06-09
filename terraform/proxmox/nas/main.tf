terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "0.66.1"
    }
  }
}

# Credentials via environment variables (same cluster as proxmox/):
#   PROXMOX_VE_ENDPOINT   = https://10.0.10.11:8006/
#   PROXMOX_VE_API_TOKEN  = root@pam!terraform=<secret>
#   PROXMOX_VE_INSECURE   = true
provider "proxmox" {}
