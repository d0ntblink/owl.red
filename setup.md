# owl.red Setup Runbook

Status: Draft for review (do not execute yet)

Last reviewed: 2026-05-01

## Purpose

This document is the execution runbook to migrate from the current real state to the intended target state.

It is intentionally conservative:

- It does not assume repo document order is execution order.
- It treats lockout-prone network changes as high risk.
- It separates staging from cutover.
- It requires explicit rollback anchors per phase.

## Sources Reviewed

Repository sources:

- README.md
- DEVICE_TEST_PROCEDURES.md
- docs/decisions/001-k3s-rancher-fleet.md
- docs/decisions/002-plex-k8s-quicksync.md
- docs/decisions/003-secrets-bitwarden.md
- docs/decisions/004-loadbalancer-metallb-vs-servicelb.md
- purchaselist.md

Official/vendor references used for this runbook:

- MikroTik SwOS and CRS3xx/CSS3xx manual:
  - https://help.mikrotik.com/docs/spaces/SWOS/pages/328415/SwOS
  - https://help.mikrotik.com/docs/spaces/SWOS/pages/76415036/CRS3xx+and+CSS3xx+series+Manual
- OPNsense:
  - https://docs.opnsense.org/manual/interfaces.html
  - https://docs.opnsense.org/manual/dhcp.html
  - https://docs.opnsense.org/manual/dhcrelay.html
  - https://docs.opnsense.org/manual/captiveportal.html
  - https://docs.opnsense.org/manual/how-tos/guestnet.html
- Proxmox VE Admin Guide:
  - https://pve.proxmox.com/pve-docs/pve-admin-guide.html
- Talos docs:
   - https://www.talos.dev/latest/talos-guides/install/virtualized-platforms/proxmox/
   - https://www.talos.dev/latest/talos-guides/configuration/
- Kubernetes docs:
   - https://kubernetes.io/docs/concepts/services-networking/service/
   - https://kubernetes.io/docs/concepts/cluster-administration/high-availability/
- Rancher docs:
  - https://ranchermanager.docs.rancher.com/getting-started/installation-and-upgrade/install-upgrade-on-a-kubernetes-cluster
- cert-manager ACME DNS-01:
  - https://cert-manager.io/docs/configuration/acme/dns01/

## Confirmed Pre-Execution Decisions (Locked)

These decisions are approved and must be treated as baseline constraints for implementation.

1. VLAN gateways are interface-local per VLAN.
   - VLAN 10: `10.0.10.1`
   - VLAN 20: `10.0.20.1`
   - VLAN 30: `10.0.30.1`
   - VLAN 40: `10.0.40.1`
   - VLAN 50: `10.0.50.1`

2. Kubernetes distribution is Talos Linux + vanilla Kubernetes.
    - No k3s or rke2 assets are in scope for this migration run.
    - Current Talos VM memory baseline (Terraform):
       - Control plane VMs: 10 GiB each
       - Worker VM: 12 GiB

3. DHCP strategy is conservative for initial rollout.
   - OPNsense stays authoritative DHCP initially.
   - Technitium is DNS authority on Kubernetes.
   - DHCP relay to Technitium is deferred until post-stability review.

4. Break-glass management path is mandatory.
   - Keep one dedicated untagged VLAN 10 access port for recovery laptop use.
   - Keep direct local console access to OPNsense/PVE/SwOS available before trunk changes.

5. Service exposure strategy is MetalLB-first.
   - MetalLB is selected for initial deployment.
   - Traefik is exposed via MetalLB VIP (`10.0.10.201`).

## Operating Rules For This Runbook

1. Change only one blast radius at a time.
   - Never combine switch VLAN rewrite + OPNsense interface rewrite + AP SSID mapping in a single commit window.

2. Every step must be rerunnable.
   - [ANSIBLE] tasks must be idempotent.
   - [MANUAL] steps must include explicit pre/post checks.

3. Validate before proceeding.
   - Do not start next phase unless all phase exit gates pass.

4. Always preserve an escape hatch.
   - At least one known-good management path must survive every network step.

5. Track reality, not intention.
   - Keep a migration log (timestamp, action, result, rollback if used).

## Environment Caveat (WSL Operator Node)

Your control workstation is Ubuntu WSL on a Windows laptop, cabled to the managed switch.

Implications:

