# Decision: Technitium LXC As The Single DNS And DHCP Authority For All VLANs

## Status

Selected. Technitium moves from a Kubernetes StatefulSet to a Proxmox LXC on `edge.pve`. It becomes the sole DNS and DHCP authority for all five VLANs. OPNsense no longer serves DHCP on any VLAN.

## Quick Summary

| Area | Decision |
|------|----------|
| Technitium placement | LXC on `edge.pve` (10.0.10.3), onboard NIC trunk |
| DNS for all VLANs | Technitium `10.0.10.30` (VLAN 10 IP); VLAN-local IP pushed per VLAN |
| DHCP for all VLANs | Technitium LXC — multi-interface, one IP per VLAN |
| DHCP ranges (all VLANs) | x.x.x.100–199 |
| OPNsense DHCP role | Eliminated for all VLANs |
| OPNsense DNS role | Forwards to Technitium for its own resolver; no client-facing DHCP DNS assignment |
| HA / redundancy | Phase 1: single node. Phase 2: Proxmox HA + second LXC when shared storage is available. |
| Desired state | Git (`gitops/technitium/`: `settings.json`, `zones/owl.red.zone`, `dhcp/scopes.json`, `dhcp-reservations.json`) — applied by a systemd timer in the LXC |

## Context

The platform originally split DNS and DHCP responsibility: Technitium (in Kubernetes) owned DNS and DHCP for VLAN 10; OPNsense owned DHCP for VLANs 20–50 and forwarded DNS to Technitium. This split required managing two systems and created operational friction when DHCP scopes or static reservations needed updating.

The goal is to consolidate: a single Technitium instance owns both DNS and DHCP for all VLANs. Running Technitium as a Kubernetes StatefulSet was rejected for this expanded role because it creates a circular dependency — clients on VLANs 20–50 need DHCP to get a network address, but DHCP would depend on the Kubernetes cluster being healthy. Kubernetes going down should not prevent clients from acquiring leases.

Moving Technitium to a Proxmox LXC eliminates this dependency. The LXC starts directly on the PVE hypervisor at boot, before Kubernetes initialises.

**Why edge.pve**: OPNsense already runs on `edge.pve`. If `edge.pve` fails, OPNsense goes down and VLANs 20–50 lose their default gateway regardless — there is no network to serve. Adding Technitium here does not worsen the blast radius for those VLANs. For VLAN 10 (management, static IPs), losing `edge.pve` is a break-glass scenario in any case.

**Why multi-interface (not DHCP relay)**: Giving the LXC an IP on each VLAN (via VLAN-aware bridge trunk) allows Technitium to serve DHCP broadcasts directly. DHCP relay via OPNsense would keep OPNsense in the DHCP path — if OPNsense restarts, clients on VLANs 20–50 cannot renew leases even though the Technitium LXC is healthy. Multi-interface eliminates OPNsense from the DHCP path entirely.

**Why not HA now**: Technitium clustering does not support DHCP scope replication as of v15 (confirmed with the upstream developer, April 2026). True DHCP HA via Proxmox LXC failover requires shared storage, which is not yet provisioned (`storage.pve` is planned). Phase 2 adds Proxmox HA + a secondary LXC when shared storage is available.

## Decision

Technitium runs as a single LXC (VMID 200) on `edge.pve`. The LXC has five network interfaces, one per VLAN, connected to a VLAN-aware bridge on edge.pve's onboard NIC (SW05, now trunked). It serves both DNS and DHCP for all five VLANs directly — no relay, no OPNsense DHCP.

Desired state (`gitops/technitium/`: server settings, the `zones/owl.red.zone` zone file, DHCP scopes, and DHCP reservations) remains Git-managed. A systemd timer in the LXC runs a full GitOps sync (`technitium-sync.service`) every 15 minutes, equivalent to the former k8s CronJob.

The Technitium k8s StatefulSet, associated services, ConfigMaps, and the MetalLB `technitium-vip-pool` are removed as part of the cutover.

## LXC Network Layout

