# Ansible Phase 1 Scaffold

This directory contains Phase 1 automation scaffold only. No topology changes are performed by these files.

## Contents

- `inventory/hosts.yml`: host inventory with current/planned state and current/target address objects.
- `inventory/group_vars/all.yml`: shared defaults for preflight, baseline, and validation.
- `inventory/group_vars/network_target.yml`: locked target network model and constraints.
- `playbooks/00-preflight.yml`: backup artifacts + endpoint + Linux route/DNS prechecks.
- `playbooks/01-baseline.yml`: common baseline role for current Debian Linux hosts.
- `playbooks/02-proxmox-prep.yml`: pre-Phase-2 Proxmox repo remediation and health artifact collection.
- `playbooks/03-proxmox-upgrade.yml`: controlled package update/dist-upgrade workflow for Proxmox hosts.
- `playbooks/90-validate-platform.yml`: route/DNS/service validation with JSON output artifact.
- `roles/common_baseline/`: baseline package/chrony/host-fact collection role.
- `roles/proxmox_prep/`: Proxmox package repository prep and SMART/sensor visibility collection.
- `roles/proxmox_upgrade/`: Proxmox package update/dist-upgrade and optional reboot handling.

## Recommended Run Order

From `ansible/`:

```bash
ansible-playbook -i inventory/hosts.yml playbooks/00-preflight.yml --check
ansible-playbook -i inventory/hosts.yml playbooks/01-baseline.yml --check
ansible-playbook -i inventory/hosts.yml playbooks/02-proxmox-prep.yml
ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml
ansible-playbook -i inventory/hosts.yml playbooks/90-validate-platform.yml
```

If needed, install required collections:

```bash
ansible-galaxy collection install ansible.posix
```

## Notes

- Default execution target for Linux baseline/validation is `phase1_linux_baseline` (currently `edge_pve`).
- To target a different group, pass `-e baseline_target_group=<group>` or `-e validation_target_group=<group>`.
- Preflight requires backup artifacts to exist at paths defined in `inventory/group_vars/all.yml`.
- `playbooks/02-proxmox-prep.yml` skips `state: planned` hosts by default. Set `-e proxmox_prep_include_planned_hosts=true` to include them.
- `playbooks/03-proxmox-upgrade.yml` skips `state: planned` hosts by default. Set `-e proxmox_upgrade_include_planned_hosts=true` to include them.
- Dist-upgrade remains disabled unless `-e proxmox_upgrade_run_dist_upgrade=true` is set.
- Automatic reboot after dist-upgrade is disabled by default; set `-e proxmox_upgrade_reboot_after_upgrade=true` to reboot nodes one-at-a-time when `/var/run/reboot-required` exists.
- `playbooks/02-proxmox-prep.yml` now includes NIC stability hardening for Proxmox hosts (managed EEE disable, e1000e module options, and optional PCIe ASPM disable via GRUB drop-in).
- NIC hardening is enabled by default but does not reboot hosts unless explicitly requested with `-e proxmox_nic_hardening_reboot_if_needed=true`.
- Use host-level `proxmox_nic_hardening_enabled: false` to opt out critical hosts (for example `edge_pve` router host) from this hardening profile.

## NIC Hang Hardening (e1000e)

The Proxmox prep role now enforces a deterministic NIC hardening path intended to reduce Intel e1000e management-link hang events:

- Boot-time EEE disable on configured interfaces (`proxmox_nic_hardening_target_interfaces`, default `nic0,onboard`) when driver is `e1000e`.
- e1000e module options (`proxmox_nic_hardening_e1000e_module_options`, default `SmartPowerDownEnable=0`).
- Runtime ASPM policy set to `performance` plus GRUB drop-in with `pcie_aspm=off` when `proxmox_nic_hardening_disable_pcie_aspm=true`.

Apply hardening without reboot:

```bash
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/02-proxmox-prep.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve
```

Apply hardening and reboot one host at a time when kernel-level settings changed:

```bash
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/02-proxmox-prep.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-e proxmox_nic_hardening_reboot_if_needed=true
```

## cp1-cp3-worker1 Update and Upgrade Workflow

Run from `ansible/` in a maintenance window. The upgrade playbook uses `serial: 1`, so nodes are processed one at a time to preserve quorum.

1. Verify the cluster is healthy before upgrading:

```bash
ansible -i inventory/hosts.yml cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-m shell -a 'pvecm status | sed -n "1,35p"' --ask-pass
```

