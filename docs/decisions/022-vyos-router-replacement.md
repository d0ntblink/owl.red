# Decision 022: VyOS Router Replacement With Direct PCI Passthrough

## Status

Accepted (2026-10-16). Architecture and preparation are approved; this is not
approval to stop the live router, transfer PCI devices or activate the replacement.

Deployed after separate bounded approval and acceptance (2026-10-17 UTC): VM 103
is active `edge.owl.red`; VM 102 remains the permanent lightweight
`edge-lab.owl.red`. The operational rollout used native CLI diagnostics; the external
read-only dashboard remains a follow-up, not a protection claimed by the cutover.

Supersedes [ADR 016](016-opnsense-terraform.md) for the future router architecture.
The old ownership rules are historical, not a second live configuration lane.

### Retirement

Explicitly approved and completed on 2026-10-17 after fresh native service,
IPv4/IPv6 default-route and verified HTTPS checks: VM 100 and its 64-GB virtual
disk were deleted, followed by its unreferenced installer ISO, completed cutover
recovery unit/directories and generated provider cache. No VM-100 disk remains.
Production VM 103 and lab VM 102 remain running. Removed source includes the old
provider/VM scaffold, drafts, wrappers, migration-only controllers/tests and
superseded interactive host installers. Decisions, documentation and guides are
retained, with obsolete procedures marked historical. No Git history was rewritten.

Recovery now uses the pinned VyOS image, private native configuration backup,
stored VyOS credentials and PVE console access. The old-router inverse is no
longer available and must not be replayed. The native profile and saved runtime
use generic NTP pool servers, not the retired platform's vendor pool.

## Historical Context

The pre-replacement OPNsense configuration had a Terraform/API lane and a manual floor.
The desired replacement must make router configuration reproducible from Git,
without sacrificing working access or quick blocked-connection troubleshooting.
The dashboard is for read-only diagnosis, not configuration editing.

The pre-replacement router was VM 100 on `edge.pve.owl.red`. Its recorded WAN was an Intel
i226-V and its LAN trunk uses an Intel X710, passed through directly. A PCI
function cannot belong to two running VMs. Two routers on the same host would
still share the host, power and other failure points.

## Decision

### Platform And Ownership

- Replace OPNsense with one VyOS VM on the existing edge host. Keep direct PCI
  passthrough for WAN/LAN; do not introduce Proxmox bridges or SR-IOV into the
  production router data path. HA is deferred, not a migration prerequisite.
- Use an explicitly pinned VyOS rolling build with verified published
  integrity/authenticity information. The owner selected rolling on 2026-10-16,
  superseding the earlier Stream/Suricata deferral. Accept its development-release
  risk without following a moving `latest` image or automatically upgrading.
  Record exact build, feature support, update policy and recovery image before
  deployment; a channel change is not approval for a live router change.
- Terraform owns the new VM's lifecycle and hardware declaration, following
  [ADR 007](007-terraform-vs-ansible-boundaries.md). Use a separate resource/VM ID;
  never turn the existing OPNsense resource into VyOS or recreate VM 100. The
  existing VM module is a scaffold, not proof of imported or reconciled state.
- Git owns the native VyOS desired configuration. Ansible is the single router
  configuration/orchestration lane, using native candidate comparison and
  commit-confirm, acceptance, confirmation and boot-config save. Verify these
  operations and the timeout recovery action against the pinned image/tooling;
  a native API or SSH call is transport, not a second configuration owner.
- Handle removals and drift explicitly, not just additive commands. Inject
  secrets from Bitwarden into private runtime artifacts; do not commit rendered
  secret-bearing configurations. Document the controller tools, versions and
  dependencies before introducing a deployment entry point.
- Do not add a parallel Terraform router-config writer, Terraform SSH mutations,
  dashboard configuration controls or unversioned operational patches.

### Preparation And Cutover

1. Author the baseline configuration first, then stage the new VM with the
   current allocation as its starting point. Verify actual VM CPU, RAM, firmware,
   disk and PCI settings rather than trusting the scaffold. Keep the old disk
   and VM intact; the new Linux guest need not copy FreeBSD-specific settings.
2. Boot and test the pinned image on isolated temporary virtual interfaces.
   Validate configuration persistence, routing/NAT, required services and logs.
   Do not attach production PCI devices, emit DHCP/IPv6 RA onto production or
   advertise the live gateway address there. Lab tests do not prove physical
   NIC drivers, reset behavior or production WAN compatibility.
