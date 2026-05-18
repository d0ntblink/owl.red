# owl.red Setup Runbook

Status: Draft for review

Last reviewed: 2026-05-18

## Purpose

This is the execution runbook for moving from the current state to the target `owl.red` platform. It is intentionally conservative: one blast radius at a time, explicit rollback anchors, and no assumption that documentation order equals execution order.

## Locked Decisions

| Area | Decision |
|------|----------|
| VLAN gateways | VLANs 10/20/30/40/50 use interface-local gateways `10.0.x.1` |
| Kubernetes distro | Talos Linux + vanilla Kubernetes only |
| DHCP authority | Technitium serves VLAN 10 DHCP; OPNsense serves VLANs 20/30/40/50 |
| Break-glass path | One dedicated VLAN 10 recovery port must remain available |
| Service exposure | MetalLB-first, Traefik on VIP `10.0.10.201` |

## Operator Constraints

- Work from Ubuntu WSL, but assume WSL is a weak place for broadcast and discovery behavior.
- Use explicit IPs, DNS names, and browser / SSH workflows.
- Keep a second recovery path available before switch or OPNsense changes.
- Treat all switch, AP, and captive-portal changes as lockout-sensitive.

## Key Artifacts

| Area | Primary path |
|------|--------------|
| Root design | `README.md` |
| Validation | `DEVICE_TEST_PROCEDURES.md` |
| Switch IaC | `ansible/switch_configs/css326.yml` |
| Ansible execution | `ansible/playbooks/` |
| Talos configs | `talos/config/` and `talos/patches/` |
| GitOps services | `gitops/` |
| Terraform | `terraform/proxmox/` |

## Phase Overview

| Phase | Goal | Main risk | Rollback anchor |
|------|------|-----------|-----------------|
| 0 | Safety baseline and backups | Missing rollback artifacts | Known-good backups |
| 1 | Automation scaffold | Bad automation assumptions | No-op / check-mode validation |
| 2 | Proxmox cluster bring-up | Host install inconsistency | Keep nodes standalone |
| 3 | Talos + k8s + Rancher baseline | Cluster instability | Keep production apps on Unraid |
| 4 | Prestage VLAN cutover | Incomplete prep | Existing flat network remains active |
| 5 | VLAN cutover | Lockout or broken routing | Restore SwOS + OPNsense config |
| 6 | DHCP / DNS hardening | Lease or resolution failures | Restore OPNsense scopes and Technitium VLAN 10 scope |
| 7 | Security and observability | Self-lockout | Revert latest policy set |
| 8 | App migration waves | Data inconsistency | Per-app rollback to Unraid |
| 9 | Deferred NAS virtualization | Hardware not ready | Stay bare metal |

## Maintenance Window Checklist

### Before The Window

- [ ] Export OPNsense config XML and save a fresh SwOS backup.
- [ ] Capture the current IP, MAC, and port map.
- [ ] Verify the VLAN 10 recovery path on `SW10` and at least one console or KVM path for OPNsense, switch, AP, and Proxmox.
- [ ] Confirm current desired state in `README.md`, `ansible/switch_configs/css326.yml`, and `gitops/technitium/dhcp-reservations.json` matches the intended change window.
- [ ] Confirm required secrets and credentials are available before the window starts.

### Cutover Order

| Step | Action | Go / no-go gate | Rollback anchor |
|------|--------|-----------------|-----------------|
| 1 | Safety checkpoint | Break-glass path and backups verified immediately before change | Stop before any config change |
| 2 | Apply switch VLAN policy | Switch management remains reachable and trunks behave as expected | Restore SwOS backup |
| 3 | Apply OPNsense VLAN interfaces and policy | VLAN gateways answer and core reachability survives | Restore OPNsense XML |
| 4 | Apply AP SSID and VLAN tagging | Clients join expected VLANs | Revert AP wireless config |
| 5 | Update managed hosts in batches | Each host regains gateway, DNS, and control-node reachability before the next host | Reapply previous host network settings |
| 6 | Validate DHCP and DNS | Technitium serves VLAN 10; OPNsense serves VLANs 20/30/40/50; DNS stays at `10.0.10.30` | Restore known-good DHCP and DNS configs |
| 7 | Validate guest portal and inter-VLAN policy | Guest redirect works and isolation rules behave as designed | Revert latest OPNsense policy change |
| 8 | Capture post-change state | Backups and operator notes reflect the new state | N/A |

### Stop Conditions

- [ ] Stop immediately if the break-glass path fails.
- [ ] Stop immediately if switch or OPNsense management becomes ambiguous or intermittent.
- [ ] Do not continue to AP or host changes if VLAN gateways are not stable.
- [ ] Do not continue to guest validation until DHCP and DNS are correct on representative clients.

## Phase 0 - Safety Baseline

**Entry**
- Router, switch, and NAS are reachable.
- Maintenance and rollback windows are available.

**Actions**
- Export OPNsense config XML.
- Save SwOS backup.
- Capture current IP/MAC/port map.
- Verify break-glass access for OPNsense, switch, AP, Unraid, and each Proxmox host.
- Run read-only preflight checks.

**Exit**
- Backup artifacts exist and restore paths are understood.
- Preflight is green or exceptions are documented.

**Rollback**
- Restore OPNsense XML and SwOS backup.

## Phase 1 - Automation Scaffold

**Actions**
- Build inventory and group vars for current and target addressing.
- Add common baseline role and validation playbook.
- Enforce idempotence and check-mode behavior.
- Keep automation SSH keys in Bitwarden; do not store plaintext secrets in repo.