- Do not rely on LAN broadcast/multicast discovery behavior from WSL for critical operations.
- Use explicit static IP targets and DNS names.
- Keep browser + SSH workflows explicit and deterministic.
- Keep a second recovery path (console/KVM/IPMI or alternate host) available for lockout recovery.

## Phase Overview

| Phase | Objective | Primary Risk | Rollback Anchor |
|---|---|---|---|
| 0 | Safety baseline and backups | Missing rollback artifacts | Known-good backups + current mgmt reachability |
| 1 | Automation scaffold | Bad automation assumptions | No-op/check-mode validation |
| 2 | M73 Proxmox bring-up | Host install inconsistency | Single-node install fallback |
| 3 | Talos/Kubernetes/Rancher baseline on flat network | Cluster instability | Keep current app hosting untouched on Unraid |
| 4 | Prestage VLAN cutover | Management lockout prep errors | Existing flat network config still active |
| 5 | VLAN cutover | Connectivity loss | Restore switch + OPNsense previous config |
| 6 | DHCP/DNS operations hardening | Lease failures | Restore OPNsense DHCP scopes from backup |
| 7 | Security/observability hardening | Policy self-lockout | Revert latest policy set |
| 8 | App migration waves | Data inconsistency | App-level rollback to Unraid source |
| 9 | Deferred NAS virtualization | Hardware not ready | Deferred until HBA arrives |

---

## Phase 0 - Safety Baseline and Rollback Assets

### Entry Criteria

- Router, switch, and NAS are reachable now.
- You have maintenance window and rollback window.

### Steps

1. [MANUAL] Snapshot current configuration state.
   - Export OPNsense config XML.
   - Save SwOS backup file from System tab.
   - Capture Unraid config/app inventory and share exports.
   - Capture current IP/MAC map and active port map.

2. [MANUAL] Verify break-glass access.
   - Confirm one local method for each critical device: OPNsense, switch, AP, Unraid, each Proxmox host.

3. [ANSIBLE] Run read-only preflight checks.
   - Reachability, DNS resolution, default gateway checks, and backup artifact presence.

4. [MANUAL] Freeze change inputs.
   - No unmanaged edits on switch/router between phase transitions.

### Exit Gates

- Backup files exist and are tested for restore path visibility.
- Preflight run is green or known exceptions are documented.

### Rollback

- Restore OPNsense XML and SwOS backup to return to baseline state.

---

## Phase 1 - Automation Scaffold (No Topology Changes)

### Entry Criteria

- Phase 0 completed.

### Steps

1. [ANSIBLE] Build inventory and group_vars for current and target addressing.
2. [ANSIBLE] Add common baseline role (SSH keys, NTP/chrony, package baseline, host facts).
   - **Requirement**: SSH key authentication is mandatory.
   - **Requirement**: Automation SSH keys (e.g., `id_ed25519_owl_ansible`) must be stored securely in Bitwarden under the `owl.red` organization (Org ID: `202b0b27-b135-44cd-a969-b43a003ad670`).
3. [ANSIBLE] Add validation playbook (network, DNS, route, service endpoint checks).
4. [ANSIBLE] Enforce idempotence and check-mode support.

### Exit Gates

- `--check` runs clean.
- No task modifies unrelated hosts.

### Rollback

- Revert ansible changes in git; infra untouched.

---

## Phase 2 - M73 Proxmox Bring-Up

### Entry Criteria

- Automation scaffold exists.
- Physical host BIOS/firmware and install media are ready.
- Control path to final management IPs is validated from the automation runner (direct L2/L3 reachability or SSH jump host).

### Steps

1. [MANUAL] Install Proxmox VE on each M73.
   - Follow Proxmox installer requirements and storage cautions.
   - Set each node's final hostname and management IP/subnet before cluster creation.
   - "Final" here means the address/hostname that will be used for cluster membership, not a transient installer address.

2. [MANUAL] Validate control-node reachability to final management addresses.
   - Verify DNS/hosts resolution for each Proxmox hostname from the automation runner.
   - Verify SSH to each node's final management IP from the automation runner.
   - If direct reachability is unavailable due subnet boundaries, use one approved path before continuing:
     - Connect the operator host to the dedicated VLAN 10 break-glass access port and rerun checks.
     - Use SSH ProxyJump/bastion through a reachable management node and rerun checks.
   - Do not create the Proxmox cluster until this gate is green.

