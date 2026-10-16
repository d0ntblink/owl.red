# owl.red Infrastructure Roadmap

Dependency-led execution plan followed by the existing milestone backlog. Phase numbers are stable references, not a command to finish every lower-numbered milestone first. Update status only from observed results.

Status: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Controller and script dependencies are project requirements documented in
[Controller Setup And Tool Requirements](docs/guides/controller-setup.md).
Install tools for the owning lane and verify access, interpreter/library paths
and versions before running commands; package installation is not build success
or permission to deploy.

**Current focus: prepare the VyOS replacement, accept the router swap, then resume VLAN activation.**
The architecture is accepted in [ADR 022](docs/decisions/022-vyos-router-replacement.md):
one VyOS Stream VM on edge, direct WAN/LAN PCI passthrough, unchanged gateway IP,
no new production router bridges and no HA requirement. Configuration and VM
preparation precede a separately approved cutover; nothing is deployed by this
decision. The next work is Phase 0.6, not new OPNsense feature configuration.

The 2026-10-14 audit found a working flat network and Kubernetes control plane,
not an operational five-VLAN deployment. Internal DNS, Fleet and TLS have known
gaps. The Terraform NIC syntax failure has since been fixed offline; that does
not make its five-NIC target safe to apply to the live one-NIC Technitium LXC.

**Transition constraint:** OPNsense remains the serving router until the approved
swap; VyOS must then preserve the agreed client DNS/DHCP behavior at the existing
endpoint. The later handoff to Technitium waits for supporting VLAN paths and
interfaces plus its own coordinated approval. Do not force CoreDNS, Talos
resolvers, client DNS or DNS interception to the final design early. Any interim
DNS repair needs its own scope and rollback; it is not a VLAN prerequisite.

**Paused router state:** the approved LAN-mask operation saved `/24` at 20:59Z on
2026-10-16, but the whole-config guard stopped before Apply because other
interface fields changed. Last verified runtime was `/16`. Resolve the actual
running/persisted baseline before any router restart or replacement; do not
resume Apply, restore the whole XML or reboot implicitly.

## Stabilization Gates

Evidence: [live state audit](docs/issues/008-live-state-vs-repository.md).
These are scoped acceptance checks, not the old G1 -> G2 -> G3 -> G4 dependency
chain. Unchecked means not completed or verified. Read-only discovery,
documentation and offline validation can continue; publishing is a separate
operation because a new Git revision can trigger live Technitium reconciliation.

| Gate | Blocks | Required Exit Evidence |
|------|--------|------------------------|
| G1 `[ ]` Change-Scoped Access And Rollback | Each live change to an affected component | Working administrative access; saved affected configuration and, if Terraform is used, protected state outside the affected system; exact inverse change and an independent recovery path for the affected management link. The user can connect to a switch port and has NAS keyboard/monitor access; neither proves router/switch recovery. A full NAS-data backup, guest backup programme or unrelated passthrough change is not a network prerequisite. |
| G2 `[ ]` Final DNS And Public Namespace | Final resolver handoff/enforcement and services requiring correct internal DNS, not VLAN preparation | After G5's supporting paths/interfaces are ready and handoff is approved, LAN clients, gateway-dependent hosts and pods resolve internal names to private targets and external DNS still works. Review wildcard/DDNS consumers and authoritative/public records before ADR 012 cleanup. DNS interception or blocking follows successful renewal/cache/rollback tests, not interface preparation. |
| G3 `[ ]` GitOps, TLS And Platform Resilience | Declaring platform convergence complete; dependent deployments/drains require the affected release, ingress and PDB checks, not unrelated repairs | Completion means all 9 owl.red bundles ready with matching desired/applied revisions; fleet-agent ownership, replicas, tolerations and PDB reconciled in the owning release. Verify secrets; remove the runtime global backend TLS bypass, retain only PDM's scoped exception, provide trusted management certificates and restrict the dashboard to verified admin sources. This is a separate workstream, not a blanket Phase 1 entry gate. |
| G4 `[~]` Terraform And Inventory Safety | The specific infrastructure root being planned/applied or guest being imported/changed | NIC syntax/fmt/validation is fixed offline. Reconcile live/state/desired values for the touched resource without unapproved version, placement, sizing or power changes. Import only where needed; review a narrowly scoped plan and reject unapproved destroy/recreate, disk, passthrough or unrelated guest actions. The VyOS replacement is a separate VM; Phase 0.6 owns its explicitly approved PCI handoff, not recreation of VM 100. Do not apply a whole cluster target to perform a network-only change. |
| G5 `[ ]` End-To-End VLAN Readiness | Each subnet/L2 migration batch and the subsequent DNS/DHCP handoff | Fresh authenticated service/interface/lease survey of the serving router: OPNsense before replacement, VyOS after acceptance; resolved legacy `/16` overlap; reviewed router/switch/AP and existing PVE/LXC port map; protected operator path; verified Technitium DHCP lifecycle guard before attaching reachable NICs. Prove gateway, return routes, expected DHCP authority/options and policy from a real LAN client for each batch. Mask contraction and management VLAN tagging are separate changes; readiness is built during Phase 1, not required in full before starting it. |
| G6 `[ ]` Power And Stateful Storage Safety | NFS activation and production stateful/HA rollout | Verify UPS monitoring and staged shutdown rather than trusting an enable flag. Restrict intended NFS exports and exclude `system` before enabling NFS. Then prove PVC data survives rescheduling and shared Proxmox storage supports the intended failover before moving application state. |

**Offline progress (2026-10-14):** the five NIC block declarations now parse.
The touched file passes `terraform fmt -check`; the cluster module passes
`terraform validate -json` with zero errors. Validation reports one existing CLI
development-override warning for `finomen/swos`; no switch operation was run.
Quoted values, identifiers, numeric literals and delimiters were compared with
the original and are unchanged. No plan, import, refresh or apply was run; G4
remains open for its other requirements and G1 remains unverified.

### Execution Order

| Step | Work And Dependency | Acceptance Before Advancing |
|------|---------------------|-----------------------------|
| 1. Establish the actual baseline | Phase 0.1/0.2 and G1: regain reusable administrative access, read current OPNsense interfaces/routes, DNS, DHCP engine/scopes/leases, NAT, rules and portal; confirm the operator path and real switch/AP links. | Record current service authority and all addresses/masks, including clients outside `10.0.10.0/24`. Save affected configuration privately with its restore method; do not assume the June empty-firewall survey is current. |
| 2. Record the router and transition design | ADR 022 selects one VyOS VM with direct passthrough and no HA requirement. Phase 1.5 still decides overlap handling, native/tagged boundaries and the management-link sequence. | Architecture acceptance does not approve activation. Define per-component before/after values and exact rollback; no device is moved just because its future reservation exists. |
| 3. Prepare VyOS without transferring service | Phase 0.6: pin the image, codify native configuration, stage a separate VM and test isolated virtual interfaces. Preserve the completed Technitium lifecycle guard and all accepted mask work. | OPNsense alone serves production. The candidate persists its configuration and passes focused simulated routing/service/logging checks without claiming production PCI devices, emitting DHCP/RA or advertising duplicate gateway IPs there. |
| 4. Resolve the rollback baseline, then swap routers | Phase 0.6 and G1/G4: resolve the saved-but-unapplied OPNsense change, verify actual hardware/interface/WAN identities, agree lease-safe service parity and approve one bounded stop/PCI-transfer/start batch. | Only one router owns the devices, gateway and serving state. Management, WAN, DHCP/DNS, applicable IPv6 and blocked-connection diagnosis pass; otherwise stop VyOS and return devices/startup ownership to the agreed OPNsense baseline. Keep its VM/disk for rollback. |
| 5. Finish mask contraction, then prove an isolated VLAN path | After router acceptance, execute the remaining Phase 1.5 strategy. Narrow the legacy connected network and remaining client masks on existing L2 before routing contained target subnets. Management tagging is separate. | PVE quorum, Talos/etcd/API VIP, ingress VIP, NAS access and operator reachability remain healthy; a real test client proves gateway, return path and policy. No competing DHCP server or premature resolver enforcement. |
| 6. Complete supporting paths, then hand off DNS/DHCP | Finish required VyOS/trunk/AP/LXC paths and approve a coordinated authority transfer. VyOS provides the agreed interim services for pilot/migrated clients before Technitium handoff. | Disable the old DHCP authority for the affected broadcast domain before enabling the new one; retain a conflict-safe lease/reservation rollback. Test renewals, scope-local DNS, external resolution and management from real clients and existing pods. Unmigrated domains keep their existing authority. |
| 7. Expand and enforce | Move small client batches, finish the separately planned management-tag migration, then close G2 and Phase 1.6. | Validate required application flows, guest authentication/isolation and IoT restrictions. Only then tighten DNS egress/redirects and retire temporary paths; never remove the final recovery path while it is still needed. |
| 8. Stabilize platform and add stateful services | G3 and Phase 3 can proceed independently when their own access/dependencies are met. G6 -> Phase 4 storage tests -> production stateful workloads; Phase 8 provides the longer-term backup programme. | Network completion is not claimed from a green Fleet status, and storage safety is not claimed from working VLANs. Each workstream has its own evidence. |

**Design recommendation, not an approved live runbook:** prefer contracting the
legacy network to `10.0.10.0/24` on its current untagged L2 before introducing the
other target routed subnets, if the current lease/static-address inventory makes
that practical. Every target `/24` is contained in live `10.0.0.0/16`; a legacy
host can ARP for a migrated destination instead of sending it to the router.
"IoT first, management last" therefore cannot be the unconditional order.
If significant clients cannot be safely contracted, compare a temporary,
non-overlapping migration subnet instead. That alternative needs verified return
routes and additional renumbering; it is not automatically safer. Do not rely on
proxy ARP, a broad legacy bridge or temporary routes without an explicit design.

