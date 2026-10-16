# owl.red Infrastructure Roadmap

Dependency-led execution plan followed by the existing milestone backlog. Phase numbers are stable references, not a command to finish every lower-numbered milestone first. Update status only from observed results.

Status: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

Controller and script dependencies are project requirements documented in
[Controller Setup And Tool Requirements](docs/guides/controller-setup.md).
Install tools for the owning lane and verify access, interpreter/library paths
and versions before running commands; package installation is not build success
or permission to deploy.

**Current focus: prepare a reversible network transition, then prove one small change at a time.**
The 2026-10-14 audit found a working flat network and Kubernetes control plane,
not an operational five-VLAN deployment. Internal DNS, Fleet and TLS have known
gaps. The Terraform NIC syntax failure has since been fixed offline; that does
not make its five-NIC target safe to apply to the live one-NIC Technitium LXC.

**Transition constraint:** keep client DNS/DHCP on OPNsense until the supporting
VLAN paths and Technitium interfaces are ready and a coordinated handoff is
approved. Do not force CoreDNS, Talos resolvers, client DNS or DNS interception
to the final design early. A separately justified interim DNS repair must retain
the OPNsense client path and have its own rollback; it is not a VLAN prerequisite.

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
| G4 `[~]` Terraform And Inventory Safety | The specific infrastructure root being planned/applied or guest being imported/changed | NIC syntax/fmt/validation is fixed offline. Reconcile live/state/desired values for the touched resource without unapproved version, placement, sizing or power changes. Import only where needed; review a narrowly scoped plan and reject destroy/recreate, disk, passthrough or unrelated guest actions. Do not apply a whole cluster target to perform a network-only change. |
| G5 `[ ]` End-To-End VLAN Readiness | Each subnet/L2 migration batch and the subsequent DNS/DHCP handoff | Fresh authenticated OPNsense service/interface/lease survey; resolved legacy `/16` overlap; reviewed router/bridge/switch/AP port map; protected operator path; verified Technitium DHCP lifecycle guard before attaching reachable NICs. Prove gateway, return routes, expected DHCP authority/options and policy from a real LAN client for each batch. Mask contraction and management VLAN tagging are separate changes; readiness is built during Phase 1, not required in full before starting it. |
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
| 2. Approve the transition design | Phase 1.5: decide overlap handling, actual VLAN assignment, native/tagged boundaries and the management-link sequence. Revisit ADRs explicitly where needed. | A per-component before/after table and bounded rollback show that both outbound and return traffic work at each intermediate state. No device is moved just because its future reservation exists. |
| 3. Prepare without transferring service | Phase 0's relevant IaC and Phase 1.1/1.2/1.3: review declarations, stage only changes proven not to interrupt legacy forwarding, and establish the Technitium DHCP guard before exposing new interfaces. | OPNsense remains the client DNS/DHCP path. A no-offer Technitium state is confirmed by read-back and a real-client packet check, not inferred from source JSON. The known legacy management path remains usable. |
| 4. Resolve masks, then prove an isolated VLAN path | Execute the approved Phase 1.5 strategy. With in-place contraction, narrow the legacy connected network and relevant static/DHCP client masks on the existing L2 before routing contained target subnets. Management tagging is a later, separate operation. | PVE quorum, Talos/etcd/API VIP, ingress VIP, NAS access and operator reachability remain healthy; a test port/client proves gateway, return path and policy. No competing DHCP server and no premature final resolver enforcement. |
| 5. Complete supporting paths, then hand off DNS/DHCP | Finish the required router/trunk/AP/LXC paths and approve a coordinated authority transfer. OPNsense can serve pilot/migrated VLAN clients during preparation where supported by its verified current engine. | Disable the old DHCP authority for the affected broadcast domain before enabling the new one; retain an address-conflict-safe lease/reservation rollback. Test renewals, scope-local DNS, external resolution and management from real clients and existing pods. Unmigrated domains keep their old authority. |
| 6. Expand and enforce | Move small client batches, finish the separately planned management-tag migration, then close G2 and Phase 1.6. | Validate required application flows, guest authentication/isolation and IoT restrictions. Only then tighten DNS egress/redirects and retire temporary paths; never remove the final recovery path while it is still needed. |
| 7. Stabilize platform and add stateful services | G3 and Phase 3 can proceed independently when their own access/dependencies are met. G6 -> Phase 4 storage tests -> production stateful workloads; Phase 8 provides the longer-term backup programme. | Network completion is not claimed from a green Fleet status, and storage safety is not claimed from working VLANs. Each workstream has its own evidence. |

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