2. Refresh package index only:

```bash
ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve --ask-pass \
	-e proxmox_upgrade_run_dist_upgrade=false
```

3. Run dist-upgrade without automatic reboot (review first):

```bash
ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve --ask-pass \
	-e proxmox_upgrade_run_dist_upgrade=true \
	-e proxmox_upgrade_reboot_after_upgrade=false
```

4. Run dist-upgrade with automatic reboot when required (fully automated path):

```bash
ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve --ask-pass \
	-e proxmox_upgrade_run_dist_upgrade=true \
	-e proxmox_upgrade_reboot_after_upgrade=true
```

5. Validate quorum and node status after the run:

```bash
ansible -i inventory/hosts.yml cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-m shell -a 'echo NODE=$(hostname -s); pvecm status | sed -n "1,35p"' --ask-pass
```

## Secure Proxmox Credentials (BW/BWS)

Use `../scripts/ansible-run.sh` to retrieve `PROXMOX_ROOT_PASSWORD` from Bitwarden Secrets Manager (`bws`) or Password Manager (`bw`) at runtime, then execute Ansible without storing plaintext secrets.

For `ansible` and `ansible-playbook` commands, the wrapper injects `ansible_password` and `ansible_become_password` automatically from the resolved secret.

Example:

```bash
export PROXMOX_ROOT_PASSWORD_BWS_SECRET_ID="<secret-uuid>"
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/02-proxmox-prep.yml

# Upgrade workflow (separate playbook)
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml
```

## Using Pre-Unlocked BW Session

If you unlock Bitwarden Password Manager first, `scripts/ansible-run.sh` will reuse `BW_SESSION` and fetch the Proxmox password item directly.

Secret key mapping in the decision doc identifies the Proxmox credential item as `proxmox-root-password`.

```bash
# one-time auth if needed
bw login --apikey

# unlock in current shell
export BW_SESSION="$(bw unlock --raw)"

# force Password Manager source and select item key
export PROXMOX_PASSWORD_SOURCE=bw
export PROXMOX_ROOT_PASSWORD_BW_ITEM="proxmox-root-password"

# update-only pass (safe first step)
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-e proxmox_upgrade_run_dist_upgrade=false

# dist-upgrade without auto reboot
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-e proxmox_upgrade_run_dist_upgrade=true \
	-e proxmox_upgrade_reboot_after_upgrade=false

# dist-upgrade with automatic reboot when required
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve,cp2_pve,cp3_pve,worker1_pve \
	-e proxmox_upgrade_run_dist_upgrade=true \
	-e proxmox_upgrade_reboot_after_upgrade=true
```

If your decision tree maps different password item names per host, run one host at a time with the corresponding key:

```bash
export PROXMOX_ROOT_PASSWORD_BW_ITEM="<host-specific-item>"
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml \
	--limit cp1_pve \
	-e proxmox_upgrade_run_dist_upgrade=true
```

## Running From A Different Subnet

If the automation runner is not directly routed to the Proxmox management subnet, validate one of these paths before running playbooks:

- Move the operator host onto the VLAN 10 break-glass access port.
- Use SSH jump host mode.

Example with ProxyJump:

```bash
export ANSIBLE_SSH_COMMON_ARGS='-o ProxyJump=root@10.0.10.3'
../scripts/ansible-run.sh ansible-playbook -i inventory/hosts.yml playbooks/03-proxmox-upgrade.yml
```

## Install-Window Mode (PVE Rebuild In Progress)

Use this mode while hosts are being rebuilt and you need to finish Phase 1 scaffold/validation without starting Phase 2 tasks:

```bash
ansible-playbook playbooks/00-preflight.yml \
	-e preflight_require_backup_artifacts=false \
	-e preflight_enforce_required_endpoints=false \
	-e preflight_linux_checks_enabled=false

ansible-playbook playbooks/01-baseline.yml --check \
	-e baseline_execution_enabled=false

ansible-playbook playbooks/90-validate-platform.yml \
	-e validation_enforce_required_endpoints=false \
	-e validation_linux_checks_enabled=false

ansible-playbook playbooks/02-proxmox-prep.yml \
	-e proxmox_prep_include_planned_hosts=false

ansible-playbook playbooks/03-proxmox-upgrade.yml \
	-e proxmox_upgrade_execution_enabled=false
```

Switch the toggles back to strict defaults after PVE installs complete.