3. Reconcile the OPNsense rollback baseline before any router restart. The last
   recorded LAN transaction saved `/24` plus additional interface-field changes,
   but the guard stopped before Apply; last verified runtime was `/16`. Read
   actual running/persisted state and approve the exact resolution. Do not
   blindly resume Apply, restore the whole XML or reboot to discover the result.
4. Prepare a parity replacement on the same native management L2 and gateway IP
   `10.0.10.1`, with an explicitly agreed prefix. Preserve current DNS/DHCP
   behavior and reservations, pool `.100-.199`, required NAT/rules and management
   access. Plan outstanding DHCP leases/exclusions so a new engine cannot
   reissue occupied addresses. Map Linux interfaces by verified MAC/PCI identity;
   FreeBSD interface names are not portable. Review WAN DHCP client identity and
   IPv6 DUID/prefix delegation/RA rather than assuming the same MAC is sufficient.
5. Resolve or mitigate the selected image's documented boot-time firewall
   initialization risk before exposing the production path. Verify the required
   features on that image; a successful post-boot ruleset is not boot acceptance.
6. For the separately approved cutover, preserve an independent controller
   connection and literal-IP PVE/console access. Stop OPNsense and verify it has
   released the devices before transferring exclusive ownership to VyOS. Prevent
   both routers from autostarting or claiming the production gateway/services.
   Expect a forwarding interruption and loss of existing OPNsense sessions.
7. Run focused acceptance for management, WAN, DHCP/DNS, applicable IPv6 and
   policy/logging. On failure, stop VyOS, return the exact PCI assignments and
   startup ownership, and start OPNsense using the agreed rollback baseline.
   Keep rollback available until a later explicit retirement decision.
8. Only after the router replacement is accepted, resume remaining mask
   contraction and VLAN activation. Management VLAN tagging, the Technitium
   authority handoff and new IPS enforcement are separate changes, not bundled
   into the OS swap.

### Services And Observability

- Prefer supported native VyOS functions over an external container without a
  demonstrated benefit. The signature-verified Stream `2026.03` ISO lacked
  Suricata files/schema; the owner subsequently selected rolling to obtain native
  Suricata. Verify the chosen binary's service and rules support, not just rolling
  documentation. Qualify IDS first; inline IPS and new production blocking remain
  separate approved changes. An alert is not proof of a packet drop.
