terraform {
  required_version = ">= 1.5.0"

  required_providers {
    mailgun = {
      source  = "wgebis/mailgun"
      version = "= 0.10.0"
    }
  }
}

provider "mailgun" {}

resource "mailgun_domain" "automation" {
  name                          = "owl.red"
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
  }
}

output "sending_dns_records" {
  description = "Mailgun-supplied public sending records for review and adoption by the DNS owner; does not change DNS."
  value       = mailgun_domain.automation.sending_records_set
}

output "smtp_login" {
  description = "Domain SMTP login identifier; no SMTP password is configured or exposed by this root."
  value       = mailgun_domain.automation.smtp_login
}