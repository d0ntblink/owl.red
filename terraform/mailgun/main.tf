terraform {
  required_version = ">= 1.7.0"

  required_providers {
    mailgun = {
      source  = "wgebis/mailgun"
      version = "= 0.10.0"
    }
  }
}

provider "mailgun" {}

removed {
  from = mailgun_domain.legacy_apex

  lifecycle {
    destroy = false
  }
}

resource "mailgun_domain" "sending" {
  name                          = "mg.owl.red"
  region                        = "us"
  dkim_key_size                 = 2048
  wildcard                      = false
  spam_action                   = "disabled"
  open_tracking                 = false
  click_tracking                = false
  web_scheme                    = "https"
  use_automatic_sender_security = false

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [dkim_key_size]
  }
}

import {
  to = mailgun_domain.sending
  id = "us:mg.owl.red"
}

output "sending_dns_records" {
  description = "Mailgun-supplied public sending records for review and adoption by the DNS owner; does not change DNS."
  value       = mailgun_domain.sending.sending_records_set
}

output "smtp_login" {
  description = "Domain SMTP login identifier; no SMTP password is configured or exposed by this root."
  value       = mailgun_domain.sending.smtp_login
}