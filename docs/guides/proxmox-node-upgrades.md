# Proxmox Node Upgrades

Applies to all `proxmox_hosts` inventory group: `edge_pve`, `storage_pve`, `cp1_pve`–`cp3_pve`, `worker1_pve`.

---

## Prerequisites

- SSH key `~/.ssh/id_ed25519_owl_ansible` must be present and authorized on all nodes
- Run from the repo root: `cd ~/owl.red`

---

## Commands

### Refresh apt cache only (safe, no changes)

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml \
  ansible/playbooks/03-proxmox-upgrade.yml
```

### Run dist-upgrade (applies pending packages)

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml \
  ansible/playbooks/03-proxmox-upgrade.yml \
  -e proxmox_upgrade_run_dist_upgrade=true
```

### Run dist-upgrade and auto-reboot if required

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml \
  ansible/playbooks/03-proxmox-upgrade.yml \
  -e proxmox_upgrade_run_dist_upgrade=true \
  -e proxmox_upgrade_reboot_after_upgrade=true
```

> **Note:** Reboots are only triggered when `/var/run/reboot-required` exists after the upgrade. If no reboot is needed, nothing happens even if `reboot_after_upgrade=true`.

### Target a single node

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml \
  ansible/playbooks/03-proxmox-upgrade.yml \
  -e proxmox_upgrade_run_dist_upgrade=true \
  -l edge_pve
```

Valid `-l` values: `edge_pve`, `storage_pve`, `cp1_pve`, `cp2_pve`, `cp3_pve`, `worker1_pve`

---

## How it works

- Runs **serially** (`serial: 1`) — one node at a time, never parallel
- `any_errors_fatal: true` — stops the entire run if any node fails
- `dpkg_options: force-confdef,force-confold` — keeps existing config files on package upgrades without prompting
- Reboot is opt-in and only fires if the kernel or a core lib actually changed

### Role defaults (`ansible/roles/proxmox_upgrade/defaults/main.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `proxmox_upgrade_run_apt_update` | `true` | Always refresh apt cache |
| `proxmox_upgrade_run_dist_upgrade` | `false` | Must explicitly enable to apply packages |
| `proxmox_upgrade_reboot_after_upgrade` | `false` | Must explicitly enable auto-reboot |
| `proxmox_upgrade_reboot_timeout` | `1200` | Max seconds to wait for reboot |
| `proxmox_upgrade_reboot_pre_delay` | `5` | Seconds before issuing reboot |
| `proxmox_upgrade_reboot_post_delay` | `20` | Seconds to wait after reboot before continuing |

---

## Notes

- If the playbook comes up empty (`Empty playbook, nothing to do`), the file was likely wiped. Restore with: `git checkout HEAD -- ansible/playbooks/03-proxmox-upgrade.yml`
- Do **not** use `scripts/ansible-run.sh` for this playbook — that script was designed for password injection (now removed) and is only needed for playbooks that require `ansible_password` on hosts without key-based auth.
