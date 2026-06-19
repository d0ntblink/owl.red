# terraform/unraid — declarative Unraid settings (GraphQL)

Source of truth for every **safe** Unraid setting that the `unraid-api` GraphQL exposes.
Edit the value (in `variables.tf` or a `*.tfvars`), `apply`, done. Companion lanes:
flash-file settings = the Ansible `unraid_settings` role; array/disks/users/secrets = manual.
See [`docs/guides/unraid-making-changes.md`](../../docs/guides/unraid-making-changes.md).

## Managed resources

| Resource | Mutation | Setting |
|----------|----------|---------|
| `system_time` | `updateSystemTime` | NTP servers / timezone |
| `ssh` | `updateSshSettings` | SSH enabled + port |
| `server_identity` | `updateServerIdentity` | hostname / comment / model |
| `connect_settings` | `updateApiSettings` | Unraid Connect remote access — **pinned DISABLED** (ADR 012) |
| `ups` (count-gated) | `configureUps` | NUT/UPS — off unless `var.ups_present=true` |

## DRIVE PROTECTION — intentionally NOT managed here

A `terraform apply` here can **never** touch the array, disks, containers, or VMs. These GraphQL
mutations are deliberately excluded (destructive or operational, not declarative settings):
`array`, `parityCheck`, `vm`, `docker`/`*DockerFolder*`/`*DockerEntries*`/`refreshDockerDigests`,
`rclone`, `initiateFlashBackup`, `recalculateOverview`, all notification mutations, `apiKey`,
`connectSignIn`/`connectSignOut`, `onboarding`, `addPlugin`/`removePlugin`/`unraidPlugins`,
`customization`, and `updateSettings` (opaque JSON blob). Array/disk/user/license changes stay **manual**.

## Prerequisites (controller)

1. **terraform** installed.
2. **Trust the self-signed cert + resolve the hostname.** The provider validates TLS (no insecure flag),
   and the cert CN/SAN is `nas.owl.red`:
   - CA bundle: `~/.certs/owl-bundle.pem` = system CAs + Zscaler + the `nas.owl.red` cert; `export SSL_CERT_FILE=~/.certs/owl-bundle.pem`.
   - `nas.owl.red` must resolve to `10.0.10.5` on the runner (it otherwise resolves to a public IP). Add to `/etc/hosts`:
     `echo "10.0.10.5 nas.owl.red" | sudo tee -a /etc/hosts`
3. **API key:** `export TF_VAR_unraid_api_key="$(bw get password 56ea6570-7420-4172-a600-b46e00397fde --session "$BW_SESSION")"`.

`scripts/unraid-terraform-run.sh` wires up 2–3 for you.

## Run

```bash
scripts/unraid-terraform-run.sh init
scripts/unraid-terraform-run.sh plan     # read-only (provider read_query); proves the path
scripts/unraid-terraform-run.sh apply     # converges settings (first apply is a no-op — already at desired)
```

## Add another setting

1. Find the mutation + shapes (read-only):
   `{ __type(name:"Mutation"){ fields { name args { name type { name ofType { name } } } } } }`, then
   `__type(name:"<InputType>"){ inputFields { name type { name } } }`, and the mutation's **return type**
   (use `{ __typename }` if it's an object; no selection if it returns a scalar).
2. Add a `graphql_mutation "<name>"` following the pattern in `system-time.tf` (create==update mutation,
   a safe `delete_mutation`, a `read_query`, `compute_mutation_keys`, `enable_remote_state_verification=false`).
3. Add its variable(s) to `variables.tf`. **Do not** add any mutation from the drive-protection list above.

## Notes

- `enable_remote_state_verification=false`: code is the source of truth; Terraform applies when the HCL
  inputs change (it does not auto-reconcile external UI edits). Avoids read-drift on padded list values.
- State is local/git-ignored (ADR 015) and holds API responses — never commit it.
