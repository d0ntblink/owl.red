# Technitium DNS + DHCP (LXC, GitOps-synced)

**Approved handoff candidate (2026-10-17):** source intent now enables native,
private and IoT DHCP with VLAN-local DNS/NTP; guest stays disabled. Publication
and live activation are coordinated using the paused timer, retained lease map
and independent host lock. The source manifest is not proof of live authority;
require the [handoff acceptance](../../docs/guides/controller-setup.md#coordinated-vlan-dhcp-handoff).

Technitium runs as a NixOS LXC on `edge.pve` and is authoritative for `owl.red`.
Sole client DNS/DHCP service across five VLANs is the **post-cutover target**,
not the observed deployment. Keep the accepted VyOS client DNS/DHCP authority until supporting
VLAN paths and Technitium interfaces are ready and a coordinated handoff is
approved. See the [execution order](../../ROADMAP.md#execution-order),
[ADR 013](../../docs/decisions/013-technitium-single-resolver-all-vlans.md)
for the selected target and revisitable trade-offs, and
[ADR 010](../../docs/decisions/010-technitium-fleet-git-managed-dns.md) for the
Git-managed DNS model.

**Audit baseline (2026-10-14):** one untagged `10.0.10.30/24` NIC; VLAN 10 scope
disabled, scopes 20-50 enabled, zero leases, and every scope reporting DNS
`10.0.10.30`. The authenticated follow-up verified OPNsense Dnsmasq as the live
LAN DHCP authority.

**Guard-only rollout (2026-10-15):** the approved Nix-host update and guarded
reconciliation are deployed. All five scopes read back disabled, with zero
leases and `DHCP_ENABLE_ALLOWED=false`. DNS remains healthy without a process
restart; addresses and routes are unchanged. Client DNS/DHCP stays on OPNsense.
Native-LAN no-offer checks passed before and after a sync-unit restart on
2026-10-15: the wired probe reached Technitium and only OPNsense offered.
An approved daemon restart subsequently preserved all five disabled scopes
before reconciliation and passed the same native-LAN check. That daemon-only
rollout did not cover whole-container boot, IPv6 or unattached VLANs, and did not
attach any NICs or trunks.

**VLAN-20 DNS path accepted (2026-10-17):** Terraform stage 1 preserves untagged
`eth0` at `10.0.10.30/24` and adds only tagged `eth1` at `10.0.20.30/24`, with no
second default gateway. The provider-required CT200 restart was explicitly
approved. The existing guarded switch owner adds edge port 24 only to VLAN 20;
native management and operator port 22 are unchanged. The refreshed CT-only
Terraform plan has zero changes.

Nix permits DNS TCP/UDP 53 but restricts SSH 22 and admin API 5380 to native
`eth0`; DHCP UDP 67 remains closed. The conflicting systemd-resolved IPv4 stub
is disabled while its upstream resolver file keeps OS lookups working.
A disposable VLAN-20 client passed internal/public UDP DNS and TCP 53
connectivity; SSH/admin connections timed out. All five scopes still read back
disabled, `DHCP_ENABLE_ALLOWED=false`, no UDP 67 listener and native API healthy.
No real-client DNS/lease change, new DHCP wire-offer proof, IPv6 qualification or
authority handoff is claimed. VyOS remains the client DNS/DHCP authority.
See [controller requirements and scope](../../docs/guides/controller-setup.md#technitium-vlan-dns-preparation).

**Active IoT DNS paths accepted (2026-10-17):** the separately approved next
batch added VLAN 40/50 NICs with one CT200 restart. Current stage 3 is native
`eth0` plus tagged `eth1/eth2/eth3` on VLANs 20/40/50; guest 30 stays detached.
Stage ordering is active-first 20/40/50/30. The existing native/private NICs,
sole native default route and other hardware are preserved. The refreshed
CT200-only plan with the accepted default has zero changes.

Disposable wired clients passed internal/public UDP DNS, TCP 53 connectivity
and blocked SSH/admin to `10.0.40.30` and `10.0.50.30`. The guarded switch owner
keeps edge port 24 on each IoT row and removes temporary cp1 port 2 after testing.
Native DNS/API and OS DNS recovered after boot, with all five scopes disabled,
activation lock false and no UDP 67 listener. Client DNS/DHCP remains on VyOS;
new DHCP wire-offer/renewal, guest and IPv6 acceptance are not claimed.
Private evidence: `~/.local/state/owl-red/technitium-vlan-iot-OFZ7pw`.

## Quick Reference

| Item | Value |
|------|-------|
| Placement | NixOS LXC (VMID 200) on `edge.pve` (`10.0.10.3`) |
| Hostname | `ns1.owl.red` |
| DNS authority | `owl.red` authoritative zone now; target client DNS uses VLAN-local `10.0.x.30` after handoff |
| Management IP (native, untagged) | `10.0.10.30` |
| Accepted private VLAN-20 DNS path | `10.0.20.30`; not yet advertised to clients |
| Accepted IoT VLAN-40/50 DNS paths | `10.0.40.30` / `10.0.50.30`; not yet advertised to clients |
| Web UI | `https://dns.owl.red` (Traefik ingress → `10.0.10.201`) |
| DHCP authority | VyOS currently; all five Technitium scopes disabled until approved per-domain handoff |
| DHCP ranges | `10.0.x.100–199` per VLAN |
| Sync engine | `technitium-sync.service` + `.timer` (boot+3min, then every 15min) |
| Sync source of truth | this directory (`gitops/technitium/`) |

## Desired-State Files

The checked-in reconciler verifies DHCP serving state on every run. On a changed
repository SHA it also reapplies all four file types, even for documentation-only
commits. An unchanged SHA with matching serving state skips that full pass, not
the DHCP check. The previously audited binary skipped unchanged SHAs entirely;
it was replaced by the approved guard-only rollout, not a DHCP authority handoff.

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
but absent entries are not pruned. In the guarded reconciler, a reservation API
failure aborts the sync before activation or SHA recording; the previous
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
  verify the guarded Nix sync with the activation lock false and disabled source
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
| LXC lifecycle (staged target five NICs; observed four) | Terraform — `terraform/proxmox/technitium/technitium-lxc.tf` |
| OS + Technitium + sync service | NixOS — `nix/hosts/technitium/configuration.nix` |
| Admin account, API token, first sync trigger | Ansible — `ansible/roles/technitium_lxc/`, played by `ansible/playbooks/deploy-technitium-lxc.yml` |
| DNS / DHCP desired state | This directory |

### Guarded Rollout

The script is embedded in the Nix store. Publishing `sync.sh` does not replace
the running executable, and publishing disabled JSON alone does not fix the old
binary's lifecycle behavior. Stage the reviewed disabled intent, deploy the
Nix-host update with activation still locked, and verify the five existing
scopes disabled before any NIC/trunk exposure. Publishing itself can trigger
a full sync and remains a reviewed operational action.

The existing Ansible role exposes `technitium_nixos` for a reviewed Nix-host-only
update. Preview the selected tasks without connecting or applying:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/deploy-technitium-lxc.yml \
  --limit technitium --tags technitium_nixos --list-tasks
```

This excludes credential bootstrap and the explicit zone-sync stage; an untagged
run still includes them. The tag is not a dry-run mode: removing `--list-tasks`
activates NixOS. `technitium_update_nix_channels` defaults false; enabling it is
a separate reviewed input/package upgrade. Any nonzero rebuild result now fails
the role instead of treating exit code 4 as success. Omitting the explicit sync
stage also means activation alone is not proof that the new guard has run.

For a connected, non-activating preview, replace `--list-tasks` with `--check`
using the reviewed SSH route. The asynchronous rebuild explicitly skips in
check mode; file tasks report would-change results. This checks deployment
access, not the build, activation or serving-state acceptance.

Before approved activation, privately retain the current system generation,
affected Nix files and DHCP state with the exact recovery procedure. Afterward,
run only the approved reconciliation and verify scope state/no offers before
new NICs or trunks.

**Preparation evidence (2026-10-15T04:17:01Z):** affected Nix files and private
DHCP state were saved outside Git with directory mode `0700` and file mode
`0600`; saved file hashes match the live originals. The current generation is
retained by a system-profile link and its rollback executable exists. Strict
host-key SSH through `edge.pve` / `pct exec 200` and the connected Ansible
`--check` preview pass. Private recovery instructions identify the exact previous
generation and source-file restore commands. Recovery access and artifacts were
verified, but rollback itself was not executed.

**Approved activation/read-back (2026-10-15T04:25:44Z):** the Nix-host-only
Ansible update completed with channel updates disabled. The reviewed system
generation is running and the deployed sources match local hashes. The approved
guard run at 04:24:14Z returned success/0 on the unchanged applied Git SHA;
all five scopes read back disabled. Scope properties/reservations are unchanged,
leases remain zero, and the timer is active. DNS retained its original process
ID; internal/external queries through Technitium and external queries through
OPNsense pass. Packet acceptance was still pending at this activation-only
checkpoint; the later native-LAN evidence is recorded below.

Rollback must retain disabled source intent and verified disabled scope state;
restoring the old script or setting the host lock false is not a DHCP shutdown.
Enabling DHCP later is part of the coordinated OPNsense authority handoff, not a
routine Git push. This rollout did not publish Git, update channels, rotate
credentials, change client DNS/DHCP authority, or touch NICs, VLANs, masks or NAS
settings.

### Daemon-Restart Persistence Check

This is a separately approved service-interruption test, not a container reboot
or a configuration deployment. Direct Technitium DNS/API consumers can see a
brief interruption even while OPNsense remains the client authority.

1. Verify the current generation, disabled API state, on-disk scope flags and
  DNS health. Privately retain the existing scope files and their hashes;
  exclude authentication files and API tokens. Version 14.0.0 loads the enabled
  flag from each saved scope, so API state alone is not persistence evidence.
2. After approval, pause the sync timer and verify the oneshot is idle. Recheck
  the baseline immediately before restarting only
  `technitium-dns-server.service` through the independent Proxmox access path.
3. Read back startup scope state before running any reconciliation. A guard run
  must not hide a persistence failure. Verify DNS/API health, unchanged network
  state and a new healthy daemon PID, then repeat the bounded native-LAN packet
  check with the retained synthetic client identity.
4. Restore the timer after acceptance. On failure, inspect actual service and
  scope state before recovery; keep disabled intent and use only the freshly
  saved disabled-state files if a restore is justified. Never restore the older
  enabled-scope baseline, reset credentials, rebuild the host or reboot the LXC
  as an automatic recovery step.

**Observed (2026-10-15T05:06:44Z through 05:15:32Z):** all five actual version-9
scope files had explicit disabled flags and were captured privately with
verified hashes before approval. Recent direct DNS use included `10.0.10.174`;
the user approved the daemon-only interruption after that impact was disclosed.
The reviewed system generation was unchanged. Git had advanced normally to
`faa2b41f9ce62ac0bb012a7631a24ed4000e8439`; it matched checkout/last-success and
was rechecked before the isolated test.

After restart, the new daemon PID `548888` was healthy and the existing API
token still worked. All five scopes loaded disabled, all five file hashes
were unchanged, zero leases and no UDP 67 listener were observed. The timer
remained paused and the sync invocation/start time were unchanged throughout
startup and packet acceptance, so no reconciliation masked persistence.

The post-daemon native-LAN probe at 05:13:44-05:14:01Z reached both capture
points with transaction `0x1e995223`. Each capture contains one DISCOVER and
one OPNsense offer, with zero kernel drops and no Technitium offer. Native
scope policy permits dynamic and locally administered clients, so those filters
did not explain the negative result. DNS/API, system generation and client/LXC
networking passed final checks; the timer was restored. No rollback, settings
change, credential rotation, package update or LXC reboot was needed. This
does not certify container boot, future VLAN paths, IPv6 or client handoff.

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
node --test scripts/capture-dhcp-authority.test.mjs
nix-build nix/hosts/technitium/check.nix -A sync --no-out-link
nix-build nix/hosts/technitium/check.nix -A system --no-out-link --max-jobs 2 --cores 2
```

It uses fake Git/API commands and temporary state, not infrastructure credentials.
It covers disabled-state drift, the host activation lock, API/read-back failures,
activation ordering, missing scopes and idempotency. Offline tests do not prove
installed-version behavior, real DHCP isolation, or deployment readiness.
The [CI workflow](../../.github/workflows/security.yml) runs it as the
`Technitium DHCP lifecycle guard` job. A Nix build, including the packaged
script's ShellCheck gate, is a pre-deployment requirement. The
[check expression](../../nix/hosts/technitium/check.nix) pins the validation input
and evaluates the actual host module with preparation-state assertions. Its
packaged sync and full LXC system targets passed locally with Nix `2.18.1` on
2026-10-14, alongside both standalone and packaged ShellCheck and all 20 offline
cases. For stale process group membership, use the documented single-command
`nix-users` invocation in the controller guide.

The validated system, now running after the approved guard-only rollout, is
`/nix/store/mh6gmm695f46k9xbharpsmpm7qshax4h-nixos-system-unnamed-lxc-proxmox-25.11.10830.d7a713c0b7e4`.
Pre-deployment comparison confirmed that its input matched the previous LXC
generation. Each closure had 582 paths; only the sync executable, sync unit and
three aggregate wrappers differed. The Technitium 14.0.0 package, .NET 9.0.15
runtime and DNS unit were identical. The only host-module change was the
activation-lock line. Deployed source hashes and the running generation now
match the reviewed local candidate exactly.

The actual running DNS unit is
`technitium-dns-server.service`; `dns.service` is not present. GET API checks
confirmed version 14.0, DHCP View/Modify permissions, five existing scopes and
zero leases. The matching
[14.0.0 API documentation](https://github.com/TechnitiumSoftware/DnsServer/blob/v14.0.0/APIDOCS.md#dhcp-api-calls)
documents the separate scope lifecycle calls. The approved guarded run disabled
VLANs 20-50 and retained VLAN 10 disabled, verified by API read-back. DNS process,
scope properties, addresses and routes were preserved. The subsequent native-LAN
packet checks below passed; daemon persistence was separately verified above.
Future-VLAN or whole-container boot acceptance must not be inferred from either.

### Native-LAN Packet Acceptance

Use the [capture controller](../../scripts/capture-dhcp-authority.mjs) with the
[documented prerequisites](../../docs/guides/controller-setup.md#dhcp-packet-acceptance-requirements).
It starts bounded, non-promiscuous captures at both the physical LAN client and
Technitium's existing interface, then sends one Nmap DHCPDISCOVER only after both
are ready. It never releases or accepts a lease or changes interface settings.
The capture coordinator has seven network-free regression cases.

From the repository root, with one reviewed unused synthetic MAC retained in
`probe_mac` and a new private evidence path in `output_dir`:

```bash
node scripts/capture-dhcp-authority.mjs \
  --client-host 10.0.10.11 --client-interface vmbr0 \
  --observer-host 10.0.10.3 --container-id 200 --observer-interface eth0 \
  --identity "$HOME/.ssh/id_ed25519_owl_ansible" \
  --client-mac "${probe_mac:?select and retain one synthetic client MAC}" \
  --expected-server 10.0.10.1 --forbidden-server 10.0.10.30 \
  --output-dir "${output_dir:?use a new private evidence directory}"
```

An `EVIDENCE_READY_PACKET_REVIEW_REQUIRED` result is not a no-offer pass. Review
the retained PCAPs with tcpdump, correlating the same synthetic client identity
and transaction at both capture points. Require the OPNsense offer as a positive
control and no Technitium offer. Silence or missing ingress visibility is
inconclusive. Reuse the same MAC for the approved post-sync-unit-restart phase;
restarting the DNS daemon or LXC is not implied. This checks the existing
untagged LAN only, not unattached target VLANs or real-device renewal/handoff.

**Observed (2026-10-15T04:46:42Z through 04:51:04Z):** both phases passed packet
review. One synthetic client identity was reused; matching DISCOVER/OFFER
transactions were visible on `cp1/vmbr0` and inside Technitium's existing `eth0`.
Only OPNsense `10.0.10.1` offered, with no Technitium offer. Every capture contains
two packets and zero kernel drops. The second phase followed a successful
same-SHA restart of `technitium-sync.service`, not the DNS daemon.

The offers advertised mask `255.255.0.0`, gateway/DNS `10.0.10.1` and a
`86400`-second lease. The offered address was not requested or accepted; offers
can still create a temporary server-side hold. Post-test checks confirm five
disabled scopes, zero Technitium leases, the original DNS PID, healthy DNS and
unchanged client/LXC addressing. Private PCAP/XML, decoded traces and hashes are
retained outside Git. DNS-daemon/LXC restart, DHCPv6/RA, target VLANs and real
client renewal/handoff were not tested.

The later [daemon-restart check](#daemon-restart-persistence-check) adds isolated
startup persistence and another native-LAN packet result. It does not extend
the result to container boot or unattached target VLANs.

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
