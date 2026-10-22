# Documentation

Use current configuration sources and the owning operational guide for changes.
Decisions explain why; dated issue reports preserve evidence and may describe
retired implementations. They are not instructions to replay migrations.

## Start Here

| Need | Document |
|------|----------|
| Remaining work and priorities | [Roadmap](../ROADMAP.md) |
| Select the configuration owner | [Change guide](guides/changing-owl-red.md) |
| Prepare controller tools and access | [Controller setup](guides/controller-setup.md) |
| Find hardware, addresses and interfaces | [Device inventory](device-inventory.md) |
| Understand terminology | [Glossary](glossary.md) |
| Handle credentials and disclosures | [Security policy](../SECURITY.md) |

## Network Operations

- [Wi-Fi architecture](guides/wifi-architecture.md): current SSIDs, VLAN paths,
  bridge bindings, guest rules, diagrams and guarded firmware refresh.
- [Guest Wi-Fi troubleshooting](guides/guest-wifi-troubleshooting.md): separate
  radio, DHCP, consent and enforcement failures without replaying deployment.
- [Wi-Fi password rotation](guides/wifi-password-rotation.md): vault authority,
  timed native trial, acceptance and rollback.
- [Client migration](guides/vlan-client-migration.md): placement and device checks.
- [Guest gateway](../terraform/proxmox/guest-portal/README.md): VM lifecycle,
  openNDS ownership and provider caveats.
- [Technitium](../gitops/technitium/README.md): Git-managed DNS/DHCP and publication.
- [VyOS](../vyos/README.md): router configuration ownership.

## Platform And Services

- [Proxmox](guides/proxmox-terraform.md) and [node upgrades](guides/proxmox-node-upgrades.md).
- [Shared storage](guides/shared-storage.md) and [PostgreSQL](guides/postgresql.md).
- [Unraid changes](guides/unraid-making-changes.md) and [power/recovery](guides/power-and-recovery.md).
- [Home Assistant](guides/home-assistant.md) and [Thingino cameras](guides/thingino-cameras.md).
- [Bitwarden secret flow](guides/bitwarden-secrets-flow.md) and [Fleet](../gitops/rancher/fleet/README.md).

## Maintenance Rules

Keep accepted implementation details in their owning guides and unfinished work
in the roadmap. Link instead of duplicating full procedures. Record what a check
actually proves: configuration, runtime, over-air visibility and real-client
behavior are different evidence.

Keep credentials, firmware images containing private keys, recovery preimages,
generated diagnostics and Terraform state outside published documentation.
Do not remove dated [issue evidence](issues/) or [decisions](decisions/) merely
because the implementation changed; add clear supersession context where needed.
Publishing any commit can trigger Fleet and Technitium reconciliation, including
a documentation-only commit. Review and coordinate publication separately.