3. [ANSIBLE] Run Proxmox prep automation on installed/current hosts.
   - Apply no-subscription repo remediation (disable enterprise where no subscription exists).
   - Capture SMART and temperature/sensor visibility artifacts before cluster formation.

4. [ANSIBLE] Run Proxmox update/upgrade automation in maintenance window.
   - Use the dedicated upgrade playbook with serial execution (`serial: 1`) to preserve quorum safety.
   - Keep `dist-upgrade` disabled unless explicitly approved for that change window.
   - Enable automatic reboot only when the maintenance window allows one-by-one node restart.

5. [MANUAL] Verify time sync and network stability.
   - Proxmox cluster requires synchronized time and low-latency stable connectivity.

6. [MANUAL] Create Proxmox cluster and join nodes.
   - Use documented `pvecm create` and `pvecm add` workflows.
   - Respect quorum behavior and avoid joining nodes with conflicting guest config.

7. [ANSIBLE] Apply post-install baseline and host hardening.

8. [MANUAL] Validate cluster health.
   - `pvecm status` quorate.
   - API/UI reachable.

### Exit Gates

- All M73 nodes in cluster and quorate.
- Baseline role applied successfully.

### Rollback

- Keep nodes standalone if cluster join fails; do not force partial quorum operations as normal practice.

---

## Phase 3 - Kubernetes and Rancher Baseline on Flat Network

### Entry Criteria

- Proxmox cluster stable.
- Network still flat `/16` (intentional at this phase).
- **Kubernetes distribution:** Vanilla Kubernetes via Talos Linux (not K3s). See ADR 008.

### Control Node Prerequisites

The following tools must be installed on the operator's control node before executing Phase 3.

```bash
# Talos CLI
curl -sL https://talos.dev/install | sh

# Helm (if not already installed)
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# kubectl is required - install via snap or apt
snap install kubectl --classic
```

### IP Plan

| Node | Planned Static IP | DHCP Temporary IP |
|---|---|---|
| Control Plane VIP | `10.0.10.20` | N/A (virtual, floats) |
| cp1-talos | `10.0.10.21/16` | DHCP (verify at boot) |
| cp2-talos | `10.0.10.22/16` | DHCP (verify at boot) |
| cp3-talos | `10.0.10.23/16` | DHCP (verify at boot) |
| worker1-talos | `10.0.10.24/16` | DHCP (verify at boot) |

MetalLB VIP Pool: `10.0.10.200 - 10.0.10.250`
Rancher FQDN: `rancher.owl.red` → MetalLB VIP (e.g. `10.0.10.200`)

> **Note on Talos and IPs:** Talos does not support cloud-init. Static IPs cannot be set at the Terraform/hypervisor layer. On first boot, each node acquires a temporary DHCP IP and enters maintenance mode. Static IPs are applied via the Talos machine config (step 3 below) and take effect after node reboot.

### Steps

1. [ANSIBLE] Download Talos Linux ISO to Proxmox nodes.
   ```bash
   ansible-playbook -i inventory/hosts.yml playbooks/04-prep-talos-iso.yml
   ```

2. [TERRAFORM] Provision Talos Linux VMs on M73 hosts.
   ```bash
   # From terraform/proxmox/
   export PROXMOX_VE_ENDPOINT='https://10.0.10.11:8006/'
   export PROXMOX_VE_API_TOKEN='root@pam!terraform=<secret-from-bitwarden>'
   export PROXMOX_VE_INSECURE='true'
   terraform apply
   ```

3. [TALOSCTL] Generate machine configurations.
   ```bash
   mkdir -p talos/config
   # --talos-version MUST match the ISO version deployed via Terraform
   talosctl gen config owl-k8s https://10.0.10.20:6443 \
     --output-dir talos/config \
     --with-docs=false \
     --with-examples=false \
     --talos-version v1.7.5
   ```

4. [TALOSCTL] Apply machine config to each node (use current DHCP IPs).
   Node patch files in `talos/patches/` set static IPs and the control plane VIP.
   ```bash
   # Control plane nodes
   talosctl apply-config --insecure --nodes <DHCP-IP-cp1> \
     --file talos/config/controlplane.yaml \
     --config-patch @talos/patches/cp1.yaml

   talosctl apply-config --insecure --nodes <DHCP-IP-cp2> \
     --file talos/config/controlplane.yaml \
     --config-patch @talos/patches/cp2.yaml

   talosctl apply-config --insecure --nodes <DHCP-IP-cp3> \
     --file talos/config/controlplane.yaml \
     --config-patch @talos/patches/cp3.yaml

   # Worker node
   talosctl apply-config --insecure --nodes <DHCP-IP-worker1> \
     --file talos/config/worker.yaml \
     --config-patch @talos/patches/worker1.yaml
   ```
   Nodes will reboot and come up at their static IPs.

