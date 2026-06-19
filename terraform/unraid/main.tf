# =============================================================================
# terraform/unraid — declarative source of truth for Unraid settings that are
# settable via the unraid-api GraphQL. Write the value here, `terraform apply`,
# done. DRIVE PROTECTION: only safe config mutations live here — array, parity,
# vm, docker, rclone, flash-backup, notifications, plugin-install are NEVER
# managed by Terraform (see README). Flash-file settings = the Ansible
# `unraid_settings` role; array/disks/users/secrets = manual.
#
# Run (controller): see README.md — needs SSL_CERT_FILE=~/.certs/owl-bundle.pem
# (trusts the self-signed nas.owl.red cert), `nas.owl.red`->10.0.10.5 resolvable,
# and TF_VAR_unraid_api_key exported from Bitwarden.
# =============================================================================
terraform {
  # Remote state DEFERRED — see docs/decisions/015-terraform-remote-state-deferred.md (local, git-ignored).
  required_providers {
    graphql = {
      source  = "sullivtr/graphql"
      version = "2.6.1"
    }
  }
}

provider "graphql" {
  url = var.unraid_graphql_url
  headers = {
    "x-api-key" = var.unraid_api_key
  }
}