**DHCP control is a real prerequisite:** the audit found VLAN 10 disabled and
the other Technitium scopes enabled, with zero leases. The approved guard-only
IaC rollout completed on 2026-10-15 using the existing NixOS input. All five
scopes now read back disabled, the Nix-owned activation lock is false, and DNS
is healthy without a process restart. Twenty offline regression cases pass.
The guarded script checks serving state on unchanged SHAs and refuses missing
scopes because upstream creation defaults to enabled. Native-LAN packet checks
passed on 2026-10-15 before and after a sync-unit restart: the probe reached
Technitium, only OPNsense offered, and all captures had zero drops. This is not
whole-container boot or acceptance of unattached target VLANs. A separately
approved daemon restart also passed: all five saved scope files and startup
states stayed disabled before any reconciliation, and another native-LAN
capture saw only OPNsense offers. DNS is healthy and the timer is restored.
A new Git SHA still triggers a full pass, even for docs-only
changes. Pausing a timer or setting the activation lock false does not itself
stop already-serving DHCP.

**Not blanket prerequisites:** NAS-data backups, NAS VM/passthrough/disk/array/
boot/power changes, full PBS, all Fleet/TLS repairs, full cabinet documentation,
mail, cloud-file migration and optional GNSS hardware are outside network entry
criteria. Preserve the working NAS; local keyboard/monitor access is for network
recovery, not permission for unrelated changes. Synchronized public-source NTP
does not block networking. NAS Tailscale is already running, but that does not
complete Phase 3's management routing/split-DNS work.