5. [TALOSCTL] Bootstrap etcd on cp1 (run exactly once).
   ```bash
   talosctl --talosconfig talos/config/talosconfig \
     --nodes 10.0.10.21 bootstrap
   ```

6. [TALOSCTL] Download kubeconfig.
   ```bash
   talosctl --talosconfig talos/config/talosconfig \
     --nodes 10.0.10.21 \
     --endpoints 10.0.10.20 \
     kubeconfig ~/.kube/config
   ```

6a. [TALOSCTL] Launch the Talos node dashboard (live TUI with CPU, RAM, disk, network, services).
    This is the same dashboard visible on the Proxmox console during maintenance mode.
    Run it against any node at any time — no maintenance mode required.
    ```bash
    # Single node
    talosctl --talosconfig talos/config/talosconfig --nodes 10.0.10.21 dashboard

    # All control planes (switch nodes with arrow keys in the TUI)
    talosctl --talosconfig talos/config/talosconfig \
      --nodes 10.0.10.21,10.0.10.22,10.0.10.23,10.0.10.24 dashboard
    ```
    Add `--talosconfig talos/config/talosconfig` to your shell profile or set
    `TALOSCONFIG=~/owl.red/talos/config/talosconfig` to avoid repeating it.

7. [HELM] Install MetalLB (required before any LoadBalancer service, including Traefik).
   ```bash
   helm repo add metallb https://metallb.github.io/metallb
   helm install metallb metallb/metallb -n metallb-system --create-namespace
   kubectl apply -f gitops/metallb/ippool.yaml
   ```

8. [HELM] Install Traefik ingress controller (see ADR 009).
   Talos vanilla Kubernetes does not bundle Traefik — it must be installed explicitly.
   ```bash
   helm repo add traefik https://traefik.github.io/charts
   helm install traefik traefik/traefik \
     -n traefik --create-namespace \
     --set service.type=LoadBalancer
   # Verify MetalLB assigns a VIP to the Traefik service:
   kubectl get svc -n traefik
   ```

9. [HELM] Install cert-manager.
   ```bash
   helm repo add jetstack https://charts.jetstack.io
   helm install cert-manager jetstack/cert-manager \
     -n cert-manager --create-namespace \
     --set crds.enabled=true
   ```

10. [HELM] Install Rancher.
    ```bash
    helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
    helm install rancher rancher-latest/rancher \
      -n cattle-system --create-namespace \
      --set hostname=rancher.owl.red \
      --set bootstrapPassword=admin \
      --set ingress.tls.source=letsEncrypt \
      --set letsEncrypt.email=<your-email> \
      --set ingressClassName=traefik
    ```

11. [DNS] Create A record: `rancher.owl.red` → Traefik MetalLB VIP.

### Exit Gates

- `kubectl get nodes` shows all 4 nodes `Ready`.
- Rancher UI reachable at `https://rancher.owl.red`.
- MetalLB VIP pool visible in Rancher network view.

### Rollback

- Keep production apps on Unraid; do not cut traffic to new platform yet.

---


---

## Phase 4 - Prestage VLAN Cutover (No Production Flip Yet)

### Entry Criteria

- Talos Kubernetes cluster and Rancher baseline stable.
- App traffic still primarily on existing paths.

### Steps

1. [MANUAL] Build and verify authoritative port matrix.
   - Trunk ports, access ports, management-only ports, disabled/reserved ports.

2. [MANUAL] Prestage OPNsense VLAN interfaces and firewall policy draft.
   - Do not remove current working path yet.

3. [MANUAL] Prestage AP SSID-to-VLAN mapping plan and rollback profile.

4. [ANSIBLE] Prepare host network mask transition playbook (`/16` -> `/24`) with batches.

5. [MANUAL] Reserve and test break-glass management path.
   - Keep one untagged VLAN 10 access port dedicated for recovery laptop use.
   - Verify local console access path for OPNsense, Proxmox, and SwOS.

