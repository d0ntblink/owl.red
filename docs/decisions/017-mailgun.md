# Decision 017: Mailgun For Automated Email

## Status

Accepted by the owner on 2026-10-18, revised to the `mg.owl.red` sending
subdomain because apex receiving will use a different provider. The existing
subdomain is adopted, active and DNS-verified; the owner confirmed receipt of
the migrated-sender test. The previously received apex test is historical.

## Decision

Use the existing Mailgun US account and `mg.owl.red` for automated email.
Do not deploy a local SMTP/IMAP/JMAP server or mail-store PVC. Sending identities
and production application credentials remain to be selected.

The [isolated Terraform root](../../terraform/mailgun/main.tf) owns the Mailgun
domain through pinned `wgebis/mailgun` 0.10.0. It requests 2048-bit DKIM, disables
open/click tracking and wildcard receiving, and prevents domain destruction.
It configures no SMTP password and makes no Cloudflare DNS or MX changes.
Existing Mailgun domains must be inspected/imported before a reviewed apply.

## Domain Scope

- `mg.owl.red`: the only selected production sending domain, Mailgun US; preserve all apex receiving records.
- `sandbox280a4fb516e04b73a52aa6c61e3242f1.mailgun.org`: existing Mailgun-managed non-production sandbox, not provisioned by this Terraform root; requires authorized recipients.
- `0v0.zip`: not onboarded under the current free-plan constraint.
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

Public Cloudflare DNS is owned by the separate private
[d0ntblink/cloudflare-iac](https://github.com/d0ntblink/cloudflare-iac) repository.
Its initial `zones/owl.red` root uses explicit public DKIM inputs, not another
repository's local Terraform state. Review Mailgun's supplied sending records,
merge SPF instead of creating a second policy, and publish only the exact public
DKIM records. The duplicate unapplied DNS root in this repository is retired.
The approved MX records are confined to `mg.owl.red`; apex receiving stays
untouched. Do not add tracking records or third-party forensic reporting
incidentally. Internal Technitium DNS and external-access policy remain unchanged.

The provider confirmed the old apex registration was removed outside Terraform.
A state-only `removed` block with `destroy=false` retires its stale ownership
without recreating or deleting a cloud object. The sole managed custom sender
is now `mg.owl.red`. The apex SPF is back to its separate-provider policy;
receiving MX remains unchanged and the old public DKIM is retained for prior
signatures. No additional custom domain is provisioned for the sandbox.

## Acceptance

Preparation requires real provider-schema validation and a retained lockfile.
Deployment additionally requires authenticated existing-domain inspection, a
reviewed isolated plan, approved DNS adoption, verified domain authentication
and an actual delivered test with bounce/failure handling. None of those live
operations is implied by scaffolding or a ready Mailgun account.