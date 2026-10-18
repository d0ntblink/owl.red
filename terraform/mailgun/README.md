# Mailgun Automation Domain

Owner-approved production scope: `mg.owl.red`, Mailgun US. This root owns the Mailgun
sending domain, not Cloudflare DNS, receiving routes or mailbox storage.
Personal `khodayari.info` / `d0ntb.link` Proton replacement is pending a mailbox
destination decision. `0v0.zip` is not part of the current free-plan setup;
`crucialmentis.com` is excluded from this project.

Public Cloudflare DNS is owned by the separate private
[d0ntblink/cloudflare-iac](https://github.com/d0ntblink/cloudflare-iac) repository,
under `zones/owl.red`. That root consumes explicit public DKIM inputs, not this
repository's local Terraform state. Do not recreate a second DNS writer here.

Accepted migration (2026-10-18): the owner-created `mg.owl.red` registration is
adopted and active. The Cloudflare owner published its SPF, independent RSA-2048
DKIM and two subdomain-only Mailgun MX records; authoritative DNS and Mailgun
verification pass. The owner confirmed receipt of one test from
`alerts@mg.owl.red`. Tracking remains off; no tracking CNAME or third-party
forensic reports were added.

The provider subsequently reported the old `owl.red` registration absent. Its
stale state was retired with a `removed` block and `destroy=false`; Terraform
must not recreate it. This migration created/deleted no Mailgun registration.
The apex SPF was restored to its pre-Mailgun policy; its receiving MX, other
TXT records and SPF TTL are unchanged. The old public DKIM record is retained
for historical signatures, not as an active sender. Apex receiving therefore
remains independent of the Mailgun subdomain.

## Non-Production Sandbox

Use the existing Mailgun-managed domain
`sandbox280a4fb516e04b73a52aa6c61e3242f1.mailgun.org` for non-production smoke
tests. Its API status was active. It is not a mailbox address, a new custom
domain to provision, or a Cloudflare zone to manage. Sandbox sending requires
Mailgun-authorized recipients; an address being approved by the owner does not
by itself satisfy Mailgun's recipient-verification requirement. No sandbox
message was sent during this migration.

## Requirements And Credentials

- Terraform 1.7+ for the declarative state-only `removed` block, plus registry access; `wgebis/mailgun` is pinned to 0.10.0 and its dependency lock must be retained.
- The owner-selected US Mailgun account and an API key permitted to read/create/update this domain. Existing domain/account state must be read before apply.
- Supply `MAILGUN_API_KEY` only in the Terraform child environment using the existing private Bitwarden Secrets Manager workflow. Never put it in HCL, tfvars, logs or command arguments; do not shell-source `env.secret`.
- Review local Terraform state/plan security and keep them ignored/private. Sensitive resource attributes can still be stored in state; marking a future SMTP password sensitive does not remove it from state.
- This root deliberately sets no SMTP password and creates no per-application credentials. Select workload credential ownership and rotation before wiring Home Assistant or Alertmanager.

The Proxmox-specific terraform wrapper is not this root's credential loader;
there is no reason to load a hypervisor password for a Mailgun operation.

## Preview And Adopt

From the repository root:

```bash
terraform -chdir=terraform/mailgun init -backend=false -input=false
terraform -chdir=terraform/mailgun validate
terraform -chdir=terraform/mailgun plan -input=false
```

The first two commands do not need a Mailgun API key or create cloud resources.
For the authenticated plan, inject the private API key into the child process.
Review only this isolated root, never a mixed Proxmox root.

If `mg.owl.red` already exists in Mailgun US, review its actual settings and import
it rather than attempting creation:

```bash
terraform -chdir=terraform/mailgun import mailgun_domain.sending us:mg.owl.red
```

The checked-in declarative import adopts the existing sender without a
replacement. The provider imports `dkim_key_size` as null
because the API does not return that creation-time attribute; only that field
is ignored for the adopted sender. Verify the actual public RSA key is 2048
bits before DNS publication rather than forcing a destructive recreation.
The old apex has no resource declaration and must not be recreated when
rebuilding state. Its `removed` block only relinquishes stale ownership; it
never authorizes a cloud deletion.

Import changes local state, not the domain. Review any subsequent update
separately; `prevent_destroy` refuses accidental replacement/deletion. A
successful validation is not an authenticated plan or permission to apply.

## DNS And Delivery Gates

1. Inspect the provider's `sending_dns_records` output against current public
   records. Update only the explicit public inputs in `cloudflare-iac`, then
   review its zone-scoped import/plan. This root intentionally performs no DNS
   writes and grants no cross-repository access to its full local state.
2. Merge Mailgun into the existing SPF policy instead of publishing a second
   SPF record. Preserve Proton's authorization while it still sends mail.
3. Publish only Mailgun's exact public DKIM key/selector. Do not copy private
   signing material or assume the selector before Mailgun supplies it.
4. Keep apex MX unchanged until a separate receiving cutover is approved.
   The approved Mailgun MX records are at `mg.owl.red` only, for subdomain
   handling/bounces; they do not provide personal mailbox hosting or an app route.
   The apex SPF now authorizes its separate provider only; Mailgun authorization
   lives in the `mg.owl.red` SPF record.
5. Keep open/click tracking disabled. Add a tracking CNAME only if tracking is
   deliberately enabled later; mail DNS records must not be HTTP-proxied.
6. Trigger Mailgun's domain verification after DNS adoption. Require verified
   sending/authentication plus an actual delivered test and bounce-event review
   before configuring production notification consumers.

Use the current US `PUT /v4/domains/mg.owl.red/verify` endpoint for domain
verification. The legacy v3 check returned unknown records during this rollout;
v4 reported an active domain with SPF/DKIM valid. The unused tracking CNAME may
remain unknown because tracking is deliberately disabled.

The sending test uses `POST /v3/mg.owl.red/messages` over HTTPS with native
Node.js `FormData`, private Basic authentication and per-message tracking off.
This requires Node.js 20.12+ for the existing private-env loader, fetch/FormData
and BWS for credential resolution. Record a unique Message-ID and submission
intent before sending; do not resend after an uncertain result. Queue acceptance
alone is not delivery: use the recipient's confirmation or the exact message's
delivery event. No email credential or message body belongs in Git/log output.

Domain provisioning alone does not prove verified DNS or delivered mail. The
sender addresses, workload credentials and alert failure behavior still need
to be configured through their owning IaC lanes.