terraform {
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
