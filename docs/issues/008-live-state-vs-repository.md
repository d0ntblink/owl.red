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