- CrowdSec is a requested security capability, not a claim of an installed native
  VyOS service. Qualify log collection/parsers, the Security Engine/local API and
  a remediation component separately. Prefer an external engine and private
  [Blocklist Mirror](https://docs.crowdsec.net/u/bouncers/blocklist-mirror/) consumed
  by native VyOS remote groups over a second agent rewriting router nftables.
  This is an integration candidate until the selected build's fetch, revocation,
  expiry and failure behavior is tested. Keep management/recovery sources safe,
  cover IPv4/IPv6, limit list size and expose no API key in Git or the dashboard.
  Cached remote lists can outlive expired decisions when refresh fails; define a
  bounded stale-data policy and recovery before enabling automatic blocking.
- Scope network remediation to traffic whose real source IP the router can see.
  Cloudflare Tunnel hides the visitor source at that layer; protect web traffic
  at a compatible proxy/Cloudflare remediation point with a verified trusted
  real-client-IP chain. Never ban a connector, gateway or Cloudflare range because
  it appeared as the peer. Cloudflare remediation needs its own scoped account
  IaC, permissions and plan/quota/failure-mode review, not public exposure of LAPI.
  Detection, dashboard visibility and actual enforcement have separate acceptance.
- Keep [ADR 013](013-technitium-single-resolver-all-vlans.md)'s final Technitium
  DNS/DHCP design. OPNsense serves until the router swap; VyOS provides the agreed
  interim client services afterward. Technitium DHCP stays disabled until the
  later path-specific, lease-safe authority handoff is approved.
- Keep [ADR 012](012-cloudflare-tunnel-no-inbound-port-forwarding.md): Cloudflare
  Tunnel/Access is the web ingress design, not new inbound web port forwards.
  Review the existing Plex exception explicitly; do not silently remove it or
  assume Tunnel replaces every non-HTTP protocol. Connector placement remains a
  separate service decision, not a required router plugin.
- Keep Anubis as an optional future anti-bot evaluation for anonymous/public
  browser endpoints, not a deployment decision or migration gate. Cloudflare
  Access authentication may make it unnecessary for private applications;
  Tunnel transport alone is not equivalent to anti-bot protection. Evaluate the
  actual Cloudflare bot controls and legitimate API/webhook/automation access
  before introducing a second challenge layer.
- Keep filtering layered: Technitium handles ad/tracker and malicious-domain
  DNS lists; VyOS handles explicitly selected IP/CIDR feeds such as Spamhaus DROP
  and a conservative FireHOL selection. Do not load email DNSBL query results or
  a domain list as an IP feed, stack overlapping lists without review, or apply
  bogon/private-range feeds blindly to LAN/management traffic. Define direction,
  IPv4/IPv6 coverage, exclusions, refresh/staleness, size and false-positive
  rollback before enabling them. DNS filtering does not replace packet policy,
  detect all malicious traffic or reliably remove same-domain video ads; mail
  spam needs mail-service filtering. These requirements are not a claim that
  Spamhaus/FireHOL feeds are already declared or deployed.
- Select a proven guest captive-portal enforcement engine and placement before
  guest activation. A web container or DHCP option 114 alone does not enforce
  access. Do not burden the weak WAP with the portal service or reuse an
  OPNsense-specific CAPPORT API. Account for IPv6 and legitimate HTTPS portal
  discovery instead of intercepting arbitrary HTTPS.
  The owner subsequently approved a lightweight separate Debian/openNDS gateway
  VM rather than a custom VyOS authorization controller. VyOS remains the
  upstream router; the Grandstream AP remains bridge-only. The portal app owns
  presentation, not router or AP configuration.
  [VM 104 gateway](../../terraform/proxmox/guest-portal/README.md) uses 1 vCPU,
  768 MiB RAM and an 8 GiB disk, with virtual guest and private-transit NICs.
  It now owns `10.0.30.1`; VyOS's direct guest interface is disabled and its
  guest route uses the private transit. Production DHCP/HTTPS consent/native
  Authmon, established TLS revocation, private/admin isolation and IPv6 denial
  passed before wireless confirmation. Technitium retains all DHCP authority.
  Grandstream SSID/VLAN acceptance, handset/RF and truthful CAPPORT remain
  follow-ups, not inferred from the gateway network acceptance fixture.
- Provide an OPNsense-like read-only blocked-connection workflow after the
  CLI-first router rollout: filter time, source/destination, port/protocol, interface/VLAN,
  verdict and rule identity; relate rules to the deployed configuration revision.
  Enable relevant explicit/default deny logging for IPv4/IPv6 and distinguish
  firewall drops from Suricata alerts/IPS drops and CrowdSec decisions/enforcement.
  Do not claim protection from an untested parser, empty ruleset or unapplied
  decision. Bound log volume without changing verdicts; absent events do not
  prove traffic was allowed.
- Prefer an existing log UI/backend such as Grafana/Loki before building a custom
  frontend. A future SIEM can consume the same events; it is not a prerequisite.
  The UI gets query-only access, never router write credentials. Retain local
  logs, counters and console/SSH diagnosis if the dashboard or cluster is down.

## Alternatives

- Keep OPNsense: smallest immediate change, but retains the manual configuration
  floor that motivated this decision. Retained as the migration fallback.
- Bridge production NICs or add SR-IOV for two same-host routers: possible with
  suitable hardware, but changes the selected data path and still cannot cover
  host failure. Rejected for this migration; no claim that bridges inherently cap
  bandwidth is needed to justify keeping the existing passthrough arrangement.
- Two routers on separate hosts: can improve host-level availability, but needs
  independent interface/WAN reachability and a separately designed state/service
  failover model. Deferred, not promised by Proxmox HA or a shared gateway IP.
- Replace the OS, activate VLANs and transfer DNS/DHCP together: fewer windows,
  but makes failures and rollback ambiguous. Rejected in favor of staged changes.

## Consequences

The gateway IP can stay the same, but runtime sessions, leases and ISP identity
do not transfer automatically. Exact physical acceptance waits for the controlled
handoff. The single edge host remains a failure point; rollback and reproducible
configuration are the initial resilience measures, not HA. Native configuration
replaces the OPNsense manual floor, while the read-only UI and any external
services retain explicit, separate ownership.

Execution and status live in [the roadmap](../../ROADMAP.md).