### Exit Gates

- You can describe exact cutover order and rollback in < 5 minutes from notes.

### Rollback

- None required if no active topology change was applied.

---

## Phase 5 - VLAN Cutover (Switch -> Router -> AP -> Hosts)

### Entry Criteria

- Phase 4 staging complete.
- Break-glass path verified immediately before change.

### Steps

1. [MANUAL] Configure SwOS VLANs per official CRS3xx/CSS3xx model guidance.
   - In System tab, enable IVL (Independent VLAN Lookup).
   - In VLANs tab, create VLAN membership table for all target VLANs.
   - In VLAN tab per-port, set:
     - VLAN Mode (use strict on ports requiring ingress membership enforcement).
     - VLAN Receive (`only tagged` for trunk-only, `only untagged` or `any` where appropriate).
     - Default VLAN ID for access ports.
   - Save backup before setting management VLAN constraints.
   - If using management VLAN filtering, set carefully in System tab (`Allow From VLAN` etc.) to avoid lockout.

2. [MANUAL] Configure OPNsense VLAN interfaces and routing.
   - Assign VLAN interfaces and set static addresses per VLAN.
   - Add inter-VLAN firewall policies with explicit deny-before-allow ordering.

3. [MANUAL] Configure AP uplink and SSID VLAN tags.

4. [ANSIBLE] Update managed hosts to target `/24` masks and gateways in batches.

5. [MANUAL] Validate each VLAN domain.
   - Gateway reachability
   - DNS reachability
   - Inter-VLAN block behavior

### Exit Gates

- All required VLANs route correctly.
- Guest isolation and deny rules work as expected.

### Rollback

- Restore SwOS backup + OPNsense previous config and return to flat network profile.

---

## Phase 6 - DHCP/DNS Operations Hardening (Conservative Model)

### Entry Criteria

- VLAN routing stable.
- No unresolved L2/L3 connectivity defects.

### Steps

1. [MANUAL] Keep OPNsense authoritative DHCP for initial rollout.
   - Ensure VLAN 20/30/40/50 scopes use interface-local gateways (`10.0.20.1`, `10.0.30.1`, `10.0.40.1`, `10.0.50.1`).
   - Ensure all DHCP scopes advertise Technitium (`10.0.10.30`) as DNS.

2. [MANUAL] Confirm Technitium DNS authority on Kubernetes.
   - Validate zone data, upstream recursion, and internal record resolution.

3. [MANUAL] Configure guest DHCP Option 114 on OPNsense VLAN 30 scope.
   - Use captive portal API URL per RFC 8910 behavior.

4. [MANUAL] Captive portal finalization on guest VLAN.
   - Valid public certificate and consistent hostname.
   - Confirm OPNsense automatic captive portal rules behavior.

5. [MANUAL] Optional future pilot (deferred): test OPNsense DHCP relay to Technitium in isolated maintenance window.

6. [ANSIBLE] Run lease and DNS validation tests from each VLAN.

### Exit Gates

- OPNsense hands out leases correctly on every DHCP-enabled VLAN.
- DHCP options are correct per VLAN:
   - Option 3 gateway matches interface-local VLAN gateway.
   - Option 6 DNS points to `10.0.10.30`.
   - Option 114 is present on guest VLAN.
- Captive portal path works by hostname and fallback IP where required.

### Rollback

- Restore known-good OPNsense DHCP scope config and disable any pilot relay changes.

---

## Phase 7 - Security, Secrets, and Observability Hardening

### Entry Criteria

- Core L2/L3 and DHCP/DNS behavior stable.

### Steps

1. [MANUAL] Apply and verify strict inter-VLAN policy matrix.
2. [ANSIBLE] Implement Bitwarden-backed infra secret retrieval for playbooks.
3. [ANSIBLE] Deploy ESO bootstrap path for Kubernetes workloads.
4. [ANSIBLE] Add recurring validation jobs and alerting hooks.
5. [MANUAL] Run failure drills:
   - Kubernetes node drain
   - service restart
   - DNS lookup continuity

### Exit Gates

- Secret retrieval path works without plaintext secret files.
- Validation jobs run clean across defined critical checks.

### Rollback

- Disable new policy set incrementally until connectivity and service health recover.

---

## Phase 8 - App Migration Waves (Unraid -> Kubernetes)