| Interface | VLAN | IP | Role |
|-----------|------|----|------|
| eth0 | 10 | 10.0.10.30/24 | Management, DNS VIP, DHCP for VLAN 10 |
| eth1 | 20 | 10.0.20.30/24 | DHCP + DNS for private-net |
| eth2 | 30 | 10.0.30.30/24 | DHCP + DNS for guest-net (option 114) |
| eth3 | 40 | 10.0.40.30/24 | DHCP + DNS for iot-no-inter |
| eth4 | 50 | 10.0.50.30/24 | DHCP + DNS for iot-with-inter |

DHCP pushes the **VLAN-local** Technitium IP as DNS server to clients on each VLAN. This avoids inter-VLAN DNS traffic — required for VLANs 40/50 where OPNsense firewall blocks outbound cross-VLAN.

## Ownership Boundaries

| Layer | Owner | Notes |
|-------|-------|-------|
| DNS for all VLANs | Technitium LXC | Authoritative + recursive; VLAN-local IP per VLAN |
| DHCP for all VLANs | Technitium LXC | OPNsense DHCP disabled on all VLANs post-cutover |
| Desired state | Git (`gitops/technitium/`) | Settings, `zones/owl.red.zone`, DHCP scopes + reservations; synced by systemd timer |
| LXC lifecycle | Terraform (`terraform/proxmox/technitium/technitium-lxc.tf`) | bpg/proxmox provider |
| LXC OS configuration | Ansible (`ansible/roles/technitium_lxc`) | Zone sync service, git deploy key, packages |
| Switch trunk (SW05) | `ansible/switch_configs/css326.yml` | Port 5 trunked: VLAN 10 native + 20-50 tagged |

## Consequences

| Type | Outcome |
|------|---------|
| Positive | Single system for DNS + DHCP; no split management |
| Positive | DHCP no longer depends on Kubernetes cluster health |
| Positive | VLAN-local DNS avoids inter-VLAN traffic for IoT VLANs |
| Positive | `10.0.10.30` unchanged — no client DNS reconfiguration needed |
| Trade-off | Technitium LXC unavailability = DNS + DHCP failure for all VLANs |
| Trade-off | edge.pve failure loses OPNsense (routing) + Technitium (DNS/DHCP) simultaneously — acceptable because VLANs 20–50 are already non-functional without OPNsense |
| Trade-off | No DHCP HA until shared storage is provisioned (Phase 2) |

## Risks And Mitigations

| Risk | Mitigation |
|------|------------|
| edge.pve node failure | DHCP clients retain leases for lease duration. Static IP devices unaffected. Break-glass recovery via Proxmox console. Phase 2 adds Proxmox HA. |
| Technitium LXC process crash | `systemd` (inside LXC) restarts `dns.service` automatically. LXC configured `start_on_boot = true`. |
| Zone sync fails silently | Systemd timer unit enters failed state; visible in `systemctl list-timers`. Same validation logic as k8s CronJob (checks JSON status, not just HTTP code). |
| SW05 trunk change breaks edge.pve management | VLAN 10 is native/untagged on the trunk — management access is uninterrupted. Risk is brief only during the switch config apply. |
| Technitium loses DHCP leases on restart | Technitium persists leases to disk on the LXC. Local storage survives process restart. |

## Validation Gates

| Check | Expected result |
|-------|----------------|
| DNS from VLAN 10 | `dig @10.0.10.30 rancher.owl.red` → `10.0.10.201`, `aa` flag |
| DNS from VLAN 20 client | `dig @10.0.20.30 rancher.owl.red` → `10.0.10.201` |
| DHCP on VLAN 20 | Client renews lease from Technitium; gets `10.0.20.30` as DNS server |
| DHCP on VLAN 40 | IoT client gets lease; `dig @10.0.40.30 owl.red NS` resolves without cross-VLAN |
| Zone sync timer | `systemctl list-timers technitium-sync.timer` shows last trigger and next run |
| OPNsense DHCP disabled | No DHCP offers from OPNsense on VLANs 20–50 after cutover |
| k8s decommission | `kubectl get all -n technitium-namespace` returns no resources |
