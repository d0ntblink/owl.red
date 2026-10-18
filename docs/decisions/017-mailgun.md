# Decision 017: Mailgun For Automated Email

## Status

Accepted by the owner on 2026-10-18. Configuration is prepared, not deployed.

## Decision

Use the existing Mailgun US account and `owl.red` itself for automated email.
Do not deploy a local SMTP/IMAP/JMAP server or mail-store PVC. Sending identities
and production application credentials remain to be selected.

The [isolated Terraform root](../../terraform/mailgun/main.tf) owns the Mailgun
domain through pinned `wgebis/mailgun` 0.10.0. It requests 2048-bit DKIM, disables
open/click tracking and wildcard receiving, and prevents domain destruction.
It configures no SMTP password and makes no Cloudflare DNS or MX changes.
Existing Mailgun domains must be inspected/imported before a reviewed apply.

## Domain Scope

- `owl.red`: approved automation sending domain, Mailgun US.
- `0v0.zip`: optional future automation domain; not provisioned by default.
- `khodayari.info` and `d0ntb.link`: personal-mail domains that must leave Proton; actual mailbox/receiving replacement is deferred while automation is prepared first.
- `crucialmentis.com`: explicitly excluded from this project.

Mailgun is a delivery/routing service, not hosted mailbox storage. Do not treat
it as a Proton inbox/archive replacement. Preserve existing delivery until the
later personal-mail cutover is selected and verified; this is not a decision
to keep Proton permanently.

## Ownership And Safety

The [deployment requirements](../../terraform/mailgun/README.md) define private
`MAILGUN_API_KEY` injection, provider/state handling, import and DNS adoption.
Credentials belong in the existing Bitwarden Secrets Manager workflow, never
Git, tfvars, logs or credential-bearing CLI arguments. Provider credentials in
an environment do not make future resource-level passwords absent from state.

Public DNS remains separately owned. Review Mailgun's supplied sending records,
merge SPF instead of creating a second policy, and publish only the exact public
DKIM records. Do not add receiving MX or tracking records incidentally. Internal
Technitium DNS and the homelab external-access policy remain unchanged.

## Acceptance

Preparation requires real provider-schema validation and a retained lockfile.
Deployment additionally requires authenticated existing-domain inspection, a
reviewed isolated plan, approved DNS adoption, verified domain authentication
and an actual delivered test with bounce/failure handling. None of those live
operations is implied by scaffolding or a ready Mailgun account.