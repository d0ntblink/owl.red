# Mailgun Automation Domain

Owner-approved scope: `owl.red`, Mailgun US. This root owns only the Mailgun
sending domain, not Cloudflare DNS, receiving routes or mailbox storage.
Personal `khodayari.info` / `d0ntb.link` Proton replacement is pending a mailbox
destination decision. `0v0.zip` is optional and not provisioned;
`crucialmentis.com` is excluded from this project.

Public Cloudflare DNS is owned by the separate private
[d0ntblink/cloudflare-iac](https://github.com/d0ntblink/cloudflare-iac) repository,
under `zones/owl.red`. That root consumes explicit public DKIM inputs, not this
repository's local Terraform state. Do not recreate a second DNS writer here.

Current status: the `owl.red` Mailgun US domain is created through this root.
Sending DNS verification and the authorized delivery test remain pending the
separate DNS apply; no MX or personal-mailbox change has been made.

## Requirements And Credentials

- Terraform 1.5+ and registry access; `wgebis/mailgun` is pinned to 0.10.0 in source and its generated dependency lock must be retained.
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

If `owl.red` already exists in Mailgun US, review its actual settings and import
it rather than attempting creation:

```bash
terraform -chdir=terraform/mailgun import mailgun_domain.automation us:owl.red
```

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
4. Keep existing MX unchanged until a separate receiving cutover is approved.
   Do not add receiving MX just because the provider returns recommendations.
5. Keep open/click tracking disabled. Add a tracking CNAME only if tracking is
   deliberately enabled later; mail DNS records must not be HTTP-proxied.
6. Trigger Mailgun's domain verification after DNS adoption. Require verified
   sending/authentication plus an actual delivered test and bounce-event review
   before configuring production notification consumers.

Domain provisioning alone does not prove verified DNS or delivered mail. The
sender addresses, workload credentials and alert failure behavior still need
to be configured through their owning IaC lanes.