### Entry Criteria

- Core platform and network stable for multiple days.

### Steps

1. [MANUAL] Define migration waves by criticality and rollback complexity.
2. [ANSIBLE] Generate app deployment manifests/Helm values from templates.
3. [MANUAL] Migrate non-critical apps first and run acceptance checks.
4. [MANUAL] Migrate critical media workflow components only after storage/performance checks.
5. [MANUAL] Keep Plex fallback path until real transcode validation passes on target placement.

### Exit Gates

- Each migrated app has:
  - health endpoint checks
  - ingress/TLS verification
  - data persistence verification

### Rollback

- Per-app rollback to Unraid service instance using documented cutback procedure.

---

## Phase 9 - [DEFERRED] NAS Bare-Metal -> PVE-Hosted Unraid

### Gate Condition

- HBA card is physically installed, validated, and passthrough tested.

### Deferred Steps

1. [DEFERRED][MANUAL] Validate IOMMU/passthrough on target host.
2. [DEFERRED][ANSIBLE] Prepare Unraid VM definition and storage mapping automation.
3. [DEFERRED][MANUAL] Perform controlled data/service migration.

### Exit Gates

- Unraid VM stable under reboot and storage integrity checks.

### Rollback

- Return services to bare-metal Unraid snapshot state.

---

## Prompt Library For Generating Required Artifacts

Use these prompts as-is in your coding assistant. They are intentionally strict.

### P01 - Generate Inventory and Group Vars

```text
You are a senior infrastructure automation engineer. Generate Ansible inventory and group_vars for this homelab.

Context:
- Domain: owl.red
- Current state: flat 10.0.0.0/16
- Target state: VLANs 10/20/30/40/50, each /24
- Control path: Ubuntu WSL on laptop
- Existing running systems: edge.pve + OPNsense VM, MikroTik CSS326 minimal config, Unraid bare-metal
- Not yet built: M73 Proxmox cluster, Rancher stack

Requirements:
1) Create ansible/inventory/hosts.yml with host groups for:
   - network_edge
   - switches
   - aps
   - proxmox_hosts
   - talos_k8s_hosts
   - nas_hosts
2) Create ansible/inventory/group_vars/all.yml with shared variables.
3) Create ansible/inventory/group_vars/network_target.yml with target VLAN CIDRs and gateways.
4) Include both current_flat and target_vlan address objects per host.
5) Do not include plaintext secrets.
6) Keep output idempotent and structured for check-mode.

Output format:
- Show file tree first
- Then full content of each file
- No placeholders like TODO unless absolutely necessary
```

### P02 - Generate Read-Only Preflight Playbook

```text
Generate ansible/playbooks/00-preflight.yml and minimal roles/preflight/tasks/main.yml.

Goal:
- Read-only validation before any migration phase.

Checks required:
1) host reachability (ping/wait_for_connection)
2) DNS forward and reverse lookup checks for critical hosts
3) default route and interface presence checks
4) required management ports reachable (SSH, HTTPS where applicable)
5) backup artifact existence checks (OPNsense export, SwOS backup, migration log file)

Constraints:
- No destructive actions.
- Idempotent tasks only.
- Use changed_when: false where appropriate.
- Fail with clear messages.

Output:
- file tree
- full YAML content
- example command to run in check mode
```

### P03 - Generate Proxmox Post-Install Baseline Automation

```text
Generate:
- ansible/roles/proxmox_baseline/tasks/main.yml
- ansible/playbooks/10-proxmox-baseline.yml

Scope:
- post-install hardening and baseline on Proxmox hosts

Include:
1) package repo sanity checks and updates (safe mode)
2) chrony/ntp validation and timezone checks
3) SSH hardening baseline (without locking out key auth)
4) host facts export for cluster planning
5) optional Proxmox API health check task

Rules:
- Must be safe to rerun.
- Must not create cluster or modify corosync yet.
- Include tags for selective execution.
- Include comments for lockout-sensitive tasks.
```

### P04 - Generate Talos VM Provisioning Playbook

```text
Generate ansible/playbooks/20-talos-vm-provision.yml.

Objective:
- Create Talos control-plane and worker VMs on Proxmox in a reproducible way.

Requirements:
1) VM definitions driven by inventory vars
2) deterministic VMID assignment
3) Talos machine configuration bootstrap (no cloud-init assumptions)
4) CPU/memory/disk/network settings parameterized
5) no secret material in plain text
6) rerun-safe behavior (create-if-missing, update-if-drift)
7) include default sizing profile variables:
   - control_plane_memory_mb: 10240
   - worker_memory_mb: 12288

Output:
- playbook YAML
- required vars schema
- command examples
```

### P05 - Generate Talos Kubernetes + Rancher Bootstrap Playbook

```text
Generate ansible/playbooks/30-talos-k8s-rancher-bootstrap.yml.

Tasks:
1) bootstrap HA Kubernetes cluster on Talos control-plane nodes
2) verify server and agent node readiness
3) install cert-manager
4) install Rancher via Helm into cattle-system
5) validate rollout status and endpoint reachability

Constraints:
- Respect official Talos and upstream Kubernetes networking requirements.
- Kubernetes on Talos only; do not include k3s or rke2 install paths.
- Use MetalLB for `LoadBalancer` exposure.
- Separate install and validation tasks.
- Include retries and explicit failure messages.
```

### P06 - Generate Host Network Cutover Playbook

```text
Generate ansible/playbooks/40-host-network-cutover.yml.

Purpose:
- Safely transition managed Linux hosts from /16 netmask assumptions to target /24 VLAN settings after VLAN cutover.

Requirements:
1) batch/serial execution (one host at a time by default)
2) pre-change connectivity test
3) apply network config
4) post-change validation (gateway + DNS + control node reachability)
5) automatic abort on first failed host
6) support rollback variables for previous addressing

Constraints:
- no blind restart of all hosts
- no changes to unmanaged hosts
```

### P07 - Generate Full Validation Suite Playbook

```text
Generate ansible/playbooks/90-validate-platform.yml.

Include checks for:
1) VLAN gateway reachability per subnet
2) DNS resolution internal + external
3) DHCP lease validation hooks (where test clients exist)
4) Kubernetes node and core pod health
5) Rancher deployment rollout status
6) ingress endpoint checks
7) NFS mount health for cluster storage

Output must include:
- clear pass/fail summary
- JSON artifact output path for CI use
```

### P08 - Generate Secrets Bootstrap Automation

```text
Generate:
- scripts/ansible-run.sh
- scripts/bootstrap-k8s-secrets.sh
- ansible/playbooks/60-secrets-bootstrap.yml

Behavior:
1) obtain Bitwarden session/token via secure prompt flow (no plaintext files)
2) feed Ansible lookups for infra secrets
3) seed only minimal bootstrap secret(s) to Kubernetes for ESO startup
4) include post-bootstrap token rotation reminder task output

Constraints:
- shell scripts must use set -euo pipefail
- do not echo secrets
- include safe failure handling and clear user prompts
```

### P09 - Generate App Migration Template Pack

```text
Generate reusable templates for app migration waves:
- docs/migration/app-wave-template.md
- k8s/templates/app-values-template.yaml
- ansible/playbooks/80-app-cutover-checklist.yml

Goal:
- enforce per-app cutover checklist: backup, deploy, health check, traffic switch, rollback.

Must include:
1) acceptance criteria fields
2) rollback trigger fields
3) dependency map fields (storage, DNS, ingress, auth)
4) post-cutover observation window tasks
```

---

## Manual Step Notes That Should Not Be Automated Yet

These are intentionally [MANUAL] until a tested API path exists:

- SwOS full VLAN/port policy application (SwOS web-only management, high lockout risk)
- AP SSID/VLAN mapping changes
- First-pass OPNsense captive portal policy wiring
- First-pass Technitium DHCP scope authoring (unless API workflow is validated in staging)

## Validation Cadence (After Go-Live)

- Weekly:
  - DHCP lease tests from representative VLAN clients
  - DNS internal/external resolution checks
   - Rancher and Kubernetes core health checks

- Monthly:
  - Inter-VLAN isolation verification
  - Captive portal detection and Option 114 validation
  - NFS persistence and failover behavior checks

- Quarterly:
  - UPS + WoL non-destructive recovery drill
  - Node drain and critical service reschedule test

- Annually:
  - Full power event recovery rehearsal in maintenance window

## Deferred Items Register

- [DEFERRED] NAS bare-metal -> PVE VM migration (blocked on HBA)
- [DEFERRED] Additional storage VLAN (only after measured NFS bottleneck evidence)
