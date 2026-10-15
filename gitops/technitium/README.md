# Technitium DNS + DHCP (LXC, GitOps-synced)

Technitium runs as a NixOS LXC on `edge.pve` and is authoritative for `owl.red`.
Sole client DNS/DHCP service across five VLANs is the **post-cutover target**,
not the observed deployment. Keep client DNS/DHCP on OPNsense until supporting
VLAN paths and Technitium interfaces are ready and a coordinated handoff is
approved. See the [execution order](../../ROADMAP.md#execution-order),
[ADR 013](../../docs/decisions/013-technitium-single-resolver-all-vlans.md)
for the selected target and revisitable trade-offs, and
[ADR 010](../../docs/decisions/010-technitium-fleet-git-managed-dns.md) for the
Git-managed DNS model.

**Audit baseline (2026-10-14):** one untagged `10.0.10.30/24` NIC; VLAN 10 scope
disabled, scopes 20-50 enabled, zero leases, and every scope reporting DNS
`10.0.10.30`. Current OPNsense settings/lease authority were not authenticated.
Do not infer cutover readiness from reservations or the target table below.

## Quick Reference

| Item | Value |
|------|-------|
| Placement | NixOS LXC (VMID 200) on `edge.pve` (`10.0.10.3`) |
| Hostname | `ns1.owl.red` |
| DNS authority | `owl.red` authoritative zone now; target client DNS uses VLAN-local `10.0.x.30` after handoff |
| Management / VLAN 10 IP | `10.0.10.30` |
| Web UI | `https://dns.owl.red` (Traefik ingress → `10.0.10.201`) |
| DHCP authority | Target: all VLANs after approved handoff; preserve OPNsense during preparation |
| DHCP ranges | `10.0.x.100–199` per VLAN |
| Sync engine | `technitium-sync.service` + `.timer` (boot+3min, then every 15min) |
| Sync source of truth | this directory (`gitops/technitium/`) |

## Desired-State Files

On a changed repository SHA the script applies all four file types, even if the
commit only changes documentation. An unchanged SHA skips reconciliation, so UI
drift is not necessarily corrected at the next timer tick. Settings and imported
record sets are reapplied; reservation removal is not declarative pruning.

| File | Applied via | Purpose |
|------|-------------|---------|
| `settings.json` | `/api/settings/set` | Server settings (forwarders, recursion, DNSSEC, TTL) |
| `zones/owl.red.zone` | `/api/zones/import` | Authoritative `owl.red` zone (BIND format) |
| `dhcp/scopes.json` | `/api/dhcp/scopes/set` | One DHCP scope per VLAN |
| `dhcp-reservations.json` | `/api/dhcp/scopes/addReservedLease` | MAC registry → static leases (only `status: confirmed`, non-`TBD`) |

`dynamicClients` in the registry is metadata for known devices that must remain
on dynamic DHCP, not a second reservation list. Pending reservations also remain
in the address plan without being emitted by the sync.

Zone files are discovered by basename: every `zones/*.zone` is imported as a Primary
zone named after the filename.

## How Sync Works

The sync logic lives in `nix/hosts/technitium/sync.sh`, embedded into the LXC's Nix
store by `nix/hosts/technitium/configuration.nix`. The timer is declared in the same
NixOS config.

1. `git fetch` + `reset --hard origin/main` into `/opt/owl.red`.
2. Skip the run entirely if the commit SHA is unchanged (`/var/lib/technitium-sync/last-sha`).
3. Apply settings → zones → DHCP scopes → DHCP reservations.
4. Record the new SHA on success.

Reservations are upserted (existing lease for a MAC is removed first, then re-added),
but entries absent from the registry are not pruned. Some reservation failures
are warnings and can still result in a recorded SHA. Check the journal and
actual reservation/record state rather than equating SHA equality with complete
convergence. Zone import need not set the live SOA serial equal to the source
serial; compare intended records and inspect the live serial separately.

### Transition Safety

- All five source scopes currently include `enabled: true`. The script passes
  those fields to `scopes/set` but does not call `scopes/enable` or
  `scopes/disable`, which are separate operations in the upstream API. Do not
  treat the JSON field as verified serving-state control.
- Before attaching reachable VLAN interfaces, verify the installed API version
  and implement/test explicit disabled-state reconciliation. Read back scope
  state and use a real-client packet check to prove no offers before handoff,
  including after sync/restart. Preserve existing DNS service while doing so.
- Pausing the timer neither disables already-enabled scopes nor cancels an
  in-flight service. New commits, manual sync and bootstrap are change actions;
  coordinate them with the serving-state guard rather than using them as tests.
- Resolve legacy `/16` overlap before routing the contained target `/24`s.
  Prepare L2/L3 paths before transferring client resolver/DHCP authority. Disable
  the old DHCP server for the affected domain before enabling its replacement,
  and account for outstanding leases in both handoff and rollback.
- Verify actual VLAN-local DNS options on renewed clients. Do not introduce
  early CoreDNS/Talos resolver overrides or DNS interception to hide an
  unfinished network transition.

## Lifecycle Ownership

| Layer | Owner |
|-------|-------|
| LXC lifecycle (target five NICs; observed one) | Terraform — `terraform/proxmox/technitium/technitium-lxc.tf` |
| OS + Technitium + sync service | NixOS — `nix/hosts/technitium/configuration.nix` |
| Admin account, API token, first sync trigger | Ansible — `ansible/roles/technitium_lxc/`, played by `ansible/playbooks/deploy-technitium-lxc.yml` |
| DNS / DHCP desired state | This directory |

## Bootstrap Secrets

Secrets stay out of Git. The admin password and a least-privilege automation API
token are provisioned from Bitwarden Secrets Manager by the Ansible role
(`bootstrap.yml`); the token is written to `/etc/technitium/sync.token` inside the
LXC. The sync service skips silently until that token exists.

The bootstrap command below is an operational reference, not a subnet/VLAN
migration procedure or permission to replace the running LXC configuration.

```bash
# Provision LXC config + secrets (requires BWS_ACCESS_TOKEN in the environment)
scripts/ansible-run.sh ansible-playbook \
  -i ansible/inventory/hosts.yml \
  ansible/playbooks/deploy-technitium-lxc.yml
```

## Operating Notes

- Trigger an approved sync inside the LXC: `systemctl start technitium-sync.service`; coordinate the transition guard first.
- Inspect a run: `journalctl -u technitium-sync.service --no-pager -n 200`.
- Confirm the timer: `systemctl list-timers technitium-sync.timer`.
- Update the SOA serial in `zones/owl.red.zone` whenever the zone changes.
- Keep VLAN 10 reservations in `dhcp-reservations.json` aligned with `README.md`.

## Device Allocation And Migration

- Keep target allocations aligned across the registry, zone, root README, and
  [MAC inventory](../../docs/mac-inventory.md). Recorded addresses are not fresh
  evidence of VLAN membership.
- The tablet is staged at `10.0.20.12` with `status: pending` and lease MAC `TBD`.
  Verify its MAC on the target SSID before confirming the reservation and adding
  `tablet.owl.red` to DNS. Do not replace the current SSH/ADB endpoint prematurely.
- The work laptop remains in VLAN 20 `dynamicClients`; do not assign a fixed lease
  or a static DNS record to it.
- A reservation only controls a lease within a scope. Before an approved cutover,
  establish the matching switch-port/SSID VLAN, gateway, firewall rules, and a
  working management path. Validate camera local operation without internet and
  explicitly permit any Shield access to local media services.
- Publish desired-state changes only after approval; even a documentation-only
  push can trigger full live reconciliation. Check the
  sync result, actual reserved leases, DNS answers, and client lease renewal.
  Neither editing this repository nor adding a reservation moves a live client.
- The camera records previously listed VLAN 10 addresses. The sync only upserts
  declared reservations; it does not prune removed entries. Inspect and explicitly
  remove any legacy camera reservations during the approved migration.

Rollback: restore the previous reservation/record data, increase the SOA serial
again, and reconcile the approved revision. Explicitly remove any newly added
server-side reservations if abandoning the allocation; reverting JSON alone does
not delete them. Restore prior port/SSID policy and renew affected clients if a
live VLAN cutover was performed. No cutover is performed by this documentation.

## Validation

VLAN-local DNS and enabled scopes below are final-state checks, not preparation
requirements. During preparation verify expected disabled state and no offers.

| Check | Command | Expected |
|------|---------|----------|
| DNS (VLAN 10) | `dig @10.0.10.30 rancher.owl.red +short` | `10.0.10.201` |
| DNS (VLAN 20 local) | `dig @10.0.20.30 rancher.owl.red +short` | `10.0.10.201` |
| Authoritative flag | `dig @10.0.10.30 owl.red SOA` | `aa` set; inspect live serial and verify intended records, not literal source-serial equality |
| DHCP serving state | Technitium UI → DHCP → Scopes, plus real-client capture | Only approved migrated domains enabled; no competing offers; all five only after full handoff |
| Sync healthy | `systemctl status technitium-sync.service` and journal | Inspect warnings and verify actual settings/scopes/reservations; success alone is insufficient |

## Not Used Anymore

This bundle previously ran on Kubernetes (StatefulSet + Services + PVs + a zone-sync
CronJob) and a standalone `sync-zone.sh`. That path was retired in the LXC cutover
(ADR 013). There are intentionally no Kubernetes manifests here — only the
desired-state files consumed by the LXC sync.