## 0. OPNsense — Terraform IaC

Bring the OPNsense objects needed for each network batch under reproducible ownership before changing them; completing every firewall feature is not a prerequisite for VLAN preparation. **Decision: Terraform-primary + a documented manual floor** — see [ADR 016](docs/decisions/016-opnsense-terraform.md). The runner is `scripts/opnsense-terraform-run.sh <plan|apply>`; these are reference commands, not approval to apply.

**Survey finding (2026-06-19):** a read-only survey via the dedicated `terraform` API user found the router **near-default** — WAN `igc0`, LAN `ixl1` on a single **flat `10.0.10.1/16`** (no VLAN interfaces yet), and **0** custom aliases / automation filter rules / NAT / Unbound overrides (only built-in defaults + 1 auto-generated Unbound forward). So there is **nothing custom to import**; firewall aliases/rules get **created during the VLAN transition (§1)**, authored as Terraform — not imported. Forward-looking `/24` drafts are parked in `terraform/opnsense/planned/`.

This is a historical baseline, not the current firewall survey. Authenticated
OPNsense inspection was initially blocked in the 2026-10-14 audit and succeeded
in the [authenticated follow-up](docs/issues/008-live-state-vs-repository.md#follow-up-authenticated-router-survey).
The router is `26.1.9`, still flat `/16`, with Dnsmasq DHCP, an Unbound-to-Dnsmasq
`owl.red` forward, and an enabled Plex WAN port-forward. The seven alias results
are built-ins. Do not rely on the June blanket "nothing to import" assumption;
review supported existing objects and the remaining manual-floor evidence first.

**Lane split (ADR 016):** Terraform (`browningluke/opnsense` v0.24.0 in the lockfile) is the selected lane for supported API-backed objects. The documented WebUI floor includes base interface assignment/IP/WAN, gateways, system settings including **NTP (§16.1)**, captive portal, shaper and IDS/IPS. Check the installed OPNsense version, active DHCP engine and actual provider resources before relying on historical coverage claims. Revise the ownership matrix explicitly if current support changes it; do not manage the same object through two writers.

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
- `[ ]` Export the affected configuration privately; verify the restore method, real operator path and independent router recovery before a disruptive router change
- `[ ]` Import any existing API-managed objects found by that survey, or freshly verify that the empty module is a no-op

Historical checks below were completed on 2026-06-19, not revalidated in October:
- `[x]` Surveyed live config (read-only): router is near-default — **nothing custom to import**
- `[x]` 0 custom aliases / filter rules / NAT / overrides; the 1 auto-generated Unbound forward (Dnsmasq) is left unmanaged
- `[x]` Active module declares no resources; `plan` shows no changes (clean baseline)

### 0.3 Codify Devices / Aliases (created during the VLAN transition §1 — not imported)
> Aliases reference per-VLAN subnets that don't exist on the firewall yet; drafts are staged in `terraform/opnsense/planned/aliases.tf` with `/24` *target* masks. Activate per the §1.5 cutover.
- `[ ]` VLAN 10 reserved hosts → aliases (from `gitops/technitium/dhcp-reservations.json`)
- `[ ]` IoT device aliases (VLAN 40/50)

### 0.4 Codify Firewall Rules (created during the VLAN transition §1)
> Authored as `opnsense_firewall_filter` (Automation lane) in a new `terraform/opnsense/firewall_rules.tf` once the VLANs exist. They won't appear on the classic per-interface Rules pages — see the module README.
- `[ ]` Inter-VLAN policy rules:
  - VLAN 10 admin → all VLANs allowed
  - VLAN 20 private → internet + VLAN 10 services, no lateral
  - VLAN 30 guest → internet only via captive portal, blocked from all VLANs
  - VLAN 40 IoT → LAN only, no internet, no lateral
  - VLAN 50 IoT → internet, no lateral movement
- `[ ]` `terraform apply` — review the plan first; verify rules under Firewall → Automation → Filter
- `[ ]` Test each VLAN segment for correct connectivity

### 0.5 Ongoing
- `[ ]` API-backed OPNsense changes use `terraform/opnsense/` where the locked provider supports the object. The Dnsmasq range has a documented range-only Ansible exception; the ADR 016 manual floor remains WebUI-managed, with no overlapping ownership.
- `[ ]` Add OPNsense to `scripts/terraform-run.sh` workflow documentation

---

## 1. Network Foundation

These must be complete before anything that depends on VLAN isolation or correct name resolution works end-to-end.
Follow the [execution order](#execution-order), not the numerical order of the
subsections below. G1 applies per change; G4 applies to the root/resource being
used. Build G5 readiness through this phase, keep OPNsense client DNS/DHCP during
preparation, and transfer authority only after the supporting paths/interfaces
are ready. Final G2 DNS and unrelated G3 repairs are not entry gates.

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

### 1.3 OPNsense VLAN Firewall Rules
- `[ ]` Confirm VLAN 10 → all VLANs (admin rule) exists
- `[ ]` Confirm VLAN 20 → internet + VLAN 10 services only (no lateral)
- `[ ]` Confirm VLAN 40 → LAN only, no internet, no lateral movement
- `[ ]` Confirm VLAN 50 → internet only, no lateral movement
- `[ ]` Guest VLAN 30 isolation rules (see `README.md` captive portal section)

### 1.5 Subnet Migration: `/16` → `/24` per VLAN

**Observed:** after the approved one-host pilot, worker1 PVE `.14` uses `/24`;
the other five PVE hosts, Talos and NAS retain `/16` on the legacy untagged L2. Technitium
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
  - `[~]` Record masks, gateways and L2 attachment. Worker1 PVE `.14` now uses `/24`; the other five PVE hosts, four Talos node IPs, NAS and operator retain `/16`. Technitium and PDM already use `/24`; API VIP `.20` is a `/32`, not a node-mask error. Storage PVE and the operator already use Technitium DNS directly. Storage-management `.6`, power-strip `.9` settings and the device behind AP-labelled port 18 remain unverified. See the [dated assessment](docs/issues/008-live-state-vs-repository.md#follow-up-mask-inventory-and-recovery-assessment).
  - `[x]` Identify the active operator NIC as USB Ethernet `84:3a:5b:87:91:dd`, `.174/16`, gateway `.1`, DNS `.30`; Wi-Fi is disconnected despite a retained address. Owner identifies switch port 22 (`cab-trunk`) as the protected current path. Do not change its native PVID 1/untagged behavior or assume a disabled spare port is a usable recovery port.
  - `[x]` Verify router VM 100's console menu through PVE at literal `10.0.10.3:8006` (user screenshot, 2026-10-15). OPNsense `26.1.9` shows LAN `ixl1` at `10.0.10.1/16` and the interactive menu. No console option was selected as part of this check; affected-configuration restore and outage recovery are not thereby rehearsed.
  - `[x]` Prepare the narrow Dnsmasq range-end candidate `.200` to `.199` with default-deny activation, fresh private preimages and eight passing loopback-only cases. Locked provider `0.24.0` supports Dnsmasq hosts but not ranges; the [Ansible playbook](ansible/playbooks/opnsense-dhcp-range.yml) is the documented surgical exception, not a whole-root Terraform apply.
  - `[x]` Apply the explicitly approved overlap fix after fresh ownership/preimage checks (2026-10-16T00:40:51Z-00:41:00Z). The field-only save and Dnsmasq reconfigure passed; only `end_addr` differs, all eight reservations and LAN `.1/16` are unchanged, service/DNS/HTTPS and a correlated zero-drop DHCP offer check pass. Scoped recovery artifacts are retained; no Windows route change or automatic rollback was made.
  - `[ ]` Before a broader router interface/subnet change, retain the applicable current configuration export and exact recovery procedure, and address its control-connection risk. The August history download is not a certified full-current export. The range-only owner's proceed decision does not approve the broader migration; Dnsmasq reconfigure can also reload firewall rules.
  - `[ ]` Approve in-place contraction on the existing L2 if practical; otherwise document a non-overlapping temporary subnet and its bidirectional routes/renumbering. Do not silently change the final allocation plan or assume a staged overlapping router configuration is safe.
  - `[ ]` Define each change's exact previous/new values, acceptable interruption, checks, rollback trigger and inverse operation. Test recovery access for the affected component before changing its management path.
  - `[x]` Prepare the isolated worker-host pilot `.14/16` to `.14/24` through the [guarded Ansible playbook](ansible/playbooks/proxmox-prefix-pilot.yml), with no router/storage/operator-path change. Eleven final offline cases cover rollback/locking, actual staged-model assertions and only the verified zero-byte PVE-generated SDN include. Initial and converged connected previews make zero changes. Future live activation still defaults off.
  - `[x]` Explicitly approve and run the one-host pilot with private on/off-host preimages and host-local rollback (2026-10-16T01:13:43Z-01:14:15Z). The first stage was safely refused for PVE-generated header/formatting and reverted without reload. Repaired guards compare every non-comment directive and all parsed interface fields except the approved CIDR. The successful PVE task finished `OK`; runtime/persisted `.14/24`, SSH, gateway, six-node quorum and guest readiness passed before lock-protected timer cancellation. No pending file or triggered rollback remains. The guest stays `/16`; the rest of the contraction is not approved by this pilot.

  **Assessment, not apply approval:** mask-only contraction remains the leading
  option for the observed addresses. The operator-to-PVE `.3` path is on-link
  in the captured inventory, and the owner has now shown the router VM's actual
  console menu through PVE. Configuration restore and the exact inverse change
  remain unverified; console access alone does not complete them. Appliance checks apply before
  changing or depending on their return paths; AP management gates wireless or
  affected AP work, not independent wired preparation. Preserve the API VIP
  `/32`, existing DNS overrides and the native L2 while a scoped IaC/rollback
  procedure is prepared. No mask, VLAN, DHCP option or reservation was changed.

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
  - `[ ]` For the in-place strategy, plan OPNsense pool/prefix and client lease renewal together; a shortened lease only takes effect after renewal. Handle static masks and clients outside the retained `/24` explicitly, without overlapping active allocations.
  - `[ ]` Change approved host/client masks and the legacy router prefix in the documented order while retaining the current untagged management L2, addresses and OPNsense DNS/DHCP authority. Account for routes and firewall rules which derive from the old prefix.
  - `[ ]` Check both directions to the operator, gateway, PVE quorum, Talos/etcd/API VIP, ingress VIP and NAS after each bounded batch. Stop and restore the affected previous values on failure; do not proceed to VLAN tagging to fix an unresolved mask problem.
4. **Prove VLAN paths while OPNsense still serves clients.**
  - `[ ]` Activate one approved test port/VLAN path and matching gateway/firewall/NAT policy. Use OPNsense DHCP/DNS for any pilot clients where the surveyed engine supports it; a static test client is acceptable before client DHCP is staged.
  - `[ ]` Verify address, `/24`, gateway, expected DHCP server/DNS options, internet policy and return traffic from a real LAN client. WSL reachability alone cannot prove DHCP broadcasts, VLAN membership or isolation.
  - `[ ]` Complete the required switch/AP/PVE/LXC paths with Technitium DHCP still guarded; verify scope-local `.30` DNS listeners and firewall exposure. Do not put the same `10.0.10.0/24` address space on both native and tagged router interfaces.
5. **Approve and perform the DNS/DHCP handoff, then expand.**
  - `[ ]` Reconcile outstanding leases, reservations and pool exclusions for each broadcast domain; keep a rollback lease map so neither authority reissues an address already in use
  - `[ ]` After supporting paths/interfaces pass, approve the exact handoff batch. Disable OPNsense DHCP for that domain before enabling its Technitium scope, then renew test clients and verify DNS. Keep unmigrated domains on OPNsense; do not enable every scope at once.
  - `[ ]` Verify VLAN-local DNS, public resolution and `owl.red` answers from LAN clients, gateway-dependent hosts and existing pods before changing their configured resolver path or enforcing DNS egress
  - `[ ]` Migrate small client groups, test required camera/printer/media flows, and perform the separately planned management-tag transition with the tested operator/recovery port still available. On DHCP rollback, disable the new authority before restoring the old one and account for leases issued in the interim.
  - `[ ]` Close G2 only after the coordinated resolver change is verified; tighten DNS policy last. Remove temporary paths and stale active `/16` configuration after acceptance, but retain dated audit/history references.

### 1.6 Captive Portal (`captive.owl.red`)

- **Requires:** a working VLAN 30 L2/L3 path, verified DNS/DHCP options and isolation from 1.1/1.3/1.5; the portal does not gate initial VLAN preparation
- `[ ]` Verify OPNsense captive portal zone is bound to VLAN 30
- `[ ]` Confirm `captive.owl.red` resolves from VLAN 30 clients
- `[ ]` Test: unauthenticated VLAN 30 client hits splash page
- `[ ]` Test: authenticated client reaches internet, blocked from other VLANs
- `[ ]` DHCP Option 114 (`RFC 8910`) set on VLAN 30 scope in Technitium

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

- `[ ]` Choose exit node placement (OPNsense plugin vs. dedicated LXC vs. k8s pod)
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
  - Or configure mDNS repeater / Avahi proxy on OPNsense between VLANs
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
- `[ ]` Create Cloudflare Tunnel in Cloudflare dashboard; save tunnel token to Bitwarden
- `[ ]` Deploy `cloudflared` connector:
  - Option A: k8s Deployment in its own namespace (`cloudflared`)
  - Option B: LXC on `edge.pve` — simpler, no k8s dependency
  - **Likely: k8s Deployment so it benefits from cluster HA**
- `[ ]` Configure tunnel routes in `cloudflared` config (ingress rules by hostname)
- `[ ]` Verify public hostname resolves via Cloudflare and traffic reaches internal service through Traefik
- `[ ]` Firewall rule: confirm OPNsense allows `cloudflared` egress to Cloudflare IPs only
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
- `[ ]` Complete the protected guest imports with no-op plans; do not recreate the live router, NAS or PDM to bypass an import
- `[x]` Correct G4's five invalid NIC block declarations offline; touched-file formatting and local module validation pass with zero errors (2026-10-14). This does not authorize a plan/apply or close G4.

### 13.2 Import / Codify Existing Workloads
Known workloads — add `.tf` file per workload, import into state:

| Workload | Node | VMID | Status |
|----------|------|------|--------|
| `edge.owl.red` (OPNsense VM) | edge.pve | 100 | `[~]` scaffold `terraform/proxmox/opnsense-vm/` — import pending |
| `nas.owl.red` (Unraid VM) | storage.pve | 101 | `[x]` `terraform/proxmox/nas/nas.tf` |
| Technitium LXC | edge.pve | 200 | `[x]` `terraform/proxmox/technitium/technitium-lxc.tf` |
| PDM LXC | cp1.pve | 231 | `[~]` scaffold `terraform/proxmox/pdm/` — import pending |
| PBS VM | storage.pve | TBD | `[ ]` not yet provisioned |
| Talos cp1.k8s VM | cp1.pve | 601 | `[x]` `terraform/proxmox/technitium/main.tf` (`control_planes`) |
| Talos cp2.k8s VM | cp2.pve | 602 | `[x]` `main.tf` (`control_planes`) |
| Talos cp3.k8s VM | cp3.pve | 603 | `[x]` `main.tf` (`control_planes`) |
| Talos worker1.k8s VM | worker1.pve | 604 | `[x]` `main.tf` (`workers`) |

- `[ ]` `terraform -chdir=terraform/proxmox/<workload> import <resource> <vmid>` for each
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
  - Service layer: Technitium, OPNsense, Traefik VIP, MetalLB pool
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
- `[ ]` `opnsense-terraform.md` — bootstrap API user, run terraform, import workflow
- `[ ]` `talos-iac.md` — full Talos VM → config → bootstrap → upgrade sequence
- `[x]` `proxmox-terraform.md` — cluster IaC coverage audit, passthrough commands, add-a-node (incl. Talos) — done 2026-06-18
- `[ ]` `fleet-gitops.md` — how Fleet watches this repo, how to add a new app
- `[ ]` `vlan-setup.md` — VLAN architecture, how to add a new VLAN end-to-end
- `[ ]` `storage-setup.md` — NFS share → CSI driver → StorageClass → PVC workflow
- `[ ]` `cert-manager.md` — wildcard cert workflow, how LXCs get certs
- `[ ]` `tailscale.md` — how to connect, what's exposed, split-DNS setup
- `[ ]` `mail-server.md` — user creation, SMTP relay config for services

### 15.2 Decisions (create in `docs/decisions/`)
- `[x]` `016-opnsense-terraform.md` — OPNsense config: Terraform-primary + manual floor (done 2026-06-19)
- `[ ]` `017-mail-server-choice.md` — Stalwart vs. Migadu decision
- `[x]` `018-storage-backend.md` — NFS-from-NAS now, Longhorn later (created 2026-06-18)
- `[ ]` `019-tailscale-vs-vpn.md` — why Tailscale over WireGuard/OpenVPN
- `[x]` `021-unraid-hybrid-iac.md` — hybrid API/File/Manual IaC for the Unraid NAS (done 2026-06-18)

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

### 16.1 Point everything at OPNsense as the LAN NTP server (free, do first)
Audit baseline: Unraid already points at `10.0.10.1`; PVE hosts use public chrony
sources, and Talos reports synchronized time without an explicit LAN server.
**Decision: OPNsense (`10.0.10.1`) is the single internal NTP
authority for the LAN.** Every host points at it; OPNsense itself uses the public
pool as upstream. (If/when the GNSS appliance in 16.2 exists, it feeds OPNsense as an
additional source.)

- `[ ]` Confirm OPNsense NTP service is enabled and serving on `10.0.10.1`
  (Services → Network Time → General); restrict to LAN VLANs
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
