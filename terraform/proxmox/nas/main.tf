terraform {
  # --- Remote state: DEFERRED (see docs/decisions/015-terraform-remote-state-deferred.md) ---
  # State is LOCAL and git-ignored during the single-operator phase. Before a second
  # operator or CI-driven apply, enable an encrypted remote backend. Example (S3-compatible,
  # e.g. MinIO on the NAS); credentials come from Bitwarden via the runner env:
  #
  # backend "s3" {
  #   bucket                      = "owl-red-tfstate"
  #   key                         = "proxmox/nas/terraform.tfstate"
  #   region                      = "us-east-1"            # ignored by MinIO, but required
  #   endpoints                   = { s3 = "https://nas.owl.red:9000" }
  #   use_path_style              = true
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   skip_metadata_api_check     = true
  #   # encrypt = true  # rely on bucket-side SSE for encryption at rest
  # }
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
