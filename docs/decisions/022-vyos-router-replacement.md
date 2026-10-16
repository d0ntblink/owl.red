# Decision 022: VyOS Router Replacement With Direct PCI Passthrough

## Status

Accepted (2026-10-16). Architecture and preparation are approved; this is not
approval to stop the live router, transfer PCI devices or activate the replacement.

Supersedes [ADR 016](016-opnsense-terraform.md) for the future router architecture.
Its existing OPNsense ownership rules remain applicable until the accepted cutover.

## Context

OPNsense configuration currently has a Terraform/API lane and a manual floor.
The desired replacement must make router configuration reproducible from Git,
without sacrificing working access or quick blocked-connection troubleshooting.
The dashboard is for read-only diagnosis, not configuration editing.

The current router is VM 100 on `edge.pve.owl.red`. Its recorded WAN is an Intel
i226-V and its LAN trunk uses an Intel X710, passed through directly. A PCI
function cannot belong to two running VMs. Two routers on the same host would
still share the host, power and other failure points.

## Decision

### Platform And Ownership

- Replace OPNsense with one VyOS VM on the existing edge host. Keep direct PCI
  passthrough for WAN/LAN; do not introduce Proxmox bridges or SR-IOV into the
  production router data path. HA is deferred, not a migration prerequisite.
- Use VyOS Stream with an explicitly pinned image and verified published
  integrity/authenticity information. Stream is not LTS; do not assume that
  rolling documentation describes the selected image. Record the release,
  feature support, update policy and recovery image before deployment.
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

- Prefer supported native VyOS functions, including Suricata, over an external
  container without a demonstrated benefit. Verify the selected image and choose
  IDS versus inline IPS deliberately; an alert is not proof of a packet drop.
- Keep [ADR 013](013-technitium-single-resolver-all-vlans.md)'s final Technitium
  DNS/DHCP design. OPNsense serves until the router swap; VyOS provides the agreed
  interim client services afterward. Technitium DHCP stays disabled until the
  later path-specific, lease-safe authority handoff is approved.
- Keep [ADR 012](012-cloudflare-tunnel-no-inbound-port-forwarding.md): Cloudflare
  Tunnel/Access is the web ingress design, not new inbound web port forwards.
  Review the existing Plex exception explicitly; do not silently remove it or
  assume Tunnel replaces every non-HTTP protocol. Connector placement remains a
  separate service decision, not a required router plugin.
- Select a proven guest captive-portal enforcement engine and placement before
  guest activation. A web container or DHCP option 114 alone does not enforce
  access. Do not burden the weak WAP with the portal service or reuse an
  OPNsense-specific CAPPORT API. Account for IPv6 and legitimate HTTPS portal
  discovery instead of intercepting arbitrary HTTPS.
- Require an OPNsense-like read-only blocked-connection workflow before accepting
  the replacement: filter time, source/destination, port/protocol, interface/VLAN,
  verdict and rule identity; relate rules to the deployed configuration revision.
  Enable relevant explicit/default deny logging for IPv4/IPv6 and distinguish
  firewall drops, Suricata alerts and IPS drops. Bound log volume without changing
  verdicts; absent events do not prove traffic was allowed.
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