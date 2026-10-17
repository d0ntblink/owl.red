# Issue 008: Live Infrastructure Vs Repository Audit

**Observed:** 2026-10-14 America/Edmonton; final probes 2026-10-15T01:12:15Z.
**Repository revision:** `ae74c6011d6c37f7cdced8466b31adc3989b2df8`.
**Status:** Read-only assessment; no infrastructure remediation performed.

This records live observations, not an assertion that the target architecture is
deployed. No apply, import, lease renewal, service restart, reboot, disk test,
repair, DNS edit, secret rotation, or commit/push was performed by this audit.
Credentials and private configuration values are deliberately omitted.

## Coverage

| Surface | Checks performed | Limits |
|---------|------------------|--------|
| Proxmox | All 6 hosts; all 8 guests; quorum, hardware, sizing, networking, storage, HA, backups, time, NIC mitigation, watchdogs | No failover, reboot, or restore tests |
| Talos/Kubernetes | All 4 nodes; etcd and health checks; live network/time fields; workloads, placement, PDBs, storage, ingress, certificates, Fleet and secret CR status | No upgrade or disruption tests |
| Technitium | LXC interfaces/services/timer; settings, zones, all 5 scopes, leases, and exact reservation comparison | No client renewals or DHCP packet capture |
| CSS326 | Authenticated read of identity, ports, port-VLAN policy, VLAN table, SNMP and SFP metadata | Library speed labels are inaccurate; learned-host query returned no usable entries |
| Unraid | SSH; version, network, array counters/slot metadata, mounts/capacity, exports, containers, GPU, NTP, Tailscale and UPS process presence | No disk tests, file-data inventory, array changes, or application-secret reads |
| PDM | LXC placement, OS, packages, addresses and service health | No authenticated PDM remote inventory |
| Cloudflare | Authenticated zone/DNS read; all 13 records enumerated; public DNS comparison | DNS token access does not establish Access/Tunnel configuration coverage |
| OPNsense | VM shell/passthrough, management HTTPS, and actual DNS answers | Authenticated firewall/interface/NAT/portal/API-user inspection blocked |
| AP, BMC, PDU, tablet | Network/management reachability and switch-link observations | AP unreachable; BMC/PDU login and tablet identity not verified |

## Priority Findings

1. **Internal DNS is inconsistent.** Technitium answers internal names correctly,
   but the gateway resolver returns NXDOMAIN. Kubernetes forwards to node
   resolvers that include the gateway and public DNS; a real pod received public
   answers or ENOTFOUND for internal names. This is a functional fault, not just
   a documentation discrepancy.
2. **GitOps has not fully converged.** Fleet has 7 of 9 owl.red bundles ready.
   Traefik is WaitApplied with different desired/applied deployment IDs; the
   resilience bundle reports that `fleet-local/fleet-agent-local` is not owned by
   it. Running Traefik still has cluster-wide backend TLS verification disabled.
3. **TLS is incomplete.** Only `dns.owl.red` presented a trusted certificate in
   these checks. Rancher, Homepage, Traefik and PDM presented Traefik's default
   self-signed certificate. Rancher's HTTP-01 issuance is pending.
4. **Recoverability is not established.** Proxmox has no configured backup or
   replication jobs and no backup objects on any node's registered `local`
   storage. PBS is absent. This does not prove that no manual/off-platform
   backups exist; those were not inventoried or restore-tested.
5. **The cluster Terraform root cannot currently parse.** The five inline
   `network_interface` blocks in the Technitium LXC resource contain comma-
   separated arguments. Terraform rejects them before even listing state.
6. **VLAN isolation and shared storage remain unfinished.** Live host networking
   is flat /16; switch port policy remains PVID 1; Technitium has one NIC. There
   is no shared Proxmox storage or Kubernetes StorageClass/PV/PVC.

## Proxmox

The `owl-red` cluster is quorate with all six nodes online. Every host runs
Proxmox VE `9.2.3`; no failed systemd units or reboot-required marker were found
in the host checks. These are health observations, not restore guarantees.

| Guest | Actual placement | Actual allocation | Notes |
|-------|------------------|-------------------|-------|
| 100 `edge.owl.red` | VM on `edge` | 4 vCPU, 12 GiB, 64 GiB | Running, protected; two PCI passthrough devices; pinned router |
| 101 `nas.owl.red` | VM on `storage` | 6 vCPU, 24 GiB, 32 GiB virtual disk | Running, protected; 4 PCI devices, USB gadget, EFI and TPM |
| 200 `technitium` | Privileged LXC on `edge` | 1 vCPU, 2 GiB, 8 GiB | Running; only net0, no VLAN tag |
| 231 `pdm` | Unprivileged LXC on `cp1` | 2 vCPU, 4 GiB, 20 GiB | Running; local-lvm, strict cp1-only HA affinity |
| 601 `cp1-talos` | VM on `cp1` | 2 vCPU, 10 GiB, 40 GiB | Running |
| 602 `cp2-talos` | VM on `cp2` | 2 vCPU, 10 GiB, 40 GiB | Running |
| 603 `cp3-talos` | VM on `cp3` | 2 vCPU, 10 GiB, 40 GiB | Running |
| 604 `worker1-talos` | VM on `worker1` | 4 vCPU, 12 GiB, 40 GiB | Running |

- All hypervisor management addresses are still /16. Their bridges show native
  VLAN 1, not the planned tagged/native VLAN 10 design.
- Only `local` directory storage and `local-lvm` thin storage are registered.
  Both are active on every node; neither is shared.
- PDM's HA resource is started, but `pdm-temp-node-affinity` permits only cp1.
  This is not cross-node failover. Its root disk is not shared.
- The README still calls PDM a VM on storage and Unraid bare metal. Both
  descriptions contradict live guest placement.
- Actual Talos allocations agree with Terraform but not the README's 6 GiB /
  60 GiB control-plane and 8 GiB / 100 GiB worker descriptions.
- cp1 carries a 10 GiB Talos VM and 4 GiB PDM LXC on a roughly 16 GiB host;
  account for hypervisor headroom before adding workloads.
- The edge CPU is an i3-8100, not the README's i3-8300. Storage HBAs identify as
  SAS3008, and its passed-through 10G NIC is 82599ES, not X710.
- Storage management is an active-backup bond, currently obnic0. Both physical
  links report 1 Gb/s. The active bridge/bond MAC ends in `f0`; the reservation
  registry uses the other physical MAC ending in `f1`. The address is currently
  statically configured, so this is not evidence of a present DHCP failure.
- The gateway's observed LAN MAC is `6c:fe:54:70:08:31`; the registry still
  records the historical `90:e2:ba:0c:44:95` interface. Verify/reconcile static
  appliance identities before relying on reservations during recovery.
- The NAS USB gadget service is active. `dummy_hcd` is installed for the active
  kernel and other installed kernels; active-kernel headers are present.

### IaC Ownership

Filtered local state metadata confirms ownership of Technitium, all four Talos
VMs, Talos configuration/bootstrap resources, and NAS VM 101. State contents and
key material were not printed.

