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
`10.0.10.30`. The authenticated follow-up verified OPNsense Dnsmasq as the live
LAN DHCP authority. The source below now prepares all Technitium scopes disabled
and a host activation lock; neither has been deployed or verified live. Do not
infer cutover readiness from reservations, source files or the target table.

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

The checked-in reconciler verifies DHCP serving state on every run. On a changed
repository SHA it also reapplies all four file types, even for documentation-only
commits. An unchanged SHA with matching serving state skips that full pass, not
the DHCP check. The previously audited binary skipped unchanged SHAs entirely;
it remains the live baseline until the Nix-host update is deployed.

| File | Applied via | Purpose |
|------|-------------|---------|
| `settings.json` | `/api/settings/set` | Server settings (forwarders, recursion, DNSSEC, TTL) |
| `zones/owl.red.zone` | `/api/zones/import` | Authoritative `owl.red` zone (BIND format) |
| `dhcp/scopes.json` | Scope settings plus `/api/dhcp/scopes/disable`, `/enable`, `/list` | Explicit desired serving state; current transition intent is disabled for all five |
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
2. Validate the scope manifest and Nix-owned `DHCP_ENABLE_ALLOWED` lock; reject enabled intent while the lock is false, missing scopes, or unmanaged enabled scopes.
3. Disable scopes with disabled intent and verify API read-back, including on an unchanged Git SHA.
4. Skip the full pass only when the SHA and desired serving state match. Otherwise, quiesce all managed DHCP scopes before updating settings, zones, scope properties and confirmed reservations.
5. Enable only explicitly requested scopes, only with host activation allowed, and only after data application succeeds. Verify serving state before recording the SHA.

Reservations are upserted (existing lease for a MAC is removed first, then re-added),
but absent entries are not pruned. In the prepared revision, a reservation API
failure aborts the sync before activation or SHA recording; the old running
script could warn and still record success. A full pass deliberately quiesces
managed DHCP, and a failure can leave it disabled: this is not a zero-downtime
DHCP update mechanism. Review that maintenance behavior before lifting the lock.
Zone import need not set the live SOA serial equal to the source serial; compare
intended records and inspect the live serial separately.

### Transition Safety

- All five checked-in scopes now have `enabled: false`. Lifecycle is separate
  from `scopes/set`: disable/enable calls require a matching `/list` read-back.
  Missing or non-boolean intent is rejected, not treated as an activation default.
- Nix sets `DHCP_ENABLE_ALLOWED=false`. A future approved handoff needs both the
  reviewed host lock lifted and explicit per-scope enabled intent in Git. The
  lock rejects inconsistent enabled intent before API writes; it is not an
  emergency stop for scopes already serving. To turn a managed scope off, set
  its desired `enabled` state false and verify reconciliation.
- Upstream scope creation defaults to enabled. The guarded sync therefore
  refuses missing scopes instead of creating one and briefly serving before
  disabling it. Fresh provisioning needs a separate IaC bootstrap with verified
  client-network isolation before normal reconciliation; no manual UI shortcut
  or automatic creation is implied.
- Before attaching reachable VLAN interfaces, validate the installed API version,
  deploy the prepared Nix sync with the activation lock false and disabled source
  intent, then read back state and prove no offers from a real LAN client,
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

### Guarded Rollout

The script is embedded in the Nix store. Publishing `sync.sh` does not replace
the running executable, and publishing disabled JSON alone does not fix the old
binary's lifecycle behavior. Stage the reviewed disabled intent, deploy the
Nix-host update with activation still locked, and verify the five existing
scopes disabled before any NIC/trunk exposure. Publishing itself can trigger
the old full sync and remains a reviewed operational action.

Rollback must retain disabled source intent and verified disabled scope state;
restoring the old script or setting the host lock false is not a DHCP shutdown.
Any future activation is part of the coordinated OPNsense authority handoff,
not a routine Git push. No publish, host rebuild, service start or live scope
change is performed by the offline work recorded here.

## Bootstrap Secrets

Secrets stay out of Git. The admin password and a least-privilege automation API
token are provisioned from Bitwarden Secrets Manager by the Ansible role
(`bootstrap.yml`); the token is written to `/etc/technitium/sync.token` inside the
LXC. The sync service skips silently until that token exists.
The token needs DHCP View and Modify permissions: lifecycle verification reads
`scopes/list` as well as updating/disabling scopes. Verify this on the installed
version before deployment; an API permission failure aborts the guarded sync.

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

Install and verify the applicable tools using
[Controller Setup And Tool Requirements](../../docs/guides/controller-setup.md),
including Nix daemon group/session access and the selected Nixpkgs input.

Run the network-free regression suite from the repository root:

```bash
bash nix/hosts/technitium/sync.test.sh
```

It uses fake Git/API commands and temporary state, not infrastructure credentials.
It covers disabled-state drift, the host activation lock, API/read-back failures,
activation ordering, missing scopes and idempotency. Offline tests do not prove
installed-version behavior, real DHCP isolation, or deployment readiness.
The [CI workflow](../../.github/workflows/security.yml) runs it as the
`Technitium DHCP lifecycle guard` job. A Nix build, including the packaged
script's ShellCheck gate, is still required before deploying the host update.
Local ShellCheck `0.9.0` and all 20 offline cases now pass. Nix `2.18.1` is
installed, but daemon-socket access remains blocked in the agent environment;
neither module evaluation nor a package/system build has been verified there.

VLAN-local DNS and enabled scopes below are final-state checks, not preparation
requirements. During preparation verify expected disabled state and no offers.

| Check | Command | Expected |
|------|---------|----------|
| DNS (VLAN 10) | `dig @10.0.10.30 rancher.owl.red +short` | `10.0.10.201` |
| DNS (VLAN 20 local) | `dig @10.0.20.30 rancher.owl.red +short` | `10.0.10.201` |
| Authoritative flag | `dig @10.0.10.30 owl.red SOA` | `aa` set; inspect live serial and verify intended records, not literal source-serial equality |
| DHCP serving state | Technitium UI → DHCP → Scopes, plus real-client capture | Only approved migrated domains enabled; no competing offers; all five only after full handoff |
| Sync healthy | `systemctl status technitium-sync.service` and journal | Inspect API/read-back errors and verify actual settings/scopes/reservations; success alone is insufficient |

## Not Used Anymore

This bundle previously ran on Kubernetes (StatefulSet + Services + PVs + a zone-sync
CronJob) and a standalone `sync-zone.sh`. That path was retired in the LXC cutover
(ADR 013). There are intentionally no Kubernetes manifests here — only the
desired-state files consumed by the LXC sync.