**References for the transition review:**
[OPNsense VLAN devices](https://docs.opnsense.org/manual/other-interfaces.html#vlan),
[CSS326 family SwOS manual](https://help.mikrotik.com/docs/spaces/SWOS/pages/76415036/CRS3xx+and+CSS3xx+series+Manual),
and [Technitium DHCP API](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md#dhcp-api-calls).
The SwOS manual explicitly warns that changing management VLAN can remove
management access; CSS326 has no serial console. These references explain
mechanics, not the uninspected current OPNsense configuration or an approved
site-specific cutover.

**Recently completed (2026-06-18; driven by the "IaC-everything" principle, not phase-numbered):**
- **Unraid (`nas.owl.red`) settings IaC** — API-settable settings are declarative in `terraform/unraid/` (Terraform-GraphQL); flash-file + drift/recapture via the `unraid_settings` Ansible role; array/users/secrets stay manual. NTP→`10.0.10.1` applied + verified (closes §16.1 for the NAS). ADR 021; guides `unraid-making-changes.md`, `unraid-iac.md`.
- **Proxmox cluster Terraform coverage** — audited all 8 guests; scaffolded the 2 gaps (OPNsense VM `100`, PDM LXC `231`); Talos VMs confirmed already in `main.tf`. See §13 and `docs/guides/proxmox-terraform.md`.
- **Shared-storage decision** — NAS NFS for all HA workloads (reuse shares; NFS for k8s/Proxmox/LXC, SMB personal). See §4, ADR 018, `docs/guides/shared-storage.md`.
- **Repo-wide change-method matrix** — `docs/guides/changing-owl-red.md` ("I want to do X → which tool"). Plus README/discrepancy cleanup.

---

## 0. Router IaC And VyOS Replacement

**Target decision:** [ADR 022](docs/decisions/022-vyos-router-replacement.md)
replaces the future OPNsense configuration plan with native VyOS desired state
and one Ansible deployment lane. Terraform owns the separate replacement VM,
not router configuration over SSH. Phase 0.6 is the next implementation sequence.

**Interim only:** [ADR 016](docs/decisions/016-opnsense-terraform.md)'s ownership
rules still protect the serving OPNsense router. Retain its configuration, VM and
recovery evidence; do not expand the OPNsense target or apply its parked VLAN
drafts. The existing runner remains `scripts/opnsense-terraform-run.sh`, not a
VyOS deployment mechanism or permission to apply.

**Survey finding (2026-06-19):** a read-only survey via the dedicated `terraform` API user found the router **near-default** — WAN `igc0`, LAN `ixl1` on a single **flat `10.0.10.1/16`** (no VLAN interfaces yet), and **0** custom aliases / automation filter rules / NAT / Unbound overrides (only built-in defaults + 1 auto-generated Unbound forward). So there is **nothing custom to import**; firewall aliases/rules get **created during the VLAN transition (§1)**, authored as Terraform — not imported. Forward-looking `/24` drafts are parked in `terraform/opnsense/planned/`.

This is a historical baseline, not the current firewall survey. Authenticated
OPNsense inspection was initially blocked in the 2026-10-14 audit and succeeded
in the [authenticated follow-up](docs/issues/008-live-state-vs-repository.md#follow-up-authenticated-router-survey).
The router is `26.1.9`, still flat `/16`, with Dnsmasq DHCP, an Unbound-to-Dnsmasq
`owl.red` forward, and an enabled Plex WAN port-forward. The seven alias results
are built-ins. Do not rely on the June blanket "nothing to import" assumption;
review supported existing objects and the remaining manual-floor evidence first.

**Interim lane split (ADR 016):** Terraform (`browningluke/opnsense` v0.24.0 in the lockfile) owns supported existing API-backed objects; the documented WebUI floor covers legacy settings. Use only for an explicitly scoped baseline/recovery change while OPNsense remains active. Do not extend this floor to VyOS or manage the same object through two writers.

> Scope note: this phase is the OPNsense **config** via `terraform/opnsense/`. The OPNsense **VM shell** (`edge.owl.red`, VMID 100) is separate, scaffolded under `terraform/proxmox/opnsense-vm/` (§13). `opnsense_firewall_filter` rules live under Firewall → **Automation** → Filter (separate from classic per-interface rules) — see the module README for the safe "delete classic rules" procedure.

### 0.1 Bootstrap API Access
- `[x]` Dedicated least-privilege API user `terraform` created in OPNsense (replaces the root key)
- `[x]` API key+secret stored in Bitwarden `OPNsense — terraform` item NOTES
- `[x]` `scripts/opnsense-terraform-run.sh` injects key/secret as `TF_VAR_opnsense_api_*` (no secrets in code)
- `[x]` `terraform -chdir=terraform/opnsense init` verified; provider `browningluke/opnsense` v0.24.0 (lock committed)
- `[!]` **Verify/revoke the old root API key in the OPNsense WebUI** — revocation was recorded pending in June; current validity was not verified in the October audit (System → Access → Users → root → API keys)
- `[x]` Re-establish reusable Password Manager access and verify dedicated API reads (2026-10-14): installed `bw 2026.4.1` has the upstream session regression; checksum-verified `2026.7.0` with an isolated profile passes actual vault reads. No per-command password prompts or global CLI/profile replacement.

### 0.2 Import Existing Config
- `[~]` Authenticated API survey completed for interfaces/routes, DHCP/DNS, aliases, automation filter search, NAT and portal (2026-10-14). Dnsmasq is the live LAN DHCP authority; full classic filter semantics, automatic outbound-NAT mode and IPv6 advertisement/client behavior remain unverified.
- `[ ]` Carry the existing Plex WAN TCP `32400` -> NAS `32400` rule into the ownership/exposure review; do not silently remove it or assume ADR 012 is already enforced
- `[x]` Remove the live DHCP/MetalLB allocation overlap (2026-10-16 UTC): approved range-only Ansible activation changed DHCP `.100-.200` to `.100-.199`, leaving MetalLB `.200-.250`. Fresh range/client preimages are retained privately; API, service, DNS/HTTPS and DISCOVER/OFFER checks pass. Remaining device-identity gaps stay tracked in Phase 1.5.
- `[~]` A real current export was retained privately at 20:45Z on 2026-10-16. The subsequent saved-but-unapplied change means a fresh agreed running/persisted rollback baseline, exact inverse and independent recovery are still required before stopping or restarting the router.
- `[ ]` Reconcile only existing OPNsense objects needed for a specifically approved interim change; a blanket import is not a prerequisite for creating the separate VyOS VM

Historical checks below were completed on 2026-06-19, not revalidated in October:
- `[x]` Surveyed live config (read-only): router is near-default — **nothing custom to import**
- `[x]` 0 custom aliases / filter rules / NAT / overrides; the 1 auto-generated Unbound forward (Dnsmasq) is left unmanaged
- `[x]` Active module declares no resources; `plan` shows no changes (clean baseline)

### 0.3 Codify Device Groups (VyOS Target)
The OPNsense drafts in `terraform/opnsense/planned/` are reference material only,
not candidates to apply. Author equivalent native VyOS groups from the canonical
registry without activating target subnets prematurely.
- `[ ]` VLAN 10 reserved-host groups from `gitops/technitium/dhcp-reservations.json`
- `[ ]` IoT device groups for VLANs 40/50

### 0.4 Codify Firewall Rules (VyOS Target)
Use native VyOS rules in the single configuration lane. First preserve the flat
network's reviewed behavior; activate target VLAN policy only after Phase 0.6.
- `[ ]` Inter-VLAN policy rules:
  - VLAN 10 admin → all VLANs allowed
  - VLAN 20 private → internet + VLAN 10 services, no lateral
  - VLAN 30 guest → internet only via captive portal, blocked from all VLANs
  - VLAN 40 IoT → LAN only, no internet, no lateral
  - VLAN 50 IoT → internet, no lateral movement
- `[ ]` Compare the native candidate and deploy through the reviewed confirmed-commit lane; no OPNsense Automation rules or parallel Terraform config writer
- `[ ]` Test each VLAN segment for correct connectivity

### 0.5 Ongoing
- `[ ]` Document one VyOS configuration deployment lane, drift/removal handling, native commit-confirm/confirmation/save and private Bitwarden inputs. Terraform remains the VM lifecycle owner; the read-only dashboard cannot configure the router.
- `[ ]` Keep OPNsense baseline/recovery ownership unchanged until accepted replacement; retirement is a later explicit decision

### 0.6 Stage And Accept The VyOS Replacement

- `[x]` Accept [ADR 022](docs/decisions/022-vyos-router-replacement.md) (2026-10-16): one VyOS Stream VM, direct existing PCI passthrough, gateway IP retained, HA deferred, router swap before VLAN activation. Architecture/preparation only; no live change is claimed.
- `[~]` Pin and inspect [Stream 2026.03](vyos/image.json) as an isolated lab candidate (2026-10-16): the official Stream-key Minisign signature/trusted comment and SHA-256 pass; image version/build revision match. Its authenticated filesystem has no Suricata files/schema, unlike rolling documentation. The owner explicitly chose to keep Stream and defer onboard Suricata, not switch to rolling or add a sensor container. Native boot/firewall ordering, core feature parity and update/recovery qualification remain open; signature verification is not production approval.
- `[~]` Add the [recorded non-secret baseline and synthetic lab profile](vyos/baseline.yml), [native template](vyos/config.boot.j2) and [localhost-only Ansible renderer](ansible/playbooks/vyos-render.yml). The retained pre-Save export grounds eight reservations/client IDs, DHCP `/24` versus recorded LAN `/16`, recursive/local DNS, WAN/IPv6 and Plex reflection facts. Private rendering/idempotence and unsafe-input refusal pass; controller tools are documented. Complete production parity only after prefix/lease/DNS/IPv6/reflection and image blockers are resolved; no production renderer or deployment exists yet.
- `[ ]` Declare a separate Terraform VM with an unused ID, using verified current CPU/RAM/disk/firmware settings as the starting point. Preserve VM 100 and its disk; do not apply its unimported scaffold or create the replacement by changing the old resource. Stage without production PCI ownership or autostart.
- `[~]` Local preparation checks pass (2026-10-16): [three focused tests](scripts/vyos-config.test.mjs) use the real Ansible renderer and the authenticated image's own configuration parser; all 105 generated command paths exist in its release schema. This is not a boot, semantic commit, DHCP-offer or runtime acceptance test. Still boot/test isolated interfaces for persistence, routing/NAT/services/log attribution and compare/commit-confirm/confirm/save/timeout recovery. No production DHCP/RA or duplicate gateway advertisement; physical NIC/WAN acceptance remains a cutover check. Reproduce via the [preparation workflow](vyos/README.md).
- `[ ]` Provide the read-only blocked-connection view before accepting the replacement: time/IP/port/protocol/interface/VLAN/verdict/rule filters and deployed-rule descriptions/revision. Distinguish Suricata alert/drop events only when the deferred service is introduced; do not imply IDS coverage now. Prefer an existing log UI/backend such as Grafana/Loki; keep local SSH/console diagnosis and query-only UI credentials. A custom frontend or full SIEM is not required.
- `[!]` Resolve the paused OPNsense LAN Save before any router restart: last recorded runtime `/16`, saved `/24` plus collateral interface-field changes, no Apply sent. Refresh actual state and approve its exact resolution/rollback baseline. Do not blindly repeat Save/Apply, restore the full XML or reboot. Preserve completed host/client `/24` work.
- `[ ]` Approve one bounded cutover with independent controller connectivity and literal-IP PVE/console recovery. Stop/verify OPNsense, transfer exclusive PCI ownership, start VyOS on the agreed native L2/IP/prefix and set exclusive startup ownership. Do not combine VLAN tagging, Technitium handoff or new IPS blocking; expect interruption and old sessions to reset.
- `[ ]` Accept management/operator/NAS reachability, WAN, DHCP/DNS, applicable IPv6, required NAT/policy and a known blocked-flow diagnosis; confirm/save native configuration. On failure stop VyOS, return exact devices/startup ownership and boot the agreed OPNsense baseline. Retain its VM/disk; proceed to Phase 1 only after acceptance.

---

## 1. Network Foundation

These must be complete before anything that depends on VLAN isolation or correct name resolution works end-to-end.
Follow the [execution order](#execution-order), not the numerical order of the
subsections below. G1 applies per change; G4 applies to the root/resource being
used. Resume live VLAN activation only after Phase 0.6 accepts VyOS. Build G5
readiness through this phase, retain the serving router's interim client
DNS/DHCP, and transfer to Technitium only after supporting paths/interfaces are
ready. Final G2 DNS and unrelated G3 repairs are not entry gates.

An offline AP blocks wireless steering and wireless acceptance, not an otherwise
safe wired pilot. Apply only the prerequisites for the actual batch; similarly,
a Talos network operation needs its affected quorum/disruption checks, not
completion of unrelated dashboard certificates or every Fleet repair.

### 1.1 VLAN Steering on WAP (`ap.owl.red`)
- `[x]` Complete the known-client target allocation registry (2026-10-14): workstation, LG phone, Shield and WUUK cameras have reservations/DNS; tablet is pending target-SSID MAC; work laptop remains dynamic. No live VLAN cutover performed.
- `[!]` Restore/identify the AP uplink before SSID inspection: port 18 had no link and `10.0.10.40` was unreachable in the 2026-10-14 audit
- `[ ]` Log into OpenWrt on `10.0.10.40`
- `[ ]` Confirm SSID → VLAN bridge mappings:
  - `owl.red` → VLAN 20 (`private-net`)
  - `silence of the lans` → VLAN 30 (`guest-net`)
  - IoT → explicit VLAN 40 or VLAN 50 membership decided below
- `[ ]` Prefer separate IoT SSIDs (`owl.red-iot-local` VLAN 40, `owl.red-iot-cloud` VLAN 50) unless the actual OpenWrt/radio build proves a supported per-device/per-credential dynamic VLAN mechanism. A single SSID plus OPNsense MAC-based DHCP reservations does not assign Layer-2 VLAN membership. Record the chosen trade-off before changing SSIDs.
- `[ ]` After Phase 1.5's overlap, path and service-authority checks, move known private clients in small batches:
  - `w1ngz.owl.red` → `10.0.20.10`
  - `paranoid-android.owl.red` → `10.0.20.11`
  - Bedside tablet → planned `10.0.20.12`; verify target-SSID MAC before confirming reservation/DNS
  - Work laptop `KAM1WL102916` → dynamic DHCP, no fixed lease
- `[ ]` After those same checks, move IoT devices to the correct SSID:
  - `ecobee.owl.red` → VLAN 50 (last recorded on the flat management network)
  - `printer.owl.red` (Canon) → VLAN 40 (last recorded on the flat management network)
  - `bambu.owl.red` → VLAN 40 (needs to join network)
  - `shield.owl.red` → VLAN 50, `10.0.50.11`; explicitly allow required local-media access
  - `wuuk-ptz-foyer.owl.red` → VLAN 40, `10.0.40.12`
  - `wuuk-ptz-office.owl.red` → VLAN 40, `10.0.40.13`
  - Inspect and explicitly remove any legacy VLAN 10 camera reservations during the approved migration; test local operation without internet

### 1.2 VLAN Access Rules on Switch (`switch.owl.red`)
- Audit baseline: all ports were Optional/PVID 1 and every VLAN listed only disabled port 5. Port names alone do not establish working trunks or access VLANs.
- `[ ]` Reconcile `ansible/switch_configs/css326.yml` with actual cabling; the audit found edge management on SW24, not the historical SW05. Record PVID, ingress receive mode, VLAN membership and egress tagging at each switch/router/PVE/LXC/AP boundary.
- `[ ]` Save the SwOS configuration privately and test a designated physical recovery/access port before changing filtering or management VLAN. CSS326 has no serial console; reset is disruptive last-resort recovery, not an ordinary rollback.
- `[ ]` Review the exact diff and apply only the approved port/VLAN batch via `swos-apply-config.yml` or its reviewed owning interface; do not apply the full target map to discover whether it works
- `[ ]` Confirm the actual AP trunk carries VLANs 20/30/40/50 to the matching router paths without disrupting legacy management. SW18 is a recorded location to verify, not proof of current cabling.

### 1.3 VyOS VLAN Firewall Rules
- **Requires:** Phase 0.6 router acceptance; all target rules remain inactive during the parity replacement
- `[ ]` Confirm VLAN 10 → all VLANs (admin rule) exists
- `[ ]` Confirm VLAN 20 → internet + VLAN 10 services only (no lateral)
- `[ ]` Confirm VLAN 40 → LAN only, no internet, no lateral movement
- `[ ]` Confirm VLAN 50 → internet only, no lateral movement
- `[ ]` Guest VLAN 30 isolation rules (see `README.md` captive portal section)

### 1.5 Subnet Migration: `/16` → `/24` per VLAN

**Observed:** after the approved host/client changes, all six PVE management
addresses (edge `.3`, storage `.4`, compute `.11-.14`) and all four Talos guest
node addresses (`.21-.24`) use `/24`. NAS `.5` now uses `/24` after the approved
DHCP mask/renewal step; the active range advertises `/24`. Operator Ethernet
`.174` is also `/24` after its separately approved 20:32Z renewal. Router LAN
`.1` was last verified running `/16` on the legacy untagged L2; a later Save
persisted `/24` but was stopped before Apply. Resolve that paused baseline in
Phase 0.6 before any router restart. Other client masks await verification. Technitium
has one untagged `10.0.10.30/24` NIC and five `/24` scope definitions, with VLAN
10-50 disabled after the approved guard rollout and daemon-persistence check;
zero leases were observed. Those are not five operational VLANs.
The legacy connected network is `10.0.0.0/16`, which contains every target `/24`.
Do not route those targets onto separate L2 domains while relying on legacy
hosts' `/16` on-link behavior. Mask contraction is distinct from VLAN tagging.

**Control connection:** disruptive router work can disconnect the assistant.
The owner offers a cellular hotspot while keeping LAN Ethernet connected, but
internet/DNS egress through that hotspot and local Ethernet routes must be
verified before any such live step. Do not change host routing automatically
or treat console access alone as preserved assistant connectivity. Preparation
and offline tests do not require enabling the hotspot.

For the bounded range-only deployment below, the owner explicitly requested
proceeding without Windows route changes after the route-selection concern was
explained. The hotspot was connected, but independent egress was not claimed.
Fresh affected-field preimages and the demonstrated router console were the
scoped recovery basis; no full-current XML export or restore rehearsal is
claimed. This decision does not approve a subnet/VLAN change or remove its own
recovery and connectivity requirements.

1. **Inventory and choose the intermediate states.**
  - `[~]` Capture live OPNsense prefix, routes, DHCP engine, pool, leases, reservations, DNS options and service bindings. The dated refresh returns 15 leases and eight reservations, all current LAN lease/ARP addresses inside `10.0.10.0/24`; the owner reports old outside-range entries are historical. This does not prove absence of every offline/static client. The approved 2026-10-16 range correction now ends at `.199`; preserve the unchanged 24-hour lease/renewal implications.
  - `[~]` Record masks, gateways and L2 attachment. All six PVE management addresses (edge `.3`, storage `.4`, compute `.11-.14`), four Talos guests `.21-.24`, NAS `.5` and operator Ethernet `.174` now use `/24`; router LAN `.1` remains `/16`. Dnsmasq advertises `/24`; other clients are not yet verified renewed. Ethernet renewal preserves the address/NIC/gateway/DNS/metrics and passes management/internet checks at 20:33Z. Technitium and PDM already use `/24`; API VIP `.20` remains a verified `/32`, not a node-mask error. Storage PVE and the operator already use Technitium DNS directly. Storage-management `.6`, power-strip `.9` settings and the device behind AP-labelled port 18 remain unverified. See the [dated assessment](docs/issues/008-live-state-vs-repository.md#follow-up-mask-inventory-and-recovery-assessment).
  - `[x]` Identify the active operator NIC as USB Ethernet `84:3a:5b:87:91:dd`, `.174/16`, gateway `.1`, DNS `.30`. Initial Wi-Fi was disconnected; a hotspot was connected later, without claiming it became the selected internet path. Owner identifies switch port 22 (`cab-trunk`) as the protected current path. Do not change its native PVID 1/untagged behavior or assume a disabled spare port is a usable recovery port.
  - `[x]` Verify router VM 100's console menu through PVE at literal `10.0.10.3:8006` (user screenshot, 2026-10-15). OPNsense `26.1.9` shows LAN `ixl1` at `10.0.10.1/16` and the interactive menu. No console option was selected as part of this check; affected-configuration restore and outage recovery are not thereby rehearsed.
  - `[x]` Prepare the narrow Dnsmasq range-end candidate `.200` to `.199` with default-deny activation, fresh private preimages and eight passing loopback-only cases. Locked provider `0.24.0` supports Dnsmasq hosts but not ranges; the [Ansible playbook](ansible/playbooks/opnsense-dhcp-range.yml) is the documented surgical exception, not a whole-root Terraform apply.
  - `[x]` Apply the explicitly approved overlap fix after fresh ownership/preimage checks (2026-10-16T00:40:51Z-00:41:00Z). The field-only save and Dnsmasq reconfigure passed; only `end_addr` differs, all eight reservations and LAN `.1/16` are unchanged, service/DNS/HTTPS and a correlated zero-drop DHCP offer check pass. Scoped recovery artifacts are retained; no Windows route change or automatic rollback was made.
  - `[x]` Retain the current router configuration for the bounded LAN-mask candidate (2026-10-16T20:45:30Z): a real WebUI current export, 72,671 bytes, verified LAN `.1/16`, DHCP `/24` and corrected pool, owner-only outside Git. The earlier August history download is not relabeled current. Read-only form check at 20:52Z finds no pending interface Apply and only `subnet: 16 -> 24` in the proposed form; IPv6 `idassoc6` is preserved. The [cutover procedure](terraform/opnsense/README.md#router-lan-mask-cutover) records exact inverse, console path and focused acceptance; a restore was not rehearsed.
  - `[!]` LAN-mask approval was given and one Save ran at 20:59Z (2026-10-16), persisting `subnet: 16 -> 24`. The whole-config guard detected other interface-field changes and stopped before Apply; no accepted runtime prefix change is claimed. The transaction is paused under Phase 0.6: inspect actual state and agree exact resolution before any router restart, Apply or replacement. Do not request the already-given approval again as though no Save occurred, or treat it as approval for a VyOS cutover.
  - `[ ]` Approve in-place contraction on the existing L2 if practical; otherwise document a non-overlapping temporary subnet and its bidirectional routes/renumbering. Do not silently change the final allocation plan or assume a staged overlapping router configuration is safe.
  - `[ ]` Define each change's exact previous/new values, acceptable interruption, checks, rollback trigger and inverse operation. Test recovery access for the affected component before changing its management path.
  - `[x]` Prepare the isolated worker-host pilot `.14/16` to `.14/24` through the [guarded Ansible playbook](ansible/playbooks/proxmox-prefix-pilot.yml), with no router/storage/operator-path change. Eleven final offline cases cover rollback/locking, actual staged-model assertions and only the verified zero-byte PVE-generated SDN include. Initial and converged connected previews make zero changes. Future live activation still defaults off.
  - `[x]` Explicitly approve and run the one-host pilot with private on/off-host preimages and host-local rollback (2026-10-16T01:13:43Z-01:14:15Z). The first stage was safely refused for PVE-generated header/formatting and reverted without reload. Repaired guards compare every non-comment directive and all parsed interface fields except the approved CIDR. The successful PVE task finished `OK`; runtime/persisted `.14/24`, SSH, gateway, six-node quorum and guest readiness passed before lock-protected timer cancellation. No pending file or triggered rollback remains. The guest stays `/16`; the rest of the contraction is not approved by this pilot.
  - `[x]` Extend the same guarded playbook to an explicit compute-only allowlist for `cp1`, `cp2`, `cp3` and the completed worker. Twelve offline cases cover canonical mappings, single-host limits and refused router/storage/cross-host paths. Connected `cp1`/`cp2`/`cp3` previews pass with zero changes, including direct guest API readiness and PDM reachability on `cp1`.
  - `[x]` Approve and apply `cp1` `.11/24`, `cp2` `.12/24`, `cp3` `.13/24` sequentially (2026-10-16T01:39:42Z-01:42:54Z), preserving addresses/gateway/DNS/bridge/VLAN and guest prefixes. Each host's 180-second rollback was confirmed inactive before the next began. Final acceptance at 01:43:58Z shows matching runtime/persisted `/24`, no pending files or rollback, six online/quorate PVE members, all four Kubernetes nodes Ready, three direct API readiness checks passing and PDM TCP reachable. Router, storage, Windows, NAS and guest-version configuration were not changed.
  - `[x]` Prepare edge PVE management `.3/16` to `.3/24` using the same guarded path with `onboard` and all seven reviewed interface stanzas. Thirteen offline cases and a 19-check, zero-change connected preview pass. Protected router/Technitium guest configs and process identities, TCP ports and explicit DNS checks are required; no router guest interface/power setting is written. Storage was excluded from that scope.
  - `[x]` Explicitly approve and run only edge PVE management `.3/24` (2026-10-16T02:05:22Z-02:05:58Z), with fresh on/off-host preimages and local rollback. An initial stanza-order-only stage was safely refused and reverted without reload; repaired guards preserve all directive content and full parsed models. Final acceptance confirms runtime/persisted `.3/24`, `onboard`, inactive confirmed timer/no pending file, unchanged router/Technitium guest configs and process identities, healthy DNS/HTTPS, six-node quorum and four Ready Kubernetes nodes. Router `.1/16`, passthrough, guest prefixes, storage and Windows were not changed.

  - `[x]` Prepare storage PVE management `.4/16` to `.4/24` using the same one-host, default-off path with `bond0` and all five reviewed interface stanzas. Fourteen offline cases pass, including bond model/runtime and NAS VM device/PID/network drift refusals. Connected preview at 2026-10-16T16:25:51Z reports `ok=21`, `changed=0`, `failed=0`; NAS remains `.5/16`, HTTPS/SMB TCP responds and VM 101 is running. No storage staging, timer or reload has occurred.
  - `[x]` Explicitly approve and run only storage PVE management `.4/24` (2026-10-16T16:36:08Z-16:36:52Z), with fresh private on/off-host preimages and local rollback. Initial API staging safely refused added bond-member `auto` flags before timer/reload and was reverted without reload. Storage-only exact-preimage staging preserves those flags; fifteen offline cases pass. Final 16:37:45Z read-back verifies runtime/persisted `/24`, source-only CIDR change, unchanged bond/NAS VM configuration/QEMU PID/`.5/16`/MAC and reachable HTTPS/SMB TCP, six-node quorum, confirmed inactive timer and no pending file/rollback. NAS settings, disks, array, passthrough, USB boot, power and unrelated services were not changed.

  - `[x]` Prepare the four Talos guest management-mask candidates `.21-.24/16 -> /24` using the [default-preview controller](scripts/talos-prefix-pilot.mjs), exact live configurations and checksum-verified matching `talosctl 1.8.1`. Four offline cases pass; all four connected no-reboot server previews pass with no changes. JSON Patch tests role/hostname/MAC/old address list before replacement; strategic merge would append `/24` to `/16` and is not used. Runtime gateway, four Ready nodes, API VIP plus three direct APIs, three voting etcd members and the VIP `/32` pass. The mixed Terraform `1.7.5` generation pin is not applied or changed.
  - `[x]` Approve and apply the Talos guest masks one at a time, worker first then cp1/cp2/cp3 (confirmations 2026-10-16T17:02:08Z-17:02:59Z). Each native three-minute `try` was confirmed without reboot after whole-config equality except CIDR, runtime `/24`, unchanged boot identity/version/gateway, four Ready nodes, three direct/API VIP readiness, exactly one `.20/32` and three voting etcd members. Terraform node CIDRs, bootstrap MAC-selector patches and current inventory now match `/24`; five offline tests and the touched Terraform format check pass. No whole-root apply, state refresh, Talos/Kubernetes upgrade, DNS/gateway/VIP change or guest power operation ran. The older generation pin/state drift still requires review before any future Terraform apply; router/NAS/operator masks, VLANs and DNS/DHCP authority remain separate.

  **Assessment, not apply approval:** mask-only contraction remains the leading
  option for the observed addresses. The operator-to-PVE `.3` path is on-link
  in the captured inventory, and the owner has now shown the router VM's actual
  console menu through PVE. Configuration restore and the exact inverse change
  remain unverified; console access alone does not complete them. Appliance checks apply before
  changing or depending on their return paths; AP management gates wireless or
  affected AP work, not independent wired preparation. Preserve the API VIP
  `/32`, existing DNS overrides and the native L2 while a scoped IaC/rollback
  procedure is prepared. Completed approvals cover the DHCP range boundary and
  advertised mask, six PVE masks, four Talos masks, NAS DHCP mask acceptance and
  the separately approved operator Ethernet renewal. No router mask, VLAN or
  DNS/DHCP authority migration is claimed by those results. The separately
  approved router Save remains paused before Apply; it is not an accepted
  prefix change or permission to restart the router.

2. **Prepare the serving-state guard and non-disruptive configuration.**
  - `[x]` Prepare and offline-test explicit scope lifecycle/read-back reconciliation, disabled intent for all five scopes and the default-false Nix activation lock (20 regression cases). Existing addresses, masks, DNS and lease values are unchanged; missing scopes fail before API writes rather than being created enabled.
  - `[x]` Validate the actual Nix module, packaged sync/ShellCheck and full LXC system closure locally without activation (2026-10-14). After read-only target comparison, pin `nix/hosts/technitium/check.nix` to the live NixOS `25.11.10830.d7a713c0b7e4` revision and rebuild successfully; no remote copy, channel update or host switch was performed.
  - `[x]` Compare the live/candidate closures and module hashes: only sync executable/unit and aggregate wrappers change; DNS package, .NET runtime and DNS unit are identical. Verify live Technitium 14.0, token DHCP View/Modify and existing scope/lease state through GET calls; no lifecycle mutation test performed.
  - `[x]` Prepare the narrower `technitium_nixos` Ansible task selection, default-false channel updates and fatal nonzero rebuild handling; syntax/task-list and connected strict-host-key `--check` previews pass. The asynchronous rebuild explicitly skips in check mode; no activation was performed.
  - `[x]` Privately retain the affected Nix files, current generation, DHCP configuration/state and exact code/source rollback instructions (2026-10-15). Verify saved hashes and owner-only permissions, unchanged live input, retained generation and independent Proxmox execution path; no token/private key copied. Recovery access is tested, not an actual rollback or router/switch recovery rehearsal.
  - `[x]` Obtain explicit guard-only approval, recheck the baseline, then apply only the Nix-host update with disabled intent and activation locked (2026-10-15). The reviewed generation is running; approved reconciliation returned success/0 and all five scopes read back disabled. DNS process/health, scope properties, addresses and routes are unchanged; timer active, zero leases, no channel update or client handoff.
  - `[x]` Prove bounded native-LAN no-offer behavior from physical `cp1`, before and after a guarded sync-unit restart (2026-10-15). Two DISCOVER-only probes with one synthetic identity reached existing Technitium `eth0`; only OPNsense offered. All four captures contain matching transactions and zero kernel drops. Five scopes remain disabled, DNS PID unchanged, client addressing unchanged; no lease was accepted or released.
  - `[x]` Verify disabled-state persistence across an explicitly approved DNS-daemon restart (2026-10-15). Pause the idle sync timer; verify saved version-9 scope flags, authenticated startup API state and unchanged file hashes before reconciliation. The new daemon is healthy with no UDP 67 listener; the post-restart wired probe sees only OPNsense offers with zero drops. Timer restored, DNS healthy, no network/client-authority change.
  - `[ ]` Repeat path-specific API/packet acceptance for staged target VLANs before claiming them safe. Whole-container boot, IPv6/RA and real-client renewal/handoff are not covered by the daemon-only test; separately approve any reboot included in a later change. Coordinate timer/in-flight sync and preserve the existing client authority.
  - `[ ]` Review only the affected IaC resources/state and stage the approved port/bridge/router/AP definitions. Do not deploy the full five-NIC LXC target or run bootstrap/sync as a substitute for a migration procedure.
3. **Contract the legacy network before activating contained routed subnets.**
  - `[x]` Establish the NAS addressing authority (2026-10-16T19:50:45Z): `.5/16` is dynamic on `eth0`, persisted `USE_DHCP[0]="yes"`, routes are DHCP-managed and resolver is `.1`; HTTPS/SMB TCP responds. Keep `network.cfg` in its manual lane, do not create a standalone static-mask/DNS writer, and coordinate NAS/operator lease renewal with the active router/DHCP transition. No NAS service, lease or configuration change was made.
  - `[x]` Prepare an explicit Dnsmasq range-mask candidate, empty to `255.255.255.0`, using the same guarded one-object Ansible exception. Twelve offline cases pass; connected check mode at 20:00:38Z reports only the proposed change (`ok=10`, `changed=1`, `failed=0`) with no save/reconfigure. All 15 returned leases and eight current reservations fit the retained `/24`, including matching NAS MAC/reservation. Before-wire packet review at 20:07:05Z verifies correlated transaction `0x15fb973f`, one DISCOVER/OPNsense OFFER on both capture paths, zero drops, `/16`, gateway/DNS `.1`, lease 86400; no lease accepted or released. NAS config-hash/boot/network evidence and the exact inverse are retained/documented.
  - `[x]` Explicitly approve and apply only the DHCP mask (2026-10-16T20:16:44Z-20:16:55Z; `ok=25`, `changed=5`, `failed=0`). Complete model comparison shows exactly one `subnet_mask` change. Post-wire transaction `0x2d9ce05d` is correlated on both capture paths with zero drops, `/24`, correct broadcast and unchanged gateway/DNS/lease timing; only OPNsense offers. Approved NAS normal IPv4 renewal reaches `.5/24`; a kernel default-route deletion during prefix replacement was detected, and only the exact saved default route was restored at 20:20:44Z. Controlled stable-`/24` renewal passes at 20:22:08Z with gateway retained, unchanged NAS config hash/boot/MAC/IPv6/daemon/non-eth0 routes and working NAS/external HTTPS. No release/rebind/service restart or persistent NAS edit occurred. Final 20:24:49Z router LAN remains `.1/16`, all eight reservations unchanged, DNS healthy and four Kubernetes nodes Ready; operator Ethernet remains DHCP `.174/16`, read only.
  - `[x]` Separately approve and request only operator Ethernet IPv4 renewal (20:32:14Z): `.174/16 -> .174/24`, with unchanged address/NIC/gateway/DNS/interface and route metrics. No release, NIC reset, IPv6 or hotspot-routing change. At 20:33:26Z router/edge/storage/NAS ports and external HTTPS pass; private before/after evidence retained.
  - `[ ]` Verify other client/static-appliance masks and coordinate any remaining renewals; do not claim every existing lease has `/24`. Preserve `.1/16` and the unchanged authority until the later scoped router/interface cutover is ready.
  - `[x]` Refresh remaining appliance entry points read-only (2026-10-16 UTC): CSS326 SwOS 2.18 reports `.2`, static fallback `.2` and `DHCP with fallback`; the system API exposes no subnet-mask field, so this is not switch `/24` acceptance. Storage BMC `.6` HTTPS responds and APC `.9` redirects to its management page. Storage has an existing local IPMI device but no `ipmitool`; no package/module install, appliance login/write, outlet/power or port/VLAN action was performed by these checks. BMC/PDU masks and current router export remain to be resolved before their affected cutover.
  - `[ ]` After Phase 0.6 establishes the accepted router baseline, plan the serving router's pool/prefix and remaining client lease renewal together; a shortened lease only takes effect after renewal. Handle static masks and clients outside the retained `/24` explicitly, without overlapping active allocations.
  - `[ ]` Change only remaining approved host/client masks and, if still required, the legacy router prefix in the documented order while retaining the native management L2, addresses and interim router DNS/DHCP. Account for derived routes/rules; do not rerun completed host/client migrations.
  - `[ ]` Check both directions to the operator, gateway, PVE quorum, Talos/etcd/API VIP, ingress VIP and NAS after each bounded batch. Stop and restore the affected previous values on failure; do not proceed to VLAN tagging to fix an unresolved mask problem.
4. **Prove VLAN paths after VyOS acceptance, before Technitium handoff.**
  - `[ ]` Activate one approved test port/VLAN path and matching VyOS gateway/firewall/NAT policy. Use the agreed interim VyOS DHCP/DNS for pilot clients; a static test client is acceptable before client DHCP is staged.
  - `[ ]` Verify address, `/24`, gateway, expected DHCP server/DNS options, internet policy and return traffic from a real LAN client. WSL reachability alone cannot prove DHCP broadcasts, VLAN membership or isolation.
  - `[ ]` Complete the required switch/AP/PVE/LXC paths with Technitium DHCP still guarded; verify scope-local `.30` DNS listeners and firewall exposure. Do not put the same `10.0.10.0/24` address space on both native and tagged router interfaces.
5. **Approve and perform the DNS/DHCP handoff, then expand.**
  - `[ ]` Reconcile outstanding leases, reservations and pool exclusions for each broadcast domain; keep a rollback lease map so neither authority reissues an address already in use
  - `[ ]` After supporting paths/interfaces pass, approve the exact handoff batch. Disable VyOS DHCP for that domain before enabling its Technitium scope, then renew test clients and verify DNS. Keep unmigrated domains on their accepted interim authority; do not enable every scope at once.
  - `[ ]` Verify VLAN-local DNS, public resolution and `owl.red` answers from LAN clients, gateway-dependent hosts and existing pods before changing their configured resolver path or enforcing DNS egress
  - `[ ]` Migrate small client groups, test required camera/printer/media flows, and perform the separately planned management-tag transition with the tested operator/recovery port still available. On DHCP rollback, disable the new authority before restoring the old one and account for leases issued in the interim.
  - `[ ]` Close G2 only after the coordinated resolver change is verified; tighten DNS policy last. Remove temporary paths and stale active `/16` configuration after acceptance, but retain dated audit/history references.

### 1.6 Captive Portal (`captive.owl.red`)

- **Requires:** a working VLAN 30 L2/L3 path, verified DNS/DHCP options and isolation from 1.1/1.3/1.5; the portal does not gate initial VLAN preparation
- `[ ]` Select a proven enforcement engine/placement compatible with the VyOS guest path; a central web/auth service alone is not enforcement, and the weak WAP must not host the heavy portal service
- `[ ]` Validate unauthenticated/authenticated enforcement for IPv4 and applicable IPv6 without exposing management or bypassing guest isolation
- `[ ]` Confirm `captive.owl.red` resolves from VLAN 30 clients
- `[ ]` Test: unauthenticated VLAN 30 client hits splash page
- `[ ]` Test: authenticated client reaches internet, blocked from other VLANs
- `[ ]` Serve a valid CAPPORT API and HTTPS portal; use captive HTTP discovery/option 114, not interception of arbitrary HTTPS. Replace the OPNsense-specific endpoint before advertising it from the accepted DHCP authority, finally Technitium.

---

## 2. Network Cabinet

- `[ ]` Document existing patch panel port assignments (PP1–PP39) in full
- `[ ]` Label all cables front and rear
- `[ ]` Verify all active patch panel runs match `README.md` front patch table
- `[ ]` Identify and label any unused ports
- `[ ]` Tidy cable management; photograph final state for docs

---

## 3. Remote Access — Tailscale

Audit baseline: Tailscale is online on the NAS, but MagicDNS is disabled. This
does not prove management-subnet routing, split-DNS, or an exit-node design.

- `[ ]` Review whether an additional exit node is needed beyond the running NAS connector; choose a supported placement without requiring an OPNsense plugin or bundling it into the router swap
- `[ ]` Deploy Tailscale on chosen host
- `[ ]` Confirm `owl.red` split-DNS via Tailscale MagicDNS or override to Technitium
- `[ ]` Verify VLAN 10 services reachable over Tailscale from outside network
- `[ ]` Decide whether IoT VLANs are exposed over Tailscale (probably not)

---

## 4. Shared Storage for HA workloads (NAS = central store)

The NAS is the central shared store for **all HA/stateful things** — k8s PVCs (Home Assistant, *arr config),
Proxmox CT/VM disks on shared storage (real failover), other LXC/VMs, and personal files. **Plan + design:
[`docs/guides/shared-storage.md`](docs/guides/shared-storage.md); decision: [ADR 018](docs/decisions/018-storage-backend.md).**

- `[x]` Decide storage backend → **NFS from `nas.owl.red`, reusing existing shares** (NFS for HA/infra: k8s/Proxmox/LXC;
  SMB for personal). Longhorn remains medium-term after capacity/storage evaluation; Unraid's VM migration is already complete. (Ceph rejected: too heavy for 4 small nodes.)
- `[ ]` Close G6 power/export safety checks before NFS activation; the Ansible file lane is still a scaffold and must be implemented/validated before using it for writes
- `[ ]` Lock intended NFS exports (`shareSecurityNFS=private` + reviewed host allowlists); fix public defaults on all intended shares and exclude `system` — Ansible file-lane (`--check` first)
- `[ ]` Enable NFS globally on Unraid (`shareNFSEnabled=yes`) — array untouched
- `[ ]` k8s: deploy NFS CSI (`nfs-subdir-external-provisioner`/`democratic-csi`) via Fleet → `StorageClass` → smoke-test a PVC (write + survive reschedule)
- `[ ]` Proxmox: `pvesm add nfs` (images/rootdir/iso/backup) on each node → verify CT HA failover (unblocks PDM HA, §11/§13)
- `[ ]` Document StorageClass name, NFS paths, and per-share export rules back into the guide + README

---

## 5. Home Assistant

- **Requires:** change-scoped G1; G2/G3 where the deployment uses DNS/Fleet/ingress; G6 and 4 for production stateful storage; 1.1 for IoT discovery
- `[ ]` Create `gitops/home-assistant/` Fleet app directory
- `[ ]` Deploy via Helm chart (`home-assistant` from `pajikos` or raw manifests)
- `[ ]` Validate the proposed 3-replica/anti-affinity design against Home Assistant's supported state/database model before choosing a workload topology; NFS alone does not make an application multi-writer safe
- `[ ]` Persistent volume via NFS StorageClass (10 GiB minimum for config + DB)
- `[ ]` Choose an unused Home Assistant hostname before adding its DNS/ingress; `home.owl.red` already serves Homepage and must not be silently reassigned
- `[ ]` TLS via cert-manager + Traefik IngressRoute (matches existing pattern)
- `[ ]` Home Assistant `homeassistant.http.use_x_forwarded_for` + trusted proxy set to Traefik pod CIDR
- `[ ]` IoT device discovery: HA needs mDNS/multicast access to VLAN 40/50
  - Either run HA with `hostNetwork: true` on a dedicated node
  - Or use native VyOS mDNS repetition on only the reviewed interfaces; allow required discovery/service flows without broad IoT-to-management access
- `[ ]` Integrate ecobee, Bambu A1, Canon printer once network is correct

---

## 6. Certificate Manager — Single Authority for Everything

Currently cert-manager runs on k8s only. LXC workloads (Technitium) and any off-cluster services get no automated certs.

Repairing current management frontend certificates and runtime TLS policy is G3
work now. The wider off-cluster certificate distribution below is a later
milestone, not a prerequisite for using existing cert-manager DNS-01 issuance.

- `[ ]` Decide scope:
  - Option A: Keep cert-manager on k8s only; LXC services use wildcard cert distributed by Ansible
  - Option B: Run `step-ca` or a shared ACME CA accessible by all hosts
  - **Likely: wildcard cert via cert-manager, distributed to LXCs via Bitwarden Secrets + Ansible**
- `[ ]` Generate wildcard `*.owl.red` cert in cert-manager (DNS-01 via Cloudflare — already configured)
- `[ ]` Export wildcard cert to a k8s Secret in a shared namespace
- `[ ]` Ansible task: pull cert from Bitwarden/k8s Secret, deploy to LXC `/etc/ssl/`
- `[ ]` Technitium LXC: configure HTTPS using wildcard cert
- `[ ]` Any future off-cluster service: same Ansible role

---

## 7. App Migration to Cluster

Move remaining self-hosted apps from wherever they are now onto the Talos cluster.

- **Requires:** change-scoped G1; verified DNS/Fleet/ingress and certificate policy for the app (G2/G3); G4 only for infrastructure changes. Production stateful migrations also require G6 and Phase 4's storage tests.
- `[ ]` Inventory all currently running apps and their current hosts
- `[ ]` Prioritize migration order (stateless first, stateful after storage is proven)
- `[ ]` Create `gitops/<app>/` Fleet directories per app, matching existing conventions
- `[ ]` Apps known to need migration (from README workload table):
  - `[ ]` Plex (already on the Unraid VM; migration still requires proven GPU scheduling, persistent state and identity preservation)
  - `[ ]` Arr stack (Radarr, Sonarr, etc.)
  - `[ ]` qBittorrent
  - `[ ]` slskd
  - `[ ]` Seer (Overseerr/Jellyseerr)
  - `[ ]` Tautulli
  - `[ ]` Reclaimerr
  - `[ ]` speedtest-tracker
  - `[ ]` Librespeed
  - `[x]` Homepage is already on Kubernetes via Fleet at `home.owl.red` (verified 2026-10-14); not an outstanding migration
  - `[ ]` flaresolver
- `[ ]` For each app: IngressRoute + TLS cert + PVC + resource limits

---

## 8. Proxmox Backup Server (`pbs.owl.red`)

No PBS guest, PVE backup/replication jobs or registered local backup objects were
found in the October audit; the user subsequently confirmed there are no backups.
This remains a separate data-protection gap. Network G1 requires affected
configuration/state rollback and practical recovery access, not a full NAS-data
backup or completion of this platform. Storage or destructive maintenance needs
its own approved protection plan; it is not part of the network transition.

- `[ ]` Provision PBS VM on `storage.pve.owl.red`
- `[ ]` Assign MAC, update `dhcp-reservations.json` (currently TBD at `10.0.10.33`)
- `[ ]` Configure backup jobs for all PVE VMs and LXCs
- `[ ]` Add `pbs.owl.red` to DNS zone (already has A record — verify IP after provisioning)

---

## 9. External Access — Cloudflare Tunnel

For services that should be reachable from the internet without opening inbound ports. Complements Tailscale (which handles personal/admin access) — tunnel handles public-facing services like a self-hosted wiki, status page, or anything else intentionally public.

- **Requires:** G2/G3 and a fresh authenticated firewall exposure review. The public unproxied wildcard A record was still present in the audit; inventory dependencies/DDNS ownership before removing it under ADR 012.
- `[ ]` Decide which services get public exposure (start with zero — add deliberately)
- `[ ]` Codify the Cloudflare Tunnel and required Access policies in the selected account IaC lane; inject connector credentials from Bitwarden without a second dashboard-only configuration writer
- `[ ]` Deploy `cloudflared` connector:
  - Option A: k8s Deployment in its own namespace (`cloudflared`)
  - Option B: LXC on `edge.pve` — simpler, no k8s dependency
  - **Likely: k8s Deployment so it benefits from cluster HA**
- `[ ]` Configure tunnel routes in `cloudflared` config (ingress rules by hostname)
- `[ ]` Verify public hostname resolves via Cloudflare and traffic reaches internal service through Traefik
- `[ ]` Codify scoped VyOS connector egress: Cloudflare's documented destinations, outbound UDP/TCP `7844` for QUIC/HTTP2, required DNS and feature-specific HTTPS endpoints. No inbound web forward; keep local access independent of the tunnel.
- `[ ]` Optional future evaluation: [Anubis](https://github.com/TecharoHQ/anubis) for anonymous/public browser endpoints only if the selected Cloudflare protections leave a demonstrated bot/scraping problem. Cloudflare Tunnel alone is transport; Access-authenticated private apps may not need another challenge. Keep APIs, webhooks and legitimate automation usable. Not a router, ingress or Zero Trust migration prerequisite; no deployment selected.
- See: `docs/decisions/012-cloudflare-tunnel-no-inbound-port-forwarding.md`

---

## 10. Cloudflare DNS — GitOps Managed

Currently Cloudflare DNS records are managed manually in the dashboard. Make them code.

- `[ ]` Choose tooling:
  - Option A: Terraform Cloudflare provider — fits existing `terraform/` structure
  - Option B: `external-dns` on k8s with Cloudflare webhook — automatic from Ingress/IngressRoute annotations
  - **Likely: Terraform for static records + external-dns for dynamic cluster services**
- `[ ]` Terraform: create `terraform/cloudflare/` module
  - Import existing records into Terraform state (`terraform import`)
  - Commit `main.tf` / `records.tf` to repo
  - Add to `scripts/terraform-run.sh`
- `[ ]` `external-dns`: deploy to k8s, point at Cloudflare zone, annotate IngressRoutes
- `[ ]` Remove manual records from Cloudflare dashboard once Terraform manages them
- `[ ]` Verify `owl.red` public records (MX, TXT/SPF, tunnel CNAME) survive import

---

## 11. File Storage Migration: OneDrive → Google Drive

Personal/family file storage migration. Infrastructure-adjacent — needs to be done before decommissioning any Microsoft 365 dependency.

- `[ ]` Inventory what is on OneDrive and who uses it
- `[ ]` Decide Google Workspace tier or free Drive (shared drives need Workspace Business)
- `[ ]` Use `rclone` to migrate: `rclone copy onedrive: gdrive: --progress --checksum`
- `[ ]` Verify file count and sizes match post-migration
- `[ ]` Update any app integrations pointing at OneDrive (e.g. document editors, backups)
- `[ ]` Keep OneDrive read-only for 30 days then decommission

---

## 12. Mail — Self-Hosted `@owl.red` Mail Server

Hosted mail for `owl.red` users. Also a dependency for any service that needs to send email (HA alerts, cluster notifications, etc.).

### 12.1 Evaluate Proton Mail Replacement
- `[ ]` Options:
  - **Self-hosted**: Stalwart Mail (modern, all-in-one SMTP/IMAP/JMAP) — fits k8s well
  - **Self-hosted**: Maddy — minimal, single binary
  - **Managed**: Fastmail, Migadu — no infra overhead
  - **Recommendation**: Stalwart on k8s for full control; Migadu if ops burden is a concern
- `[ ]` Decide and document in `docs/decisions/`

### 12.2 Deploy Mail Server (if self-hosted)
- `[ ]` Requires: Cloudflare tunnel or open port 25 inbound (or smart relay via Mailgun/SES for outbound)
- `[ ]` Provision persistent volume for mail store (NFS StorageClass — see milestone 4)
- `[ ]` TLS cert for `mail.owl.red` via cert-manager
- `[ ]` Cloudflare DNS: MX record → `mail.owl.red`, SPF TXT, DKIM TXT, DMARC TXT
- `[ ]` Create user accounts for all `owl.red` users
- `[ ]` Test send + receive, DKIM signing, spam score (mail-tester.com)
- `[ ]` Configure services to relay through mail server:
  - Home Assistant notifications
  - Cluster alerting (Alertmanager)
  - Any app needing SMTP

### 12.3 Migrate from Proton Mail
- `[ ]` Export Proton Mail messages (use Proton Mail Bridge + `imapsync` or `mbsync`)
- `[ ]` Import into new mail server
- `[ ]` Update MX records to point at new server
- `[ ]` Monitor for 30 days, keep Proton active during transition

---

## 13. Proxmox IaC — All VMs and LXCs via Terraform

Every Proxmox workload must be reproducible from `terraform/proxmox/`. Manual `qm`/`pct` create commands are not acceptable after this milestone is complete.

### 13.1 Audit Current State
- `[x]` List all VMs and LXCs across all nodes: 8 running guests on 6 PVE hosts, verified 2026-10-14 via `pvesh get /cluster/resources --type vm`
- `[x]` Cross-reference local Terraform state metadata: Technitium, 4 Talos VMs and NAS are present; router/PDM scaffold roots have no local state file (verified 2026-10-14)
- `[ ]` Complete required protected guest imports with no-op plans; do not recreate NAS/PDM or apply the live router scaffold to bypass an import. OPNsense stays frozen for rollback; its adoption is not a prerequisite for the separate VyOS resource.
- `[x]` Correct G4's five invalid NIC block declarations offline; touched-file formatting and local module validation pass with zero errors (2026-10-14). This does not authorize a plan/apply or close G4.

### 13.2 Import / Codify Existing Workloads
Known workloads — add `.tf` file per workload, import into state:

| Workload | Node | VMID | Status |
|----------|------|------|--------|
| `edge.owl.red` (OPNsense VM) | edge.pve | 100 | `[~]` scaffold `terraform/proxmox/opnsense-vm/`; retain live/rollback VM, no replacement through this resource |
| VyOS replacement VM | edge.pve | TBD, separate unused ID | `[ ]` Phase 0.6; declare before staging, direct PCI attached only during approved cutover |
| `nas.owl.red` (Unraid VM) | storage.pve | 101 | `[x]` `terraform/proxmox/nas/nas.tf` |
| Technitium LXC | edge.pve | 200 | `[x]` `terraform/proxmox/technitium/technitium-lxc.tf` |
| PDM LXC | cp1.pve | 231 | `[~]` scaffold `terraform/proxmox/pdm/` — import pending |
| PBS VM | storage.pve | TBD | `[ ]` not yet provisioned |
| Talos cp1.k8s VM | cp1.pve | 601 | `[x]` `terraform/proxmox/technitium/main.tf` (`control_planes`) |
| Talos cp2.k8s VM | cp2.pve | 602 | `[x]` `main.tf` (`control_planes`) |
| Talos cp3.k8s VM | cp3.pve | 603 | `[x]` `main.tf` (`control_planes`) |
| Talos worker1.k8s VM | worker1.pve | 604 | `[x]` `main.tf` (`workers`) |

- `[ ]` Import only existing workloads being adopted into their reviewed roots; the new VyOS VM is created separately, not imported as VM 100
- `[ ]` Verify `terraform plan` shows no diff after import
- `[ ]` All new workloads going forward: `.tf` first, then `apply`

### 13.3 Talos IaC — Document and Codify
- `[ ]` Document current `talos/` directory structure in `docs/guides/talos-iac.md`:
  - `talos/config/` — machine configs (generated by `talosctl gen config`)
  - `talos/patches/` — patch files applied per node/role
  - How configs are applied: `talosctl apply-config`
  - How upgrades work: `talosctl upgrade`
- `[ ]` Reconcile the live Talos/installer `1.8.1` with the source/ISO pin `1.7.5`; pin the approved baseline in source and document any upgrade separately, without regenerating PKI just to correct documentation
- `[ ]` Document the full bootstrap sequence: Terraform (VM) → Talos config apply → `talosctl bootstrap` → kubeconfig
- `[ ]` Confirm `terraform/proxmox/technitium/` Talos provider resources match current cluster state
- `[ ]` If not already: add `talosctl health` check to post-deploy validation

---

## 14. Physical Documentation — Rack Diagram, Floor Plan, Photos

### 14.1 Rack Diagram
- `[ ]` Create rack diagram in draw.io (free, exports SVG/PNG, no Visio license needed)
  - Alternative: `rack-diagrams` YAML-to-SVG tool if you prefer code-as-diagrams
- `[ ]` Include: PDU, UPS, patch panels (PP1–PP39), switch, all servers, cable management
- `[ ]` Label U positions, cable colors (BLUE/PURPLE/AQUA per README standard)
- `[ ]` Export as SVG + PNG; commit to `docs/diagrams/rack.svg` and `docs/diagrams/rack.png`

### 14.2 Network Diagram
- `[ ]` Create logical network diagram:
  - Physical layer: switch ports, SFP+ links, WAP trunk
  - VLAN layer: per-VLAN subnets, DHCP ranges, gateway IPs
  - Service layer: Technitium, VyOS target (OPNsense until accepted replacement), Traefik VIP, MetalLB pool
- `[ ]` Export to `docs/diagrams/network-logical.svg`
- `[ ]` Create physical layer diagram (which NIC connects where)
- `[ ]` Export to `docs/diagrams/network-physical.svg`

### 14.3 Floor Plan
- `[ ]` Sketch room layout with rack location, WAP location, cable run paths
- `[ ]` Mark wired drop points and which patch panel port they map to
- `[ ]` Photo or scan; commit to `docs/diagrams/floor-plan.png`

### 14.4 Photos
- `[ ]` Photograph front of rack (labeled)
- `[ ]` Photograph rear of rack (cable management)
- `[ ]` Photograph patch panel front and rear
- `[ ]` Commit to `docs/photos/` with filenames matching what they show

---

## 15. Documentation Completeness Pass

Do this last — docs written after everything is running are accurate.

### 15.1 Guides (create in `docs/guides/`)
- `[ ]` Document the VyOS image/configuration/bootstrap, confirmed-commit/save, exclusive PCI handoff, rollback and read-only troubleshooting workflow before use; keep the existing OPNsense runbook as interim/recovery documentation
- `[ ]` `talos-iac.md` — full Talos VM → config → bootstrap → upgrade sequence
- `[x]` `proxmox-terraform.md` — cluster IaC coverage audit, passthrough commands, add-a-node (incl. Talos) — done 2026-06-18
- `[ ]` `fleet-gitops.md` — how Fleet watches this repo, how to add a new app
- `[ ]` `vlan-setup.md` — VLAN architecture, how to add a new VLAN end-to-end
- `[ ]` `storage-setup.md` — NFS share → CSI driver → StorageClass → PVC workflow
- `[ ]` `cert-manager.md` — wildcard cert workflow, how LXCs get certs
- `[ ]` `tailscale.md` — how to connect, what's exposed, split-DNS setup
- `[ ]` `mail-server.md` — user creation, SMTP relay config for services

### 15.2 Decisions (create in `docs/decisions/`)
- `[x]` `016-opnsense-terraform.md` — historical OPNsense Terraform/manual-floor decision; superseded for the target router by ADR 022, retained for interim ownership
- `[ ]` `017-mail-server-choice.md` — Stalwart vs. Migadu decision
- `[x]` `018-storage-backend.md` — NFS-from-NAS now, Longhorn later (created 2026-06-18)
- `[ ]` `019-tailscale-vs-vpn.md` — why Tailscale over WireGuard/OpenVPN
- `[x]` `021-unraid-hybrid-iac.md` — hybrid API/File/Manual IaC for the Unraid NAS (done 2026-06-18)
- `[x]` [022-vyos-router-replacement.md](docs/decisions/022-vyos-router-replacement.md) — single VyOS Stream VM, direct PCI passthrough, staged same-IP replacement, no HA requirement, read-only diagnosis (accepted 2026-10-16; not deployed)

### 15.3 README
- `[ ]` Update README workload table to reflect final state
- `[ ]` Add links to key guides
- `[ ]` Add architecture diagram inline (SVG from 14.2)
- `[ ]` Verify every IP/hostname/MAC in README matches live state

---

## 16. Time Synchronization

Two layers: a free consolidation fix (do first), and an optional GNSS stratum-1
appliance (resilience / hobby). Nothing in the stack *requires* high-precision time
(etcd/TLS/logs tolerate ordinary NTP), so 16.1 is the real win and 16.2 is optional.

### 16.1 Keep The Router As The LAN NTP Endpoint
Audit baseline: Unraid already points at `10.0.10.1`; PVE hosts use public chrony
sources, and Talos reports synchronized time without an explicit LAN server.
**Target:** keep `10.0.10.1` as the internal NTP endpoint. Preserve existing
OPNsense service during preparation and configure native VyOS NTP for replacement,
with public upstream sources. A future GNSS appliance is an additional source,
not a router/VLAN migration prerequisite. Do not change all client time settings
during the router swap.

- `[ ]` Verify baseline NTP consumers/service and native VyOS service parity at `10.0.10.1` during Phase 0.6; restrict access to approved LAN sources
- `[ ]` Point all hosts at `10.0.10.1` (manage via IaC where possible):
  - `[x]` Unraid — NTP set to `10.0.10.1`; now owned by `terraform/unraid/` (GraphQL
    `updateSystemTime`). `NTP_SERVER1=10.0.10.1` and empty 2-4 reverified 2026-10-14.
  - `[ ]` Proxmox hosts — chrony/systemd-timesyncd → `10.0.10.1` via Ansible
  - `[ ]` Talos nodes — `machine.time.servers: [10.0.10.1]` in machine config, reapply
  - `[ ]` Technitium LXC — NixOS `services.timesyncd`/chrony → `10.0.10.1`
- `[ ]` Verify skew across all hosts is < ~100 ms (`chronyc tracking` / `timedatectl`)

### 16.2 Optional — GNSS stratum-1 NTP appliance (Pi 4 + PPS)
Internet-independent LAN time. **Accuracy comes from PPS (pulse-per-second) into a
GPIO pin**, disciplined by chrony — *not* from NIC PTP. The existing **Pi 4 is ideal**
for this (its lack of NIC hardware-PTP timestamping is irrelevant for a GPS NTP
server; PTP only matters for distributing PTP over Ethernet, which nothing here uses).

- `[ ]` Build the appliance (parts list below); wire PPS → GPIO18
- `[ ]` Enable `dtoverlay=pps-gpio,gpiopin=18` + UART; install `gpsd` + `chrony`
- `[ ]` chrony: PPS as `refclock`, **plus** internal/pool servers as fallback
  (never single-source — a bad GPS fix must not poison LAN time)
- `[ ]` Place on VLAN 10 (`time.owl.red`), add DNS A record + DHCP reservation
- `[ ]` Feed it into 16.1 as **one source among several** on the internal NTP server
- `[ ]` Mount antenna with real sky view (window/roof run) — this is the actual cost

**Parts list (HAT build — recommended, no soldering):**

| Part | Notes | Approx |
|------|-------|--------|
| Raspberry Pi 4 | **already owned** | — |
| Uputronics GPS/RTC HAT (u-blox MAX-M8Q/M10, PPS on GPIO18 + RTC) | Gold standard for Pi NTP; PPS pre-wired | ~$60–80 |
| Active GPS antenna (SMA, ≥28 dB) + adapter if u.FL | Sky view critical | ~$15–25 |
| Pi PSU + case + microSD | likely on hand | ~$0–25 |

**Cheaper DIY alternative (jumper wiring):** u-blox NEO-M8N/M9N breakout w/ PPS pin
(~$15–25, antenna often included) wired to GPIO (PPS→18, TX/RX→UART, 3V3/GND).
Functionally identical stratum-1; trades ~$45 for soldering/wiring + less tidy.

> Prices are approximate (recalled) — confirm current SKUs/stock before buying.
> Adafruit Ultimate GPS HAT is a valid fallback but needs a solder jumper for PPS.

### Decision to record
- `[ ]` `docs/decisions/020-time-sync-gnss.md` — internal NTP consolidation; GNSS
  optional, justified by resilience not necessity; Pi 4 + PPS over PTP

---

## Notes

- **VLAN 40 vs. VLAN 50 for IoT**: devices that only need LAN access (printers, 3D printers, local sensors) go to 40. Devices that need cloud APIs (Ecobee, Bambu cloud, voice assistants) go to 50.
- **Unraid VM placement**: already VM 101 on storage.pve with GPU/HBA/NIC passthrough. Shared-storage rollout and any later Plex migration are separate work, not a pending conversion from bare metal.
- **Tailscale before captive portal**: Tailscale gives a reliable admin path if the captive portal breaks VLAN 30 routing during testing.
- **Home Assistant mDNS**: this is the hardest part. IoT device auto-discovery requires multicast to reach HA across VLANs. Plan this before deploying HA.
- **Mail inbound delivery**: port 25 inbound is blocked by most residential ISPs. Use Cloudflare Email Routing to receive and relay to self-hosted SMTP, or use a VPS SMTP relay with `cloudflared` for the web UI.
- **draw.io vs. Visio**: draw.io is free, cross-platform, exports editable XML committed to git. Prefer it over Visio unless you already have a license.
- **Terraform import order**: author matching resource configuration, import the existing guest, then reconcile to a no-op plan before apply. Only genuinely new guests use the create path; never recreate a protected production guest to sidestep import.
