terraform {
  # --- Remote state: DEFERRED (see docs/decisions/015-terraform-remote-state-deferred.md) ---
  # State is LOCAL and git-ignored during the single-operator phase. Before a second
  # operator or CI-driven apply, enable an encrypted remote backend. Example (S3-compatible,
  # e.g. MinIO on the NAS); credentials come from Bitwarden via the runner env:
  #
  # backend "s3" {
  #   bucket                      = "owl-red-tfstate"
  #   key                         = "opnsense/terraform.tfstate"
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
    opnsense = {
      source  = "browningluke/opnsense"
      version = "~> 0.11"
    }
  }
}

# Credentials via environment variables (no secrets in code):
#   OPNSENSE_ENDPOINT   = https://10.0.10.1
#   OPNSENSE_API_KEY    = <API key from OPNsense user>
#   OPNSENSE_API_SECRET = <API secret from OPNsense user>
#
# Create a dedicated API user in OPNsense:
#   System → Access → Users → Add
#   Assign group with: Firewall, DHCP, Interfaces, Unbound DNS privileges
#   System → Access → Users → <user> → API keys → Generate
#
# Run via scripts/terraform-run.sh once opnsense env vars are added to it,
# or source env.secret and run terraform directly for local dev.
provider "opnsense" {
  uri              = var.opnsense_endpoint
  api_key          = var.opnsense_api_key
  api_secret       = var.opnsense_api_secret
  allow_unverified = true
}
