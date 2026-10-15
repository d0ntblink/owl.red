# Decision: Technitium LXC As The Single DNS And DHCP Authority For All VLANs

## Status

Selected target, not completed deployment. Technitium has moved to a Proxmox LXC
on `edge.pve`; sole client DNS/DHCP authority across five VLANs is the intended
post-cutover state. Keep client DNS/DHCP on OPNsense until the required VLAN
paths and Technitium interfaces are ready and a coordinated handoff is approved.
No early CoreDNS override or DNS interception is implied by this decision.

**2026-10-14 reconciliation:** the audit found one untagged LXC NIC, a flat
legacy `/16`, disabled VLAN 10 DHCP and enabled VLAN 20-50 scopes with no leases.
Authenticated current OPNsense service ownership remains to be surveyed. Follow
the [roadmap execution order](../../ROADMAP.md#execution-order); the layout below
is a target, not permission to apply it. Alternatives remain open to explicit
review after that survey rather than silently changing an accepted design.

## Quick Summary

| Area | Decision |
|------|----------|
| Technitium placement | LXC on `edge.pve` (10.0.10.3), onboard NIC trunk |
| DNS for all VLANs | Technitium `10.0.10.30` (VLAN 10 IP); VLAN-local IP pushed per VLAN |
| DHCP for all VLANs | Technitium LXC — multi-interface, one IP per VLAN |
| DHCP ranges (all VLANs) | x.x.x.100–199 |
| OPNsense DHCP role | Retained during preparation; removed per broadcast domain only at approved handoff |
| OPNsense DNS role | Retained client resolver path during preparation; final forwarding/host resolver policy changes at the coordinated handoff |
| HA / redundancy | Single node now; future fenced active/passive failover depends on tested shared storage (roadmap Phase 4/G6), not just creating a second LXC |
| Desired state | Git (`gitops/technitium/`: `settings.json`, `zones/owl.red.zone`, `dhcp/scopes.json`, `dhcp-reservations.json`) — applied by a systemd timer in the LXC |

## Context

The platform originally split DNS and DHCP responsibility: Technitium (in Kubernetes) owned DNS and DHCP for VLAN 10; OPNsense owned DHCP for VLANs 20–50 and forwarded DNS to Technitium. This split required managing two systems and created operational friction when DHCP scopes or static reservations needed updating.

The goal is to consolidate: a single Technitium instance owns both DNS and DHCP for all VLANs. Running Technitium as a Kubernetes StatefulSet was rejected for this expanded role because it creates a circular dependency — clients on VLANs 20–50 need DHCP to get a network address, but DHCP would depend on the Kubernetes cluster being healthy. Kubernetes going down should not prevent clients from acquiring leases.

Moving Technitium to a Proxmox LXC eliminates this dependency. The LXC starts directly on the PVE hypervisor at boot, before Kubernetes initialises.

**Why edge.pve**: co-location is operationally simple, but couples DNS/DHCP and
routing failure. Losing the router does not eliminate same-VLAN communication;
independent DNS could still help management and local services. Accept that
failure domain explicitly rather than claiming co-location adds no impact.

**Why multi-interface (not DHCP relay)**: Giving the LXC an IP on each VLAN (via VLAN-aware bridge trunk) allows Technitium to serve DHCP broadcasts directly. DHCP relay via OPNsense would keep OPNsense in the DHCP path — if OPNsense restarts, clients on VLANs 20–50 cannot renew leases even though the Technitium LXC is healthy. Multi-interface eliminates OPNsense from the DHCP path entirely.

**Why not HA now**: the recorded v15 design does not provide DHCP scope
replication through Technitium clustering. Shared storage is not yet configured;
the storage host and NAS VM already exist. Future LXC failover must preserve
lease state and fence the previous instance before serving. A second DNS-only
resolver can be evaluated separately; two independently active DHCP copies of
these scopes are not a safe HA design.

## Decision

Technitium runs as a single LXC (VMID 200) on `edge.pve`. The target is five
interfaces on a VLAN-aware bridge, serving VLAN-local DNS/DHCP directly rather
than by relay. The historical SW05 trunk claim was not deployed: the audit found
that port disabled and edge management on SW24. Verify real cabling and native/
tagged behavior at every boundary before attaching NICs or changing management.

Desired state (`gitops/technitium/`: server settings, the `zones/owl.red.zone` zone
file, DHCP scopes and reservations) remains Git-managed. The LXC systemd timer
checks every 15 minutes. The prepared reconciler checks DHCP serving state even
on unchanged SHAs; a new SHA triggers the full settings/zone/scope/reservation
pass. The previously audited binary skipped unchanged SHAs entirely and remains
the runtime baseline until the Nix-host update is deployed. This is not a
Fleet-managed CronJob.

Before making target interfaces reachable, establish explicit disabled DHCP
scope state and verify that reconciliation/restart cannot undo it. Source now
prepares all scopes disabled, with separate `scopes/enable`, `scopes/disable`
and `/list` read-back plus Nix-owned `DHCP_ENABLE_ALLOWED=false`. Offline tests
pass, but live deployment and packet checks remain required. Missing scopes are
rejected before writes because upstream creation starts enabled; isolated IaC
bootstrap is required for a fresh server. The activation lock prevents new
enables, not an emergency shutdown of already-serving scopes. Do not
enable the replacement server until the old authority for that broadcast domain
is disabled and outstanding leases/pool exclusions are accounted for.

The Technitium k8s StatefulSet, associated services, ConfigMaps, and the MetalLB `technitium-vip-pool` are removed as part of the cutover.

## LXC Network Layout

Target only. The observed LXC has just untagged `eth0` at `10.0.10.30/24`.

| Interface | VLAN | IP | Role |
|-----------|------|----|------|
| eth0 | 10 | 10.0.10.30/24 | Management, DNS endpoint, DHCP for VLAN 10 |
| eth1 | 20 | 10.0.20.30/24 | DHCP + DNS for private-net |
| eth2 | 30 | 10.0.30.30/24 | DHCP + DNS for guest-net (option 114) |
| eth3 | 40 | 10.0.40.30/24 | DHCP + DNS for iot-no-inter |
| eth4 | 50 | 10.0.50.30/24 | DHCP + DNS for iot-with-inter |

After handoff, DHCP must push the **VLAN-local** Technitium IP to each VLAN.
Verify actual Option 6 values on renewed clients; the audit found all scopes
reporting `10.0.10.30`, not the final local addresses. Local DNS avoids requiring
cross-VLAN port 53 access for isolated clients. Restrict the multihomed LXC's
management listeners and forwarding so it does not become an isolation bypass.

## Ownership Boundaries

| Layer | Owner | Notes |
|-------|-------|-------|
| DNS for all VLANs | Technitium LXC | Authoritative + recursive; VLAN-local IP per VLAN |
| DHCP for all VLANs | Technitium LXC | OPNsense DHCP disabled on all VLANs post-cutover |
| Desired state | Git (`gitops/technitium/`) | Settings, `zones/owl.red.zone`, DHCP scopes + reservations; synced by systemd timer |
| LXC lifecycle | Terraform (`terraform/proxmox/technitium/technitium-lxc.tf`) | bpg/proxmox provider |
| LXC OS configuration | NixOS (`nix/hosts/technitium/`) | Packages, networking and systemd sync; Ansible bootstraps credentials/deploy key |
| Switch VLAN/port map | `ansible/switch_configs/css326.yml` | Reconcile with real cabling first; historical SW05 is not a verified trunk |

## Consequences

| Type | Outcome |
|------|---------|
| Positive | Single system for DNS + DHCP; no split management |
| Positive | DHCP no longer depends on Kubernetes cluster health |
| Positive | VLAN-local DNS avoids inter-VLAN traffic for IoT VLANs |
| Positive | Management DNS endpoint `10.0.10.30` can remain; other VLANs still require an explicit DNS-option/client transition |
| Trade-off | Technitium LXC unavailability = DNS + DHCP failure for all VLANs |
| Trade-off | edge.pve failure loses routing and DNS/DHCP together, including name service for otherwise working same-VLAN clients |
| Trade-off | DHCP HA remains unimplemented; shared storage and a tested single-active failover design are needed |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| edge.pve node failure | Existing leases/static addresses can preserve L2 communication, not lost DNS/routing. Verify recovery access independent of edge and evaluate later fenced failover; the failed host's own web console is not independent recovery. |
| Technitium LXC process crash | `systemd` (inside LXC) restarts `dns.service` automatically. LXC configured `start_on_boot = true`. |
| Zone sync fails or only partly converges | Inspect the service journal and actual state. The prepared revision fails before activation/SHA recording on reservation API errors; the old running script could warn and save a SHA. A failed full pass can leave managed DHCP disabled. |
| Trunk/PVID change breaks management | Save the affected switch/host configuration, prove a recovery port and match ingress/egress behavior first. An intended native VLAN is not a guarantee of uninterrupted access. |
| Technitium loses DHCP leases on restart | Technitium persists leases to disk on the LXC. Local storage survives process restart. |
| Contained `/24` targets conflict with legacy `/16` on-link routing | Resolve the overlap in the approved transition design before routing the targets; do not default to IoT-first cutover. |
| Attaching NICs exposes enabled DHCP scopes | Explicitly control/read back lifecycle state and prove no competing offers before attachment and after reconciliation/restart. |

## Decisions To Revisit Before Cutover

- Compare the selected direct-interface model with OPNsense relay or retaining
	OPNsense DHCP longer. Direct interfaces remove relay dependence but expand the
	LXC's exposure and require careful lifecycle/listener control. A different
	choice requires an explicit ADR update, not an ad hoc live workaround.
- Keep current edge placement for this network plan unless a separate placement
	review justifies moving it. Independent DNS and DHCP failover are different
	availability problems and need not be implemented together or before VLANs.
- Prefer simple separate IoT SSIDs unless the actual AP build proves a suitable
	dynamic VLAN mechanism; DHCP reservations do not provide VLAN assignment.

## Validation Gates

These are post-handoff acceptance checks. During preparation, OPNsense remains
the client DNS/DHCP path and the replacement scopes must not issue offers.

| Check | Expected result |
|-------|----------------|
| DNS from VLAN 10 | `dig @10.0.10.30 rancher.owl.red` → `10.0.10.201`, `aa` flag |
| DNS from VLAN 20 client | `dig @10.0.20.30 rancher.owl.red` → `10.0.10.201` |
| DHCP on VLAN 20 | Client renews lease from Technitium; gets `10.0.20.30` as DNS server |
| DHCP on VLAN 40 | IoT client gets lease; `dig @10.0.40.30 owl.red NS` resolves without cross-VLAN |
| Zone sync timer | `systemctl list-timers technitium-sync.timer` shows last trigger and next run |
| OPNsense DHCP disabled | No DHCP offers from OPNsense on VLANs 20–50 after cutover |
| k8s decommission | `kubectl get all -n technitium-namespace` returns no resources |