**Exit**
- `--check` runs clean.
- No task touches unrelated hosts.

## Phase 2 - Proxmox Bring-Up

**Actions**
- Install Proxmox VE on each M73 with final management hostname and IP.
- Verify DNS and SSH reachability from the operator node or approved jump path.
- Run Proxmox prep and upgrade automation.
- Verify time sync.
- Create cluster and join nodes only after reachability is confirmed.
- Validate `pvecm status` and UI/API reachability.

**Exit**
- Cluster is quorate.
- Baseline and hardening are applied.

**Rollback**
- Leave nodes standalone if cluster formation fails.

## Phase 3 - Talos, Kubernetes, and Rancher Baseline

**Entry**
- Proxmox cluster is stable.
- Current app traffic remains on existing paths.

**Core sequence**
1. Prepare Talos ISO on Proxmox hosts.
2. Provision Talos VMs from Terraform.
3. Generate Talos configs in `talos/config/`.
4. Apply Talos machine configs using current DHCP addresses and node patch files.
5. Bootstrap the control plane and fetch kubeconfig.
6. Install MetalLB, Traefik, cert-manager, Rancher, and Fleet.
7. Create Technitium secrets and validate zone sync.

**Key planned addresses**

| Node | Planned IP |
|------|------------|
| Control-plane VIP | `10.0.10.20` |
| `cp1-talos` | `10.0.10.21` |
| `cp2-talos` | `10.0.10.22` |
| `cp3-talos` | `10.0.10.23` |
| `worker1-talos` | `10.0.10.24` |
| MetalLB pool | `10.0.10.200-250` |

Talos note: nodes first boot on temporary DHCP, then receive final addresses from Talos machine config.

**Exit**
- All nodes are `Ready`.
- Rancher is reachable.
- Fleet is healthy.
- Technitium zone sync succeeds.

**Rollback**
- Keep production workloads on Unraid and stop short of traffic cutover.

## Phase 4 - Prestage VLAN Cutover

**Actions**
- Finalize the authoritative port matrix.
- Prestage OPNsense VLAN interfaces and firewall policy draft.
- Prestage AP SSID-to-VLAN mapping.
- Prepare host network-mask transition automation.
- Reconfirm the dedicated VLAN 10 recovery port and console paths.

**Exit**
- Cutover order and rollback can be explained from notes without guesswork.

## Phase 5 - VLAN Cutover

**Sequence**
1. Apply switch VLAN policy.
2. Apply OPNsense VLAN interfaces and policy.
3. Apply AP SSID/VLAN tagging.
4. Update managed hosts in batches.
5. Validate routing, DNS, and inter-VLAN policy after each step.

**Rules**
- Do not combine switch, OPNsense, and AP changes blindly in one irreversible step.
- Save backups before management VLAN constraints or other lockout-sensitive changes.
- Validate the break-glass path immediately before the cutover starts.

**Exit**
- All required VLANs route correctly.
- Guest isolation and deny rules behave as designed.

**Rollback**
- Restore previous SwOS and OPNsense configs and return to the flat profile.

## Phase 6 - DHCP and DNS Hardening

**Actions**
- Keep the split DHCP model as the baseline.
- Validate Technitium VLAN 10 scope `vlan10-network-devices`.
- Validate OPNsense scopes for VLANs 20/30/40/50.
- Confirm VLAN 30 Option 114.
- Confirm Technitium authoritative DNS behavior.
- Run lease and DNS validation tests from representative VLANs.

**Exit**
- Technitium hands out VLAN 10 leases and reservations correctly.
- OPNsense hands out VLAN 20/30/40/50 leases correctly.
- Per-VLAN DHCP options are correct.
- Captive portal path works by hostname and fallback IP.

**Rollback**
- Restore OPNsense DHCP scopes and Technitium VLAN 10 scope / reservations from known-good state.

## Phase 7 - Security and Observability

**Actions**
- Apply strict inter-VLAN policy matrix.
- Implement Bitwarden-backed secret retrieval.
- Deploy ESO bootstrap path.
- Add recurring validation jobs and alerting hooks.
- Run controlled failure drills.

**Exit**
- Secret retrieval works without plaintext files.
- Validation jobs run cleanly across defined critical checks.

## Phase 8 - App Migration Waves

**Actions**
- Group apps by rollback complexity and criticality.
- Move non-critical apps first.
- Validate health, ingress, persistence, and rollback before promoting the next wave.
- Keep Plex fallback on Unraid until real transcode validation passes on target placement.

**Exit**
- Every migrated app has a health check, ingress verification, persistence verification, and rollback path.

## Phase 9 - Deferred NAS Virtualization

**Gate**
- HBA installed and passthrough validated.

**Deferred work**
- Validate IOMMU and passthrough.
- Prepare Unraid VM definition and storage mapping.
- Perform controlled service migration.

**Rollback**
- Keep services on bare-metal Unraid.

## Manual-Only Areas

- SwOS full VLAN / port policy changes
- AP SSID / VLAN mapping changes
- OPNsense captive portal policy wiring
- DHCP authority expansion beyond the current split model

## Validation Cadence

- Weekly: DHCP and DNS checks, core service health
- Monthly: inter-VLAN policy checks, captive portal validation, switch and AP review
- Quarterly: node-drain test, storage validation, non-destructive recovery drill
- Annually: full power-event rehearsal in a maintenance window

## Deferred Items

- NAS bare-metal to PVE VM migration after HBA arrival
- Additional storage VLAN only if measured evidence justifies it