The cluster root's parse failure is in
[technitium-lxc.tf](../../terraform/proxmox/technitium/technitium-lxc.tf#L81).
No local state file was found in the OPNsense-VM or PDM scaffold roots, consistent
with their documented pending imports. None was found for the empty OPNsense
configuration root or Unraid settings root either; an empty root need not create
state, and this alone does not prove that state is absent on other controllers.

## Network, DNS And DHCP

### Switching And AP

- The switch is the expected CSS326 at `10.0.10.2`, running SwOS `2.18`, with
  identity and port names matching the repository.
- Every port is `Optional`, accepts `Any`, and has default VLAN ID 1 with no
  forced VLAN ID. Access/trunk isolation is not implemented by these settings.
- VLANs 10, 20, 30, 40 and 50 each list only port 5 as a member. Port 5 is
  disabled/unpatched; management is connected on port 24. The same stale
  membership exists in [css326.yml](../../ansible/switch_configs/css326.yml).
- Port 18 (`ap.owl.red`) is enabled but has no link. HTTP/SSH to `10.0.10.40`
  failed, including HTTP from edge.pve; its ARP entry remained incomplete.
- Do not report slow links from this library's labels: it returned 100M for
  host links whose own ethtool reports 1000 Mb/s, and 1G for the NAS link whose
  own ethtool reports 10000 Mb/s. This is a collection/decoding discrepancy.
- The library's learned-host query returned an empty list despite known live
  traffic. It is not evidence that the switch has no learned clients.

### Technitium

- NixOS `25.11` LXC 200 has only `10.0.10.30/24` on eth0. The other four planned
  VLAN NICs and local resolver IPs are absent; queries to those resolver IPs
  timed out from the runner.
- DNS and the sync timer are active. The sync's last SHA and its local checkout
  match audited revision `ae74c60`; no manual sync was triggered.
- The `owl.red` zone is authoritative and enabled. Direct queries to Technitium
  return the expected ingress VIP and the five newly allocated device records.
  The tablet correctly remains NXDOMAIN. `captive.owl.red` also returns NXDOMAIN,
  so the documented guest portal hostname is not ready.
- All **26** confirmed reservations match the registry exactly: no missing,
  extra, or mismatched entries across the five scopes. This does not mean that
  any client has joined its target VLAN or received that lease.
- VLAN 10's scope is **disabled**, although source data requests enabled. The
  other four scopes report enabled. All use /24 masks and pools .100-.199.
- All scope-detail responses currently report DNS server `10.0.10.30`, rather
  than the VLAN-local .30 addresses described in the target plan.
- The DHCP leases endpoint returned zero leases. Technitium is therefore not
  demonstrated as the live DHCP authority serving the current client population.
- API token handling used the existing token file inside the LXC; it was not
  copied into this report or terminal output.

### Resolver Failure Path

| Query source | `rancher.owl.red` / `dns.owl.red` / `home.owl.red` |
|--------------|-------------------------------------------------|
| Technitium `10.0.10.30` | Authoritative answers: `10.0.10.201` |
| Gateway `10.0.10.1` | NXDOMAIN for all three in direct checks |
| Existing Homepage pod via `10.96.0.10` | Rancher/Homepage public A answer; DNS UI ENOTFOUND |

Talos nodes use `[10.0.10.1, 1.1.1.1]`. CoreDNS forwards to `/etc/resolv.conf`.
Most PVE hosts and the NAS also use the gateway resolver; storage.pve uses
Technitium. Correct resolution on the operator machine is not proof of correct
resolution inside workloads.

### Public DNS

Cloudflare is authoritative and its zone is active. All 13 DNS records were read
with the scoped DNS token; TXT values were deliberately not collected.

- `*.owl.red` is an **unproxied A record** to `3.98.120.92`.
- Arbitrary nonexistent names and internal service names resolve through it.
- No tunnel CNAME was present in the DNS record inventory. This does not prove
  that no tunnel exists in a separate account/control plane.
- MX records still point to Proton Mail; SMTP2GO and Proton DKIM-related records
  are present. No self-hosted mail deployment was found in the inspected guests
  or Kubernetes workloads.
- The wildcard conflicts with [ADR 012](../decisions/012-cloudflare-tunnel-no-inbound-port-forwarding.md).
  Its public answer alone is **not proof** that the home WAN or LAN is exposed.

## Kubernetes, Ingress And Secrets

- All four nodes are Ready with no reported memory, disk or PID pressure.
  `talosctl health` passed etcd consistency, apid, kubelet, boot completion,
  control-plane components, node readiness, kube-proxy and CoreDNS readiness.
- etcd has the expected three non-learner members. The VIP was observed on cp2.
- Live Talos and installer are `1.8.1`; source/attached ISO still pin `1.7.5`.
  Kubernetes is `1.31.1`; the audit client is talosctl `1.13.0` and warns about
  the server-version difference. No upgrade was attempted.
- Flannel and kube-proxy are 4/4; MetalLB has only the intended .200-.250 pool.
  Traefik's LoadBalancer owns `10.0.10.201`.
- There are no StorageClasses, PVs, PVCs or StatefulSets in the inspected cluster.
- Active pods were healthy; 42 terminal historical pods were also present.
  Historical Error/Completed entries must not be presented as 42 current outages.
- Rancher, MetalLB controller and Traefik are 3/3. Rancher and Traefik currently
  have two replicas on worker1 and one on another node; spread is preferred,
  not a demonstrated one-per-node guarantee.
- Fleet agent is **1 replica**, without the planned control-plane toleration.
  Its PDB asks for minAvailable 2 and permits zero voluntary disruptions.
- Fleet controller, gitjob, helmops and cert-manager components are single
  replicas. Homepage is single-replica as intentionally documented.
- The only NetworkPolicy found was Fleet's default-allow-all policy. No
  application segmentation guarantee was established by this inventory.

### Reconciliation And TLS

- Fleet watches the expected nine paths at the current commit, but only seven
  bundles are ready. Do not equate a current GitRepo SHA with an applied rollout.
- Traefik is WaitApplied and its desired/applied deployment IDs differ.
  The resilience bundle reports a Fleet-agent Bundle ownership conflict.
- Recent sampled Fleet log lines did not establish the precise Traefik failure
  cause; do not assume the older hash-mismatch incident is still the cause.
- Running Traefik includes `--serversTransport.insecureSkipVerify=true`, despite
  [SECURITY.md](../../SECURITY.md) and source values requiring only PDM's scoped
  exception. The PDM-specific ServersTransport also exists.
- No IP-allowlist middleware protects the Traefik dashboard. The observed
  middleware only normalizes its URL; firewall-level restriction was not verified.
- `dns.owl.red` serves a valid Let's Encrypt certificate through 2027-01-12.
  Rancher, Homepage, Traefik and PDM serve default self-signed frontend certs.
  Their HTTP routes respond when TLS verification is bypassed for inspection.
- Rancher's certificate Secret is missing, and its HTTP-01 challenge is pending
  with an internal DNS self-check failure. The intended DNS-01/wildcard model is
  not applied to these frontends. No wildcard Certificate object was found.
- Only the five expected human-input BitwardenSecret CRs remain, with
  SuccessfulSync=True and FailedSync=False. Historical 503 messages remain on
  False conditions; those messages alone do not establish a current outage.
- The Cloudflare CR records `lastSuccessfulSyncTime=2026-06-19T03:20:01Z`.
  Establish the operator's timestamp/update semantics before treating its old
  True condition as evidence of fresh retrieval or declaring sync broken.

## NAS, PDM, Time And Power

Unraid is **VM 101**, running `7.3.3`, not bare metal awaiting migration. The
passed-through GTX 1060 is visible with NVIDIA driver `580.178.04`.

- User storage is approximately 42 TB, 84% used; SSD pool 30% used, cache 1%.
- Array is started and a correcting parity check (`check P`) was running.
  Aggregate counters say one disabled/invalid slot, but all active device entries
  report DISK_OK. The disabled entry is empty **parity2**, grey/off; primary
  parity reports DISK_OK. This is not a demonstrated failed data disk and is not
  a reason to start a repair/rebuild from this report.
- NFS is disabled and no NFS listener was found. Multiple per-share NFS entries
  are public with empty host lists, including `system`. Restrict intended
  exports and exclude internal shares before enabling NFS.
- 17 of 20 containers are running: Reclaimerr, Plex, LibreSpeed, Bazarr,
  qBittorrentVPN, Tautulli, Seerr, Prowlarr, Sonarr UHD/FHD, Radarr UHD/FHD,
  DiskSpeed, FlareSolverr, Lidarr, speedtest-tracker and cloudflareddns.
  MusicBrainzPicard, slskd and soularr are Created, not running.
- Tailscale is already running on the NAS with an online node; MagicDNS is
  disabled. This does not establish the roadmap's management subnet/exit-node
  access or split-DNS requirements.
- PDM is LXC 231 on cp1, Debian 13, PDM packages `1.0.3`; both API services are
  active and its filesystem is 17% used. It is not a VM on storage.pve.
- NAS NTP points to `10.0.10.1`. All PVE hosts use public chrony sources instead;
  Talos reports time synchronized but has no explicit LAN time-server override.
- The CyberPower USB UPS is attached to storage.pve. No standard NUT server or
  monitor units were found on any PVE node. NAS NUT config says enabled, but no
  NUT processes, listener, or examined plugin/binary paths were found. Do not
  assume staged UPS shutdown/recovery is implemented from the config flag.
- IP-tag is active on all four compute hypervisors. The opt-in VM watchdog is
  active only on cp1, consistent with the intended single-controller deployment.
- All four compute NICs have EEE disabled with no advertised EEE modes; the
  documented kernel stability parameters are active. Host kernel versions differ
  (cp1 7.0.6-2, storage 7.0.2-6, remaining hosts 7.0.2-2).

## Access Gaps

- Password Manager still reported locked and rejected a non-interactive item
  read after the attempted one-time unlock. Secrets Manager worked throughout.
  No further password prompts or credential guesses were attempted.
- OPNsense HTTPS is reachable, but SSH timed out and authenticated API access was
  unavailable. Current interface assignments, firewall/NAT rules, DHCP authority,
  portal settings, WAN exposure and old-root-key revocation are **not verified**.
  The June survey must not be relabeled as a fresh firewall inspection.
- The AP is unreachable and port 18 has no link, so SSIDs, VLAN bridges and
  actual wireless client steering could not be inspected.
- BMC HTTPS and PDU HTTP are reachable; their authenticated settings, firmware
  and power policies were not inspected.
- The recorded tablet IP refused SSH on port 8022. Its current identity/IP/MAC
  cannot be established from that refusal; no ADB, Wi-Fi, reboot, or kiosk
  changes were attempted. The pending allocation remains appropriate.
- Camera operation, physical cable labels, battery runtime, audible alarms,
  restore integrity and actual VLAN isolation were not tested.

## Follow-Up: Authenticated Router Survey

**Observed:** 2026-10-14 America/Edmonton; API/DNS probes through
2026-10-15T02:44:54Z. **Repository baseline:** `f50da7f`.
This follow-up resolves the earlier API-access gap, not the network faults.
Router requests were GET-only; no configuration, lease, service, rule, resolver,
interface or VM change was applied. The original audit observations above remain
dated history.

### Vault Access Root Cause

The installed Bitwarden CLI `2026.4.1` reproduced
[upstream issue 20703](https://github.com/bitwarden/clients/issues/20703): a valid
password returned an 88-character session key, but subsequent status and
non-interactive item reads remained locked. Correct environment assignment and
explicit `--session` did not fix it; this was not evidence of a wrong password,
missing TOTP, or a session duration that needed extending.

The official Linux `2026.7.0` release was downloaded and its published SHA256
digest verified. Using a private, owner-only copy of the CLI profile, both
`status` and an actual dedicated router-item read succeeded in separate
processes. The installed binary and original profile were left unchanged; the
audit helper uses the isolated working CLI. The local credential file remains
Git-ignored and was restricted to mode `600`. No password, session key or API
credential is recorded here.

### Current Router Evidence

| Surface | Authenticated observation |
|---------|---------------------------|
| Version and interfaces | OPNsense `26.1.9`; LAN `ixl1` is up at `10.0.10.1/16`, with MAC `6c:fe:54:70:08:31`; WAN `igc0` is up; spare `ixl0` has no carrier. No VLAN devices are configured. |
| IPv4 routing | Connected LAN route is `10.0.0.0/16` on `ixl1`, with the default route through WAN. No target VLAN `/24` connected routes are present. |
| DHCP authority | OPNsense Dnsmasq is running on LAN. Kea is disabled. The configured dynamic range is `10.0.10.100` through `10.0.10.200`; range mask and lease-time fields are blank, not explicit `/24` settings. There are 16 lease records and eight host/reservation entries. Lease records are not proof every client is currently online. |
| Address evidence | All returned LAN lease addresses and LAN ARP entries are inside `10.0.10.0/24`; 25 ARP entries include WAN/self entries. This supports evaluating mask contraction, but cannot discover every offline/static client or prove client masks. |
| DNS ownership | Unbound is running on port 53; Dnsmasq DNS is on port 53053. Unbound has an enabled `owl.red` forward to `127.0.0.1:53053`, described as forwarding the default domain to Dnsmasq DHCP. No Technitium forward or Unbound host override was present in these responses. |
| DNS behavior | Router `10.0.10.1` returns NXDOMAIN for `rancher.owl.red`; Technitium `10.0.10.30` returns authoritative `10.0.10.201`. Both resolve `example.com`. This confirms a resolver-path fault, not a Technitium authoritative-zone failure. |
| Aliases/filter coverage | Seven alias results are built-in/internal tables, not seven custom aliases. The automation filter search returns zero rules; this does not mean the classic or effective firewall is empty. Runtime rule labels include default LAN IPv4/IPv6 allow rules, WAN bogon/private blocks, DHCP rules and anti-lockout. Full classic-rule semantics remain to be captured. |
| Inbound NAT | One configured enabled IPv4 TCP WAN rule, `Plex Media Server`, forwards WAN port `32400` to `10.0.10.5:32400`, with source `any` and pass enabled. Anti-lockout redirect entries are separate built-ins. No external reachability test was performed; configuration is not proof of reachability. Do not remove the rule without reviewing the intended Plex exception to ADR 012. |
| Other NAT/portal | API searches returned no explicit source-NAT or one-to-one rules and no captive portal zones. The legacy automatic outbound-NAT mode was not established by these empty lists. |
| IPv6 | The live route table has a WAN IPv6 default and a global LAN `/56` connected route. Dnsmasq's RA enable flag is set; the separate radvd status endpoint reports `unknown`. Actual RA/DHCPv6 advertisements, client behavior and IPv6 policy need explicit checks before segmentation. |

### Transition Implications

- Preserve OPNsense Dnsmasq DHCP and Unbound client DNS during preparation.
  Any interim DNS repair would be a separately approved change to the existing
  OPNsense path, not an early client/CoreDNS switch to the final design.
- The live DHCP pool includes `.200`, inside the existing MetalLB
  `.200-.250` allocation range. Reconcile that overlap before allocating or
  migrating addresses; no conflicting `.200` lease was observed in this snapshot.
- Keep the eight current OPNsense reservations in the handoff/rollback map,
  not just the 26 Technitium target records. The storage-host entry is named
  `nas.pve.owl.red` at `.4`; the NAS lease/reservation MAC differs from its ARP
  MAC at `.5`. The workstation appears under multiple MACs, and the work-laptop
  lease uses a different MAC from the target registry. Verify identities and the
  operator's actual NIC before moving or pruning anything; none of these alone
  proves a duplicate IP.
- Prefer evaluating mask-only contraction on the current untagged L2 before
  routed target VLANs, subject to the remaining client/static-address and
  recovery checks. IPv6 and existing Plex access must be part of that design,
  not silently disabled or bypassed.
- Remaining prerequisites include the affected configuration export/restore
  method, independent router/switch recovery, full legacy filter/outbound-NAT
  settings, current root-key status, real-client DHCP options and actual AP
  cabling/bridges. No Terraform import, plan or apply was run.

## Follow-Up: Technitium Guard Candidate Comparison

**Observed:** 2026-10-14 America/Edmonton; read-only probes through
2026-10-15T03:58:39Z. Existing key-based SSH to `edge.pve` and `pct exec 200`
provided the inspection path without a vault prompt. No target file, service,
channel, API setting, scope or network was changed.

| Surface | Evidence |
|---------|----------|
| Running input | NixOS `25.11.10830.d7a713c0b7e4`, revision `d7a713c0b7e47c908258e71cba7a2d77cc8d71d5`; root's existing 25.11 channel source has the same revision. |
| Running software/units | Technitium API `14.0`, package `14.0.0`, .NET runtime `9.0.15`; `technitium-dns-server.service` active, sync service idle and timer active. `dns.service` does not exist; that earlier service label was inaccurate. |
| Current data versus runtime | Checkout and last-success SHA both `4259cec79c1d2e6d4e22f21e7ffbc9dfa22cb53d`; all five checked-out scopes have disabled intent. API still reports VLAN 10 disabled, VLANs 20-50 enabled with interface address `0.0.0.0`, and zero leases. The old packaged script only sets scope properties and skips unchanged SHAs. |
| Permissions/API contract | GET checks confirm DHCP, Settings and Zones View/Modify permission. The exact upstream `v14.0.0` documentation exposes the separate enable/disable/list calls; no mutating API call was used to test them. |
| Module drift | Removing only `environment.DHCP_ENABLE_ALLOWED = "false";` from the local module reproduces the live module's SHA256 exactly. No other host-module change is needed for this candidate. |
| Local candidate | Validation was repinned from the initial newer 25.11 input to the exact live revision and both packaged-sync and full-system builds passed. Candidate: `/nix/store/mh6gmm695f46k9xbharpsmpm7qshax4h-nixos-system-unnamed-lxc-proxmox-25.11.10830.d7a713c0b7e4`. |
| Closure delta | Live and candidate each reference 582 store paths. Exactly five are replaced: sync executable, sync unit, system-units, etc aggregate and system wrapper. All other paths match, including the DNS package, .NET runtime and DNS unit; this candidate does not include a DNS/OS package upgrade. |

The existing deployment role unconditionally updated channels and accepted
`nixos-rebuild` exit code 4. Local corrections now make channel updates explicit
opt-in, fail on any nonzero rebuild result, and expose the `technitium_nixos`
tag to isolate Nix-host tasks from credential bootstrap and explicit sync.
Syntax/task-selection checks pass; none of those tasks was executed remotely.
The original channel remains a mutable source unless independently pinned, so
opting out of updates does not remove the need to recheck its revision.

The previous running system generation and a working Proxmox inspection path
are identified, but affected-file/state capture and actual rollback rehearsal
were not performed. A build is not activation, and activation is not proof of
disabled scopes or absent offers. The guarded rollout and its acceptance gates
remain in the [Technitium guide](../../gitops/technitium/README.md#guarded-rollout)
and [roadmap](../../ROADMAP.md#15-subnet-migration-16--24-per-vlan).

## Follow-Up: Affected-State Capture And Check-Mode Preflight

**Observed:** 2026-10-15T04:13:10Z, refreshed at 04:17:01Z. Only read-only target
queries and a connected Ansible check-mode preview were performed. No source
file, system generation, channel, timer, DNS setting or DHCP scope was changed
by these operations.

- A private controller directory outside Git retains the two affected Nix source
  files, system/profile/input metadata and DHCP scope/lease state. Directory
  mode is `0700`, files `0600`; saved source hashes match the live originals.
  API tokens and private keys are excluded.
- The previous generation remains linked from a retained system profile, and its
  `switch-to-configuration` executable is present. Strict-host-key SSH to
  `edge.pve` and `pct exec 200` work without the LXC's network or DNS. The private
  recovery instructions name the exact generation and source-file restore
  commands; restoring previously enabled scopes is explicitly excluded. These
  are checked recovery prerequisites, not an executed rollback rehearsal or
  proof of independent router/switch recovery.
- The old running timer advanced the checkout/last-success SHA during
  preparation. At the refresh, upstream, checkout and last-success all equal
  `b03ca9baecf619e1518f6884de2710bccf517607`. Input and affected source hashes
  remain unchanged. All five source scopes are disabled; the API still reports
  VLAN 10 disabled and VLANs 20-50 enabled, with zero leases. The DNS process
  remains active with the original PID.
- The first connected `--check` preview exposed Ansible's refusal to combine
  check mode with an asynchronous task. The rebuild now explicitly skips when
  `ansible_check_mode` is true. The same preview then passed: only the two source
  copies reported would-change results; channel update, rebuild and API wait
  skipped. No target copy or activation was performed.

The next change needs explicit approval for the guard-only Nix-host activation
and disabled-intent reconciliation. Recheck this mutable baseline immediately
before applying. Client DNS/DHCP remains on OPNsense; NICs, VLANs, masks and NAS
settings remain outside that approval. Five-scope read-back and real-client
no-offer acceptance remain pending.

## Follow-Up: Approved Guard-Only Rollout

**Observed:** 2026-10-15T04:21:28Z through 04:25:44Z. The user explicitly
approved the Nix-host guard update and disabled-intent reconciliation, not a
client DNS/DHCP handoff or a NIC/VLAN/mask/NAS change.

| Surface | Result |
|---------|--------|
| Immediate preflight | Running generation, input, source hashes, serving state and upstream/applied SHA matched the approved baseline. Ansible resolves the existing Nixpkgs source correctly. The idle sync timer was paused before deployment. |
| Owning deployment | `technitium_nixos`-only Ansible update passed: `ok=6`, `changed=3`, `failed=0`, `skipped=1`. Channel update explicitly false; credential bootstrap and explicit sync stage excluded. |
| Activated system | Exact reviewed `/nix/store/mh6gmm695f46k9xbharpsmpm7qshax4h-nixos-system-unnamed-lxc-proxmox-25.11.10830.d7a713c0b7e4`; deployed source hashes match local files. Same `d7a713c0b7e47c908258e71cba7a2d77cc8d71d5` input and API 14.0. |
| Runtime guard | Unit uses the reviewed `/nix/store/r2s09mvma21y0v6w9yfx3685ahnlz2va-technitium-sync` package and `DHCP_ENABLE_ALLOWED=false`. Activation alone did not run the guard; scopes still showed the old state at that intermediate read-back. |
| Approved reconciliation | Started at 04:24:14Z; `Result=success`, `ExecMainStatus=0`. Checkout/last-success SHA remains `b03ca9baecf619e1518f6884de2710bccf517607`, so the unchanged-SHA lifecycle path was exercised. |
| Scope acceptance | At 04:25:44Z all five existing scopes read back disabled, leases remain zero, and scope-property/reservation responses are unchanged from preflight. |
| Preservation checks | DNS active with unchanged PID `297`; Technitium internal `rancher.owl.red -> 10.0.10.201` and external `example.com` queries pass. OPNsense external DNS query passes. LXC addresses and routes unchanged; timer active. |
| Recovery/evidence | Previous generation and owner-only affected-state artifacts retained outside Git. Private activation/reconciliation/acceptance evidence excludes API tokens and private keys. No rollback was needed or rehearsed. |

This completes the approved guard deployment and API serving-state check only.
No Git publish, channel update, credential rotation, client resolver change,
OPNsense authority change, NIC attachment, VLAN/mask change or NAS operation was
performed. Real-client no-offer acceptance, including after sync/restart, is
still required before exposing new interfaces. Existing router/cluster DNS and
other audit findings are not declared repaired by these scoped health checks.

## Follow-Up: Native-LAN DHCP Packet Acceptance

**Observed:** 2026-10-15T04:46:42Z through 04:51:04Z. Probes originated on
physical wired `cp1` (`10.0.10.11/16`, `vmbr0`), not WSL. Host tcpdump inside
LXC 200's existing network namespace observed `eth0` without adding interfaces
or installing anything in NixOS. Both capture points were ready before each
Nmap DISCOVER-only probe; one synthetic locally administered MAC was reused.

| Phase | UTC Window | Correlation / Result |
|-------|------------|----------------------|
| Existing guarded state | 04:46:42-04:46:58 | Transaction `0x611dc3df` visible at client and Technitium; one DISCOVER and one OPNsense offer at each point, zero drops, no Technitium offer. |
| After sync-unit restart | 04:49:13-04:49:26 | Transaction `0x3a257587` visible at both points with the same result. Only `technitium-sync.service` was restarted; unchanged SHA, success/0 verified at 04:48:51Z. |
| Wire DHCP options | Both phases | Server `10.0.10.1`, mask `255.255.0.0`, gateway/DNS `10.0.10.1`, lease `86400` seconds; offered `10.0.10.172` was never requested or accepted. DISCOVER can still create a temporary offer hold. |
| Preserved runtime | 04:51:04Z | All five scopes disabled, zero Technitium leases, activation locked, timer active; DNS PID `297` unchanged. Technitium internal/external and OPNsense external DNS probes pass. Client remains `.11/16` via `.1`; LXC addresses/routes and system generation unchanged. |
| Private evidence | Retained outside Git | Four complete PCAPs, each 751 bytes / two captured packets / zero kernel drops, plus XML, decoded matching traces, runtime evidence and integrity hashes; owner-only directories/files. |

An initial shared-terminal capture attempt produced only PCAP headers and no
completed probe result; it was rejected as inconclusive, not counted as a pass.
The reusable [controller](../../scripts/capture-dhcp-authority.mjs) now owns
readiness and bounded process cleanup in one process. Its
[seven offline cases](../../scripts/capture-dhcp-authority.test.mjs) cover unsafe
inputs, positive-control requirements, forbidden/unknown authorities, readiness
failure and header-only captures. The existing credential-free CI job runs
these cases with Node 24; all tool requirements are in the
[controller guide](../guides/controller-setup.md#dhcp-packet-acceptance-requirements).

**Acceptance boundary:** no Technitium offer was observed on the current
untagged IPv4 LAN in either bounded window, including after the sync-unit
restart. No REQUEST, ACK, RELEASE or real-device renewal/handoff was performed.
DNS-daemon/LXC restart persistence, DHCPv6/RA and unattached target VLANs are not
validated. No client DNS/DHCP authority, NIC, VLAN, mask, NAS or package change
was made; the only service operation was the explicitly described sync-unit
restart. Keep those remaining checks separate from this native-LAN result.

## Follow-Up: Approved Daemon-Restart Persistence

**Observed:** 2026-10-15T05:06:44Z through 05:15:32Z. Recent direct Technitium
DNS use included `10.0.10.174`; the user explicitly approved a daemon-only
restart after the DNS/API interruption risk was disclosed. No container reboot
or configuration deployment was authorized or performed.

| Surface | Evidence / Result |
|---------|-------------------|
| Saved scope preflight | All five actual version-9 scope files have explicit disabled flags matching the upstream 14.0.0 header/name/enabled layout. Scope-only snapshot and hashes saved privately; no authentication file or token copied. |
| Baseline | Reviewed `mh6gmm695f46k9xbharpsmpm7qshax4h` system unchanged; normal timer activity had advanced Git to `faa2b41f9ce62ac0bb012a7631a24ed4000e8439`, matching upstream/checkout/last-success before isolation. |
| Isolation | Idle sync timer paused at 05:10:47Z. Sync invocation `d4bfa638726446948a04fa363d0f9ada` and its 05:04:00Z start time remained unchanged through startup and packet acceptance. No manual reconciliation was run. |
| Daemon restart | Only `technitium-dns-server.service` restarted through Proxmox. API-port wait completed; startup API read-back at 05:13:14Z authenticated with the existing token. Old PID `297` replaced by healthy PID `548888`; no automatic crash restart. |
| Persistence | All five scopes loaded disabled before any reconciliation; all five scope files byte-identical, zero leases and no UDP 67 listener. Native scope policy permits dynamic and locally administered clients, excluding those filters as the reason for silence. |
| Packet acceptance | UTC 05:13:44-05:14:01, transaction `0x1e995223`: matching DISCOVER and only OPNsense offer at `cp1/vmbr0` and LXC `eth0`. Each PCAP is 751 bytes, two captured packets, zero kernel drops. No Technitium offer. Same synthetic identity reused; no REQUEST, ACK or RELEASE. |
| Final state | At 05:15:32Z timer restored active, activation locked, five disabled scopes, healthy DNS/API and unchanged reviewed system. Technitium internal/external and OPNsense external DNS checks pass; client/LXC addressing and routes unchanged. |
| Recovery/evidence | Private scope snapshot, startup/timer metadata, PCAP/XML, decoded traces and integrity hashes retained outside Git with owner-only permissions. No recovery restore, credential rotation, package/channel update or Git publish was performed. |

This verifies actual daemon-startup persistence and bounded IPv4 native-LAN
non-serving behavior without the sync guard masking a failure. It does not
claim a measured zero-interruption restart, whole-LXC boot, unattached target
VLANs, IPv6/RA policy or client renewal/handoff. No NIC, VLAN, mask or NAS change
was made. The existing router/cluster DNS findings remain separate.

## Follow-Up: Mask Inventory And Recovery Assessment

**Observed:** 2026-10-15 UTC, using read-only host commands and GET APIs. Current
network metadata is retained privately outside Git with owner-only permissions;
API keys, vault sessions, SNMP communities and appliance passwords are excluded.
No address, mask, lease, resolver, port, service, VM, NAS or power setting was
changed, and no Terraform plan/apply was run.

### Current Masks And Dependencies

| Surface | Current IPv4 / Gateway | DNS / Attachment Evidence |
|---------|------------------------|---------------------------|
| OPNsense LAN | `10.0.10.1/16`; connected `10.0.0.0/16` | `ixl1`, actual LAN MAC `6c:fe:54:70:08:31`; passthrough NICs, not the historical VM-vNIC assumption. LAN still has a global IPv6 `/56`. |
| PVE edge / storage | `.3/16`, `.4/16`, gateway `.1` | Runtime matches configured `vmbr0` CIDRs. Edge uses `onboard`; storage uses `bond0`. Storage DNS is already `.30`, edge DNS `.1`. |
| PVE compute | `.11-.14/16`, gateway `.1` | Runtime/configured `vmbr0` over `nic0`; DNS `.1`. Actual fourth cluster node name is `worker1`. |
| Corosync | `.3`, `.4`, `.11-.14` | Ring addresses match PVE management IPs; six nodes online and cluster quorate. Addresses must not be renumbered as part of a mask-only operation. |
| Talos node IPs | `.21-.24/16`, gateway `.1` | Native virtual NICs on the owning PVE `vmbr0`, no VLAN tags in guest definitions; DNS `.1` and `1.1.1.1`. All Kubernetes nodes Ready. |
| API VIP | `.20/32`, currently on cp2 Talos | Preserve the `/32`; it is separate from the node's `.22/16` address. |
| Traefik / MetalLB | VIP `.201`; live pool `.200-.250` | L2 service address, not a host `/16` to rewrite. Pod/service networks are separate from the legacy LAN. |
| Technitium | `.30/24`, gateway `.1` | Existing native LXC NIC on edge `vmbr0`; five scopes disabled and timer/DNS healthy. |
| PDM | `.31/24`, gateway `.1` | Configured and runtime container networking agree; native LXC NIC on cp1 `vmbr0`. |
| NAS | `.5/16`, gateway/DNS `.1` | Physical `eth0` MAC `f8:f2:1e:48:91:40`; router ARP MAC `02:32:6d:84:75:0e` matches local `vhost0` macvtap. Attribution is not permission to rewrite reservations or a complete duplicate-IP investigation. |
| Active operator | `.174/16`, gateway `.1`, DNS `.30` | USB Ethernet MAC `84:3a:5b:87:91:dd`. Owner identifies switch port 22 (`cab-trunk`); Windows route to `.3` is on-link. WSL has a separate `172.19.28.120/20` NAT interface. |
| Operator Wi-Fi | Retained `.180/16`, disconnected | MAC `5c:87:9c:fa:10:f4`; do not treat a cached address as a second active management path. |
| Storage management / power strip | `.6` / `.9`, masks and gateways unverified | BMC means the storage server's management port; PDU means the managed power strip. Their web ports respond, but network-settings reads are incomplete. |
| AP-labelled path | Switch port 18 linked; device identity unverified | Recorded `.40:22` SSH probe fails. Link and label do not establish OpenWrt access, current mask or cabling. |

All switch ports currently have PVID 1, VLAN mode Optional and receive Any.
Switch management allows VLAN 1 and all ports; address acquisition is DHCP with
static fallback `.2`. The vendor documents reply-to-source behavior without a
default gateway, so do not invent a conventional Linux-style switch mask/gateway
edit. VLANs 10-50 still list only disabled port 5. The learned-host helper returns
an empty list; that does not identify the operator port or prove no hosts exist.
Most unused ports are disabled; port 23 is labelled WAN, not an approved spare.

### Client Identity And Address Evidence

- Router pagination is complete: 15 lease records, eight reservations and one
  range. All returned lease and LAN ARP addresses are inside the retained `/24`.
  Lease presence is not proof of an online client or its current local mask.
- The owner reports the old work-laptop `10.0.203.172` entry is historical and
  knows of no current outside-range client. Offline/static-client absence is
  not independently proven by a bounded snapshot.
- The current `KAM1WL102916` lease is `.112`, MAC `24:fb:e3:7c:cf:da`, distinct
  from its old recorded Wi-Fi MAC. Keep it dynamic and verify the actual NIC
  before replacing target-registry metadata. The tablet lease remains `.166`
  with its observed locally administered MAC; the phone is now `.129`.
- Current NAS reservations are `.4` on the storage-host MAC and `.5` on the
  NAS physical MAC. Do not interpret both `nas` labels as the same interface
  or prune them based on ARP alone.
- The DHCP range still ends at `.200`; the live MetalLB pool starts there.
  Resolve this overlap through the owning configuration before allocation or
  migration. Native-LAN offers advertise a 24-hour lease; shortening it only
  affects clients after renewal, not instantly or merely after waiting.

### Scoped Before And After Proposal

**Preferred candidate, not approved execution:** retain every current address,
gateway, native L2 attachment and resolver while contracting the affected
ordinary LAN prefixes from `/16` to `/24`. Leave Technitium/PDM `/24`, API VIP
`/32`, corosync addresses, ingress VIP and pod/service CIDRs unchanged. Management
VLAN tagging remains a later separate change; do not attach contained routed
target `/24`s while relying on old hosts' `/16` ARP behavior.

The existing Talos Terraform root still declares `/16` node IPs and pins an
older Talos version than runtime. A whole-root apply is not a safe way to make
only a mask change. Prepare a reviewed network-only IaC/rollback lane and
affected-resource evidence first; do not silently upgrade/downgrade nodes,
change guest NICs, write NAS boot files or modify passthrough/disks/array/power.
Intermediate mixed masks on the same untagged L2 need explicit forward/return
checks; the observed all-`.10` addresses are evidence to evaluate, not a blanket
zero-interruption guarantee.

### Recovery Evidence And Remaining Checks

- **Confirmed:** active operator Ethernet and on-link route to literal PVE `.3`;
  owner can access PVE Web. Port 22 is the owner's protected cab-trunk path and
  must remain untouched during independent mask preparation.
- **Console access verified later (2026-10-15):** the owner's screenshot shows
  PVE at literal `10.0.10.3:8006`, VM 100 selected, and OPNsense `26.1.9` at its
  interactive console menu. LAN `ixl1` is still `10.0.10.1/16`. This closes the
  earlier menu-access gap, not an outage recovery or configuration-restore
  rehearsal. No console configuration command was requested or executed by
  the assistant; retain the affected router configuration and exact restore
  procedure before a router-prefix change.
- **Component-scoped gaps:** read `.6` storage-management and `.9` power-strip
  network settings before changing those components or depending on their
  routed return paths. PDU HTTPS negotiation failed; no legacy TLS downgrade
  or password-over-HTTP login was attempted. An exact-IP vault lookup did not
  identify a BMC item; that does not prove no such credential exists elsewhere.
- **Path-scoped gaps:** identify the device/cabling behind port 18 before AP or
  wireless work. This is not a blanket gate on an independent wired pilot with
  its own recovery path. No spare switch port is approved merely from its label.
- **Before an affected change:** review dynamic firewall-network aliases,
  legacy rules/outbound NAT and IPv6 behavior; export only affected configuration
  and verify its inverse/recovery. A NAS-data backup or unrelated cabinet-wide
  remediation is not a prerequisite for scoped network preparation.

The inventory supports evaluating in-place mask contraction; it does not
authorize any apply. The operator has now demonstrated VM 100's console menu;
no further menu input is required for that access check. Affected configuration
capture, exact inverse/restore steps, hardware masks and per-resource IaC
recovery remain explicit unknowns, not guessed defaults. The screenshot is
later evidence for console access, not a refresh of every earlier lease or
host-inventory observation.

## Follow-Up: Range-Fix Preparation And Control-Path Safety

**Observed:** preparation through 2026-10-16 UTC (2026-10-15 local). Fresh GET
reads at 00:04:47Z still found one Dnsmasq range `.100-.200`, 15 lease records
and eight reservations, with complete pagination. No lease, reservation, ARP
entry or requested/allocated Kubernetes load-balancer address at `.200` was
observed; MetalLB still lists `.200-.250`. These are dated observations, not
permission to skip another ownership check immediately before any live change.

- Local `terraform init -backend=false -lockfile=readonly -input=false`
  installed the already-locked `0.24.0` provider without a plan, state refresh
  or appliance change. Its schema has `opnsense_dnsmasq_host`, not a Dnsmasq
  range resource. Kea resources do not manage the active Dnsmasq engine.
- The GET backup-provider/history/download path works. A selected August 2026
  history XML was saved privately and parsed without printing sensitive
  contents. It is not a new active export and was not approved for a full-current
  restore. API range/client preimages are separate; no restore/revert/import
  or reboot was performed.
- A [range-only playbook (retired)](../decisions/016-opnsense-terraform.md)
  prepares the existing UUID's end address `.200` to `.199`. Both activation
  opt-ins default false. Check mode is GET-only; missing objects, observed
  pre-save drift, address ownership, incomplete pagination or unintended field
  changes stop the run. These checks do not make separate requests atomic.
  An approved mutation would save a private preimage, post only the
  end field, and verify all other returned fields before service activation.
- All [eight offline cases (retired)](../decisions/016-opnsense-terraform.md) pass
  against loopback HTTP with synthetic credentials. One case exposed a YAML
  comparison parsed as a truthy mapping; quoting it and checking all assertion
  shapes fixed that failure before any live execution. An interrupted test
  call had an unknown result; a local process check found none running and the
  complete suite was rerun successfully, not inferred to have passed.
- The vanished temporary CLI was replaced by a checksum-verified user-local
  `2026.7.0` copy and separate profile; actual router item/API reads work.
  The installed original CLI was not replaced. A concurrent original-profile
  change was observed but not attributed/reverted; later status isolation was
  verified without claiming the earlier whole interval was unchanged.

The owner explicitly warned that internet loss also disconnects the assistant,
then offered phone hotspot internet with LAN Ethernet retained. The offer is
not an enabled or verified route. Before a disruptive live step, verify cellular
rather than home-Wi-Fi uplink, Windows/WSL internet and DNS through it, and local
Proxmox/router routing through Ethernet. Check relevant IPv4/IPv6 behavior and
do not silently change metrics, resolvers, gateways or IPv6 policy. Keep port 22
native and untouched; provide owner-executable recovery, not a promise of
assistant-led rollback after disconnection.

**No live range mutation was performed.** The reconfigure implementation can
reload firewall rules as well as interrupt DHCP/DNS. Current export/restore,
independent connectivity, fresh preflight and explicit approval remain required;
neither passing tests nor the hotspot offer lifts those gates. No subnet, VLAN,
client DNS/DHCP authority, NAS or power change was made, and nothing was published
by the assistant.

## Follow-Up: Approved Dnsmasq Range-Only Deployment

**Observed:** 2026-10-16T00:40:51Z through 00:44:05Z. After the hotspot route
concern was explained, the owner explicitly directed deployment without
additional Windows networking changes. The accepted action was the existing
range end `.200` to `.199`, not a mask/VLAN/client-authority change. Fresh scoped
API preimages and the demonstrated console access were used for recovery; no
full-current XML export or independent-hotspot-egress verification is claimed.

| Surface | Result |
|---------|--------|
| Fresh preflight | Existing UUID/start/end and full client pagination confirmed; no observed lease, reservation, ARP or Kubernetes allocation at `.200`. Read-only Ansible preview passed. |
| Activation | Guarded Ansible run 00:40:51Z-00:41:00Z completed `ok=24`, `changed=5`, `failed=0`, no rescue/retry. Fresh local private preimages precede the single-field save; reconfigure ran only after all other range fields matched. |
| Configured range | `10.0.10.100-10.0.10.199`; only `end_addr` differs from the immediate preimage. MetalLB remains `.200-.250`, so the configured allocation ranges no longer overlap. |
| Preserved state | Eight reservations and LAN `10.0.10.1/16` unchanged; 15 lease records, no `.200` lease, Dnsmasq running. No subnet/VLAN/lease-time/client-DNS change. |
| Connectivity | Router external DNS, Technitium internal `rancher.owl.red` and external HTTPS probes passed after activation. No claim of measured zero interruption is made. |
| Real DHCP acceptance | Probe UTC 00:42:50Z-00:43:05Z: matching transaction `0x46544f0d` at wired `cp1/vmbr0` and Technitium `eth0`; one DISCOVER and one OPNsense offer per capture, zero drops. Mask `/16` and DNS `.1` unchanged; no real client renewal/release or accepted lease. |
| Recovery evidence | Fresh range/client/interface API snapshots, immediate preimage, scoped inverse instructions, activation log, post-read-back and PCAP/XML/decoded traces retained outside Git, directories `0700` / files `0600`, with integrity hashes. No rollback was executed. |

This closes the DHCP/MetalLB `.200` overlap fix only. The range setter and service
reconfigure were the only live router operations; neither whole-root Terraform
apply nor configuration import/restore was used. Windows route metrics and DNS,
switch port 22, VLANs, NAS and power settings were untouched. Broader subnet
migration, hardware return-path checks and its own configuration/recovery
requirements remain separate. No commit/push was made by the assistant.

## Follow-Up: Worker Prefix Pilot Preparation

**Observed:** 2026-10-16 UTC. The completed DHCP overlap fix was not repeated.
The next proposed pilot is only PVE `worker1` management `10.0.10.14/16` to
`10.0.10.14/24`, keeping address/gateway/DNS, bridge `nic0` membership and native
tagging. The router, storage host, operator path and guest configurations are
outside this pilot.

- Direct reads confirm persisted/runtime `.14/16`, gateway `.1`, one CIDR
  occurrence, root-owned `0644` source, no pending file or extra include, no SDN
  zones, six online/quorate PVE nodes, reachable gateway and a Ready worker guest.
- Installed PVE code shows network apply commits the pending file in a background
  `srvreload` task and runs `ifreload -a`, with possible SDN/FRR generation.
  The prepared playbook refuses configured SDN zones and explicitly suppresses
  FRR regeneration. Only exact one-CIDR staging is accepted; a whole network
  target or unrelated pending change is not silently applied.
- A guarded host-local 180-second rollback is prepared, not armed. It verifies
  the recovery bytes/hashes, refuses another operator's active/pending source,
  and shares a lock with final confirmation. Recovery snapshots are planned on
  both the host and controller outside Git. Rollback failures remain observable
  failures, not a guaranteed-success recovery claim.
- All [nine offline cases (retired)](../guides/controller-setup.md#historical-migration-tooling-retired) pass
  against temporary files and fake reload/systemctl commands. They cover policy,
  syntax, exact restoration, confirmation, active/pending drift, damaged
  preimages, reload failure and concurrent confirmation/rollback.
- The [connected check-mode preview (retired)](../guides/controller-setup.md#historical-migration-tooling-retired)
  completed `ok=14`, `changed=0`, `failed=0`, `skipped=31`; no staging, timer,
  reload or interface modification ran. Tool requirements and the operator
  invocation are in the [controller guide](../guides/controller-setup.md#worker-management-prefix-pilot).

Live approval is still required for the management-prefix change. It can briefly
interrupt the worker host or its guest traffic even though it does not touch
the internet router. It does not lift broader subnet/VLAN approvals, change the
Talos guest's `/16` or API VIP `/32`, repeat hotspot-priority questions, or permit
NAS/power/version operations. No live prefix change is claimed by this record.

## Follow-Up: Approved Worker1 Prefix Pilot

**Observed:** 2026-10-16T01:06:48Z through 01:15:08Z. The owner explicitly
approved only PVE worker1 management `10.0.10.14/16` to `10.0.10.14/24` with the
host-local 180-second rollback. Other hosts, router, storage, operator port 22,
Talos guest configuration, VLANs and DNS were outside the approval.

| Stage | Evidence / Result |
|-------|-------------------|
| First staging attempt | At 01:06:48Z-01:07:03Z the raw-byte assertion refused PVE's added generated header and formatting. No timer or network reload started; live source/runtime stayed `/16`. |
| Disambiguation | Exact active and pending hashes were checked. Standard `ifquery` models showed only the bridge address prefix differed; explicit `lo nic0 vmbr0` selection was necessary because default listing omits manual `nic0`. The inspected owned pending file was reverted through PVE without a reload. |
| Guard repair | Non-comment directive equality plus complete parsed model equality now permit only the CIDR change while allowing comments/formatting. A loopback test runs the actual assertions and rejects extra directives or manual-NIC drift. All ten final offline cases pass. Byte hashes still guard recovery; a single runtime IPv4 address is required. |
| Approved activation | Fresh identity, private host/controller preimages, parser checks and armed local rollback preceded the controlled second attempt. Run 01:13:43Z-01:14:15Z completed `ok=50`, `changed=10`, `failed=0`, no rescue. The actual background PVE task completed `OK` before final checks. |
| Acceptance at 01:15:08Z | Exactly one IPv4 management address `.14/24`; PVE configured CIDR `.14/24`, gateway/DNS `.1`, bridge port `nic0`. Active source matches staged SHA256; no pending file. Confirmation marker exists, timer inactive, no rollback/blocked marker. |
| Cluster and guest | SSH and gateway checks pass; all six PVE nodes online and cluster quorate. Worker Talos guest remains Ready with its original configuration; its `/16` was not changed. |
| Inventory and recovery | `worker1_pve` current-flat prefix updated to 24, target VLAN declaration unchanged. Private preimages and activation/post-host records retained outside Git, owner-only. No recovery restore was needed. |

This is the first host mask pilot, not a completed `/16` contraction or VLAN
deployment. The other five PVE hosts, Talos nodes, NAS and operator keep their
existing prefixes. No internet-router, Windows routing, DNS, guest-power,
version, storage or passthrough change was made. The earlier staging refusal
and controlled repair are recorded rather than described as a first-try success.
No blind retry, assistant commit or Git publish occurred.

The successful PVE reload also generated a zero-byte regular
`/etc/network/interfaces.d/sdn` file. A subsequent read-only inspection first
refused the include; direct filename/hash/directive-count evidence confirmed it
contains no network definitions. The preflight now allows only that exact empty
regular file (nonempty or differently named includes still refuse), with an
additional offline case. All eleven final cases pass. The converged check at
01:20:13Z passes `ok=14`, `changed=0`, `failed=0`, `skipped=36`; this local
inspection-policy repair did not stage or reload the live network again.

## Follow-Up: Remaining Compute Prefix Preparation

**Observed:** 2026-10-16T01:31:36Z. The completed worker1 pilot was not repeated.
Fresh reads show `cp1` `.11/16`, `cp2` `.12/16`, `cp3` `.13/16`, each on
`vmbr0` over `nic0`, gateway/DNS `.1`, no pending file or extra includes.

The existing playbook now explicitly maps those three inventory hosts and the
completed worker to their own IP, node, guest and direct API endpoint. One host
per invocation, default-off activation, per-host rollback and all staged-model
checks remain. Router/storage and multi-host invocations refuse before changes;
tests also reject a forged management IP or another control-plane guest's API.
All node-scoped PVE commands must use the selected node. No new writer or
package dependency was introduced.

All twelve offline cases pass. Separate connected check-mode runs returned
`cp1: ok=16, changed=0, failed=0`; `cp2/cp3: ok=15, changed=0, failed=0`.
Direct selected-guest `/readyz` checks passed with existing Kubernetes trust;
PDM `.31:8443` was reachable in the `cp1` preview. No timer, pending file or
network reload was started on those hosts.

Live approval is required for the sequential `.11`, `.12`, `.13` management
prefix changes. The batch must stop on any failed activation/confirmation;
router, storage, operator path and guest addresses/prefixes are outside it.
Private preview evidence is retained outside Git. No live compute change or
assistant commit/push is claimed by this preparation record.

## Follow-Up: Approved Sequential Compute Prefix Batch

**Observed:** 2026-10-16T01:39:42Z through 01:43:58Z. After discussing the
operator's `.174/16` and the hosts' proposed `/24` on the same native L2, the
owner explicitly directed the reviewed sequential `cp1`, `cp2`, `cp3` batch to
proceed. The already completed worker pilot was not repeated.

| Host | UTC Activation | Result / Preserved Values |
|------|----------------|---------------------------|
| `cp1` | 01:39:42-01:40:14 | `.11/16` to `.11/24`; `ok=54`, `changed=10`, `failed=0`; direct guest API and PDM checks passed. |
| `cp2` | 01:41:02-01:41:40 | `.12/16` to `.12/24`; `ok=52`, `changed=10`, `failed=0`; started only after cp1's final `/24`, confirmation, inactive timer and quorum were independently read back. |
| `cp3` | 01:42:22-01:42:54 | `.13/16` to `.13/24`; `ok=52`, `changed=10`, `failed=0`; started only after cp2's equivalent read-back. |

Each invocation retained private on/off-host preimages, armed the 180-second
host-local rollback before the PVE reload, waited for actual task `OK`, checked
SSH/gateway/quorum/guest/service health, and confirmed under the rollback lock.
At 01:43:58Z, all three have exactly one runtime IPv4 address and matching PVE
persisted `/24`, unchanged gateway/DNS `.1` and bridge port `nic0`, active source
hash matching staging, no pending file, confirmation marker present, no
rollback/blocked marker and inactive rollback timer. Each connected route is
`10.0.10.0/24`, not the old `/16`.

All six PVE members remain online and quorate. All four Kubernetes nodes are
Ready; direct authenticated API `/readyz` checks at `.21`, `.22`, `.23` pass
using existing trust, and PDM `.31:8443` is TCP-reachable. No guest address,
prefix or version was modified. No measured zero-interruption claim is made.

The three inventory current-flat prefixes now record 24, alongside the earlier
worker `.14/24`. Edge/storage PVE, router, NAS and operator were not changed by
this batch; their older `/16` state is not permission to route overlapping
target VLANs yet. VLANs, bridge membership, Windows routing, DNS overrides,
port 22, VM power and passthrough remain untouched. Recovery/activation/acceptance
records are private outside Git. No retry, recovery restore, assistant commit
or Git publish occurred. This closes the compute-host prefix batch, not the
whole subnet migration.

## Follow-Up: Edge Host Prefix Preparation

**Observed:** 2026-10-16T01:56:29Z. Edge PVE management remains `.3/16`,
gateway/DNS `.1`, bridge port `onboard`, root-owned `0644` source, no pending
file or extra includes/SDN zones. Its reviewed stanzas are `lo`, `onboard`,
`vmbr0`, `nic0` through `nic3`; all manual NIC stanzas must remain unchanged.
OPNsense VM 100 and Technitium LXC 200 are running. The router's two passthrough
PCI entries and the LXC's native `.30/24` network are read-only evidence.

The existing playbook now explicitly allowlists that topology while storage
stays excluded. It uses the same one-host/default-off scope and guarded local
rollback, with target-specific full parsed interface comparison. Edge has no
Kubernetes guest-readiness target: instead it requires both protected guest
configurations unchanged, running guests, the router QEMU PID unchanged,
Technitium daemon PID unchanged, `.1:443` / `.30:5380` reachable and scoped
external/internal DNS responses before confirmation. No guest config, restart,
power or passthrough mutation is implemented.

All thirteen offline cases pass, including selected actual assertions against
extra-NIC, passthrough, router PID, stopped-container and DNS-daemon drift.
The include-policy fixture also rejects a symlink rather than ignoring it.
The connected edge preview passes `ok=19`, `changed=0`, `failed=0`, `skipped=48`.
No network staging, rollback timer or host reload ran. Private preview records
are retained outside Git; existing controller dependencies suffice.

The edge-host management prefix still requires its own explicit live approval.
It is not the router LAN prefix `.1/16`, and no VLAN is introduced. A PVE reload
can briefly affect management/LXC traffic even while router guest settings stay
unchanged. No live edge change, storage operation or assistant commit/push is
claimed by this preparation record.

## Follow-Up: Approved Edge Management Prefix

**Observed:** 2026-10-16T02:01:06Z through 02:07:02Z. The owner explicitly
approved only Proxmox edge management `.3/16` to `.3/24`, not OPNsense guest
LAN `.1/16` or its passed-through NICs, storage/NAS, Windows routing or VLANs.

| Stage | Evidence / Result |
|-------|-------------------|
| Safe first refusal | 02:01:06Z-02:01:25Z: staging assertion stopped before timer/reload because PVE moved unchanged manual NIC stanzas before the bridge. Live source hash and runtime `/16` remained intact; only a pending `.3/24` file existed. |
| Inspection and repair | Exact source/pending hashes, sorted directive content and all seven parsed models showed only the approved CIDR change. The owned pending file was reverted through PVE without reload. The guard now allows stanza ordering while retaining duplicate-sensitive directive content and full parsed interface equality; the edge offline fixture reproduces the actual reserialization. |
| Successful activation | Fresh identity and preimages; 02:05:22Z-02:05:58Z: `ok=62`, `changed=10`, `failed=0`, `skipped=5`, no rescue. Local 180-second rollback was armed before apply; actual PVE task `OK`, guest/config/PID, service, DNS and quorum checks preceded lock-protected confirmation. |
| Host acceptance | At 02:07:02Z exactly one runtime IPv4 address `.3/24`, matching persisted PVE CIDR; gateway/DNS `.1`, bridge port `onboard`, new connected `10.0.10.0/24` and no old `/16` route. Source matches staged hash; confirmation exists, timer inactive, no pending file, rollback or blocked marker. |
| Protected guests | Both guests running; whole guest configuration equality checked by the playbook. Selected passthrough/network/power configuration metadata remains identical on independent read-back; router QEMU PID and Technitium daemon PID unchanged. LXC remains `.30/24`. No guest restart or power command ran. |
| Service acceptance | Router external DNS, Technitium internal `rancher.owl.red -> .201`, external HTTPS, all six PVE online/quorate and all four Kubernetes nodes Ready. No measured zero-interruption claim is made. |
| Recovery/evidence | Fresh private on/off-host source preimages, protected before/after metadata, activation/result/acceptance and integrity records retained outside Git. No rollback, full configuration restore, assistant commit or Git publish was performed. |

Edge inventory now records prefix 24, alongside four compute PVE hosts. Storage
PVE and the appliance/client/guest `/16` transition are still separate. This
closes only the edge-host management mask, not the router interface mask or
whole subnet/VLAN rollout. The initial refusal and controlled repair are not
described as a first-try success, and no unrelated pending file was overwritten.

## Follow-up: Storage Management-Prefix Preparation

Read-only preparation on 2026-10-16, around 16:18-16:26Z, confirms storage PVE
`.4/16`, gateway `.1`, resolver `.30`, bridge port `bond0` and no pending network
file, extra includes or SDN zones. This is newer evidence, not a relabeling of the
02:07Z edge acceptance. The five declared/parsed interfaces are `lo`, `obnic0`,
`obnic1`, `bond0`, `vmbr0`; the bond is active-backup, both named slaves, miimon
`100` and primary/active slave `obnic0`.

NAS VM 101 is running with passthrough and USB boot configuration preserved.
Read-only guest evidence confirms `eth0`, MAC `f8:f2:1e:48:91:40`, `.5/16` and
reachable TCP 443/445. An initial IPv4-only metadata read omitted the MAC key and
the collector failed; the corrected full-interface JSON read succeeded. That
collector error was not a NAS failure. TCP reachability is not a full web/SMB
functional test, and no array, disk, boot, power or unrelated service read/write
was needed for this host-only preparation.

The existing default-off playbook now allowlists storage, protects the whole NAS
VM configuration and QEMU PID, compares every parsed bond/interface setting and
requires unchanged bond runtime parameters and NAS interface identity/prefix
before timer confirmation. Fourteen offline cases pass. Connected check mode
at 16:25:51Z reports `ok=21`, `changed=0`, `failed=0`, `unreachable=0`; private
evidence is retained outside Git. No storage pending file, rollback timer,
network reload or live prefix change was created. Storage management activation
was not yet approved at that preview; NAS itself remains excluded as a mutation
target.

The owner subsequently approved only storage PVE `.4` management `/24`.
The first activation attempt at 16:30:24Z-16:30:46Z stopped before timer/reload:
PVE added `auto obnic0` and `auto obnic1`, which changed both parsed autostart
flags and correctly failed the directive guard. At 16:33:01Z the owned pending
file was reverted through PVE after verifying exact active/preimage/pending
hashes, runtime `/16` and inactive timer; active source and NAS QEMU PID remained
unchanged. No blind reload or retry was performed.

Storage-only staging now rechecks the saved source, creates a new pending file
from that exact source with only `.4/16` replaced by `.4/24`, and refuses an
existing pending file. PVE activation and all model/rollback/acceptance guards
remain unchanged. Fifteen offline cases pass, including the observed bond
autostart drift and actual exact-copy/source-drift/pending-collision behavior.
This is a staging-method repair within the approved host-only scope, not
permission to change bond member settings or the NAS.

## Follow-up: Approved Storage Management-Prefix Complete

The controlled retry used fresh private host/controller recovery identities and
the repaired storage-only staging method. From 2026-10-16T16:36:08Z to 16:36:52Z,
the playbook completed with `ok=69`, `changed=10`, `failed=0`, `rescued=0`.
The local 180-second rollback was armed before PVE activation; actual PVE task
`OK`, host, bond, protected NAS VM/interface, DNS and service checks preceded
lock-protected confirmation and timer cancellation.

Independent acceptance at 16:37:45Z verifies exactly one runtime `.4/24` and
matching persisted PVE CIDR, source equal to its preimage with only that CIDR
replaced, connected `10.0.10.0/24` and no old `/16` connected route. Gateway `.1`,
resolver `.30`, bridge port `bond0`, all bond parameters and both manual member
autostart flags remain unchanged. NAS VM 101 is still running with the same QEMU
PID and whole-configuration hash; NAS `eth0` retains MAC `f8:f2:1e:48:91:40` and
`.5/16`, with SSH and TCP 443/445 reachable. No NAS configuration, disk, array,
passthrough, USB boot, power or unrelated service change was made.

The source matches the staged hash, confirmation exists, the timer is inactive,
and no pending file, rollback or blocked marker remains. All six PVE members are
online/quorate and all four Kubernetes nodes report Ready. Private before/after,
activation, acceptance and exact source preimage evidence is retained outside
Git. This is a verified host-only success after a safely refused first stage,
not a first-try success or a measured zero-interruption claim. No rollback or
configuration restore was needed.

Inventory now records all six PVE management prefixes as 24. Router, NAS,
operator and Talos guest prefix changes, plus VLAN routing and the eventual
DNS/DHCP handoff, remain separately scoped; this does not complete the LAN
transition. No assistant commit or Git publish was performed.

## Follow-up: Talos Guest Network-Only Preparation

Read-only follow-up on 2026-10-16 confirms all four guests `.21-.24` run Talos
`1.8.1`, each with one MAC-selected interface and one `/16` management address,
gateway `.1` and DNS `.1`/`1.1.1.1`. The control-plane configs retain VIP `.20`.
The system CLI is `1.13.0`; a user-local official `1.8.1` binary was downloaded
and verified against its release checksum, without replacing the system CLI.

The worker bootstrap patch used `eth0`, unlike the live MAC selector; its
selector was corrected without changing its current `/16` bootstrap address.
A network-only strategic-merge preview then demonstrated address-list append
behavior, leaving both masks. No live write occurred. The separate one-shot
JSON Patch and default-preview controller now test exact node identity and old
list before replacement. The real matched patch engine and complete candidate
comparison prove only the selected CIDR changes; no DNS/gateway/version/install
image/other machine or cluster field is regenerated from Terraform.

All four connected controller previews pass: server-side no-reboot dry-run,
unchanged stored config, runtime `/16`/gateway/boot identity, four Ready nodes,
VIP plus three direct API readiness checks and three voting etcd members. An
additional worker preview passes the explicit exactly-one `.20/32` runtime VIP
check. Four offline tests pass; CI coverage was added but not run remotely.
Private full-config/preimage/candidate evidence remains outside Git with
owner-only permissions. No Talos configuration, reboot, upgrade or live guest
prefix change has been applied; the rolling activation awaits its scoped
approval. Requirements and try/no-reboot recovery semantics are recorded in
the [controller guide](../guides/controller-setup.md#guarded-talos-guest-management-prefix).

## Follow-up: Approved Talos Guest Masks Complete

The owner explicitly approved `.21-.24` guest management `/24`, worker first
then control planes sequentially, without reboot/version change. The controller
used fresh owner-only preimage/candidate evidence for each node and native
three-minute `try` before the no-reboot confirmation. Completion times on
2026-10-16 are worker 17:02:08Z, cp1 17:02:38Z, cp2 17:02:48Z and cp3 17:02:59Z.
Every node passed whole-configuration equality except the one CIDR, runtime
`/24`, unchanged boot identity/version/runtime gateway, four Ready nodes, API
VIP plus three direct readiness endpoints, exactly one runtime `.20/32` VIP and
three expected voting etcd members before confirmation, then config/runtime/
health read-back again. No reboot, upgrade, reset, drain, guest power action or
automatic rollback occurred.

Terraform's four node CIDRs, standalone bootstrap patches and inventory now
record `/24`; the bootstrap interfaces use the verified MAC selectors rather
than the obsolete `eth0` assumption. The older Talos generation pin is unchanged,
and no Terraform root apply or state refresh ran. That root can still propose
older generated fields, so live/source/version/state drift must be reviewed
before a future apply. Five final offline cases and `terraform fmt -check` for
the edited file pass; the new workflow was not executed remotely.

All six PVE management and four Talos guest addresses now use `/24` on the
existing native L2. Router LAN `.1`, NAS `.5`, operator/client masks, switch/AP
VLAN paths and DNS/DHCP authority were not changed. This closes another mask
batch, not the VLAN rollout; the next coordinated work is remaining legacy
masks/router transition and an isolated switch/router VLAN pilot. Existing
appliance/AP unknowns apply to their affected paths rather than unrelated
network work. No assistant commit or Git publish was performed.

Independent cross-node acceptance at 17:08:19Z, beyond every trial window,
confirms all four stored and runtime `/24` prefixes and complete config equality
to the saved preimage with only its CIDR replaced. Boot identities and Talos
`1.8.1` remain unchanged; all four Kubernetes nodes are Ready on `v1.31.1`.
Technitium internal DNS resolves `rancher.owl.red` to `.201`, whose TCP 443 is
reachable. All private run directories/files have verified `0700`/`0600`
permissions and fourteen evidence files per node are hashed in an integrity
manifest. No additional network write was made for this acceptance. The CI
job's YAML and shell syntax pass locally; remote CI/full hook suites were not run.

## Follow-up: Approved DHCP Mask And NAS Renewal

Read-only NAS evidence at 2026-10-16T19:50:45Z establishes DHCP-managed `.5/16`,
not a static-mask setting: `USE_DHCP[0]="yes"`, DHCP routes and resolver `.1`.
The active Dnsmasq range is `.100-.199` with blank mask, fifteen returned lease
records and eight reservations inside the retained `/24`; the NAS reservation
now matches its physical MAC. This is not proof of every offline/static client.

The same default-off, one-range Ansible exception was extended to the fixed
`subnet_mask` operation, not a second writer or a whole-router apply. Twelve
offline cases pass. Connected check mode reports only a proposal, with no API
write. Baseline wire transaction `0x15fb973f` is matched on both wired/client and
Technitium paths, one DISCOVER/OPNsense OFFER each, zero drops, `/16`, gateway/
DNS `.1`, lease 86400. No synthetic lease was accepted or released.

The owner explicitly approved only DHCP `/24` advertisement and normal NAS
IPv4 renewal after wire acceptance. From 20:16:44Z to 20:16:55Z the save and
Dnsmasq reconfigure completed `ok=25`, `changed=5`, `failed=0`, no rescue.
Complete model comparison shows one `subnet_mask` leaf changed; router LAN
runtime/config stays `.1/16`. After-wire transaction `0x2d9ce05d` matches both
capture paths with zero drops, `/24`, broadcast `.10.255`, unchanged lease/
T1/T2/gateway/DNS and only OPNsense offers. No Technitium authority was enabled.

NAS normal existing-daemon IPv4 renewal produced `.5/24` at 20:19:16Z, but
acceptance caught a missing default route. Cached ACK has router `.1` and `/24`;
the client log records a kernel route deletion during prefix replacement.
Local SSH/HTTPS/SMB stayed reachable. At 20:20:44Z only the exact missing saved
default route was restored after config-hash/boot/MAC and actual-route checks,
without persistent NAS edits or another lease action. The subsequent controlled
stable-`/24` renewal passes at 20:22:08Z with the default route retained, cached
ACK verified, unchanged network-config hash/boot/MAC/IPv6/DHCP daemon/non-eth0
routes and working NAS ports plus external HTTPS. No release/rebind, service
restart, reboot, array/disk/passthrough/boot/power action occurred. This is a
verified result after scoped recovery, not a first-try or zero-interruption claim.

Final 20:24:49Z read-back confirms `/24` advertisement, `.1/16` router LAN,
eight unchanged reservations, running Dnsmasq, external/internal DNS checks and
four Ready Kubernetes nodes. Inventory now records NAS prefix 24; the storage
host's NAS-preservation guard and drift fixture match it, with a zero-change
connected storage preview (`ok=21`, `failed=0`). Read-only Windows evidence
still shows Ethernet `.174/16` with DHCP enabled; no Windows renewal, routing,
DNS, metrics or IPv6 setting was changed. Remaining client renewals and the
later router/interface/VLAN cutover are separate. Private exact preimages,
captures, failure/recovery and acceptance evidence remain outside Git. No
assistant commit/push or remote CI/full hook run occurred.

## Follow-up: Approved Operator Ethernet Renewal

After the DHCP/NAS step, the owner separately approved only normal Windows
Ethernet IPv4 renewal. The before-state is DHCP `.174/16` on USB Ethernet MAC
`84:3a:5b:87:91:dd`. At 2026-10-16T20:32:14Z one actual
`ipconfig.exe /renew Ethernet` accepts `.174/24`; before/after address, NIC,
gateway, DNS, interface metric and route metric fields are identical. No lease
release, NIC reset, manual DNS/gateway/metric, IPv6 or hotspot-routing action
was made. An initial local wrapper syntax error occurred before any Windows
command ran; it was corrected, not treated as an unknown lease outcome.

At 20:33:26Z router HTTPS, edge/storage PVE HTTPS, NAS HTTPS/SMB TCP and external
HTTPS are reachable through the controller. Private before/after, native-command
and acceptance records are owner-only with an integrity manifest. This does
not certify independent hotspot egress, every other DHCP/static mask, router
LAN `/24`, VLAN routing or DNS/DHCP authority handoff. Router LAN remains
`.1/16`; broader interface changes still need their own current configuration
export/recovery and explicit scope.

## Suggested Next Work

Current sequencing and acceptance criteria live in the
[roadmap execution order](../../ROADMAP.md#execution-order) and
[scoped gates](../../ROADMAP.md#stabilization-gates), not a second checklist here.
The earlier blanket G1-G4 prerequisite was revised: current firewall/service
survey and change-scoped recovery come first, then overlap-safe subnet/VLAN
preparation while OPNsense remains the client DNS/DHCP path. Final handoff and
DNS enforcement follow supporting path/interface readiness. Fleet/TLS repairs
are independent unless the specific operation depends on them; G6 gates later
NFS/stateful work, not network preparation.

**Post-audit design review:** the legacy `10.0.0.0/16` contains every target
`/24`, so management-mask contraction and management VLAN tagging cannot be
collapsed into an unconditional "IoT first, management last" instruction.
Technitium's audited enabled scopes need explicit lifecycle control before new
NICs become reachable; the audited running script only sets scope properties,
while the upstream API documents separate enable/disable operations. The next
offline IaC change prepares disabled scope intent, a Nix-owned activation lock,
explicit lifecycle/read-back checks and a network-free CI regression suite.
That source change is not deployed and does not close the live DHCP gate.
A new repository SHA can
trigger a full sync even for a documentation-only commit. These are transition
risks, not proof that the observed zero-lease scopes are actively serving clients.

The user subsequently confirmed no backups exist and that physical switch-port
access plus NAS keyboard/monitor recovery are available. A full NAS-data backup
is not a prerequisite for network-only changes. Save affected configuration/
state and verify recovery for the affected link; do not infer independent router/
switch recovery from NAS console access. NAS passthrough/disks/array/boot/power
and unrelated service changes are outside this work.

The observations above remain the dated audit baseline. Linking remediation
gates does not mark any live fault fixed or authorize infrastructure changes.

Related sources: [roadmap](../../ROADMAP.md), [inventory](../mac-inventory.md),
[change ownership](../guides/changing-owl-red.md),
[Technitium](../../gitops/technitium/README.md),
[Fleet ownership](../decisions/014-fleet-bundle-ownership-boundaries.md),
[shared storage](../guides/shared-storage.md).