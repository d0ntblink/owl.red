# Power And Recovery

Power monitoring is not shutdown protection, and retained NAS data is not an
independent backup. Production application-state migration remains gated on
confirmed power dependencies and a usable recovery copy.

## UPS Monitoring

The CyberPower LX1500GU is connected by USB to `storage.pve.owl.red`.
The [dedicated Ansible playbook](../../ansible/playbooks/ups-monitor.yml) owns
monitor-only NUT on that host, not inside the NAS guest.

From the repository's `ansible/` directory:

```bash
../.venv/bin/ansible-playbook playbooks/ups-monitor.yml --check --diff
../.venv/bin/ansible-playbook playbooks/ups-monitor.yml -e ups_monitor_apply=true
```

The controller needs the existing Ansible environment and pinned-key OpenSSH
access. The target needs Debian package access, Python, systemd and udev; the
playbook installs `nut-server` and its required dependencies without upgrades
or recommended packages. No NUT software is required on the controller or NAS.

Read telemetry through the existing administration SSH path:

```bash
ssh -i ~/.ssh/id_ed25519_owl_ansible \
  -o BatchMode=yes -o StrictHostKeyChecking=yes root@10.0.10.4 \
  'upsc cyberpower@localhost'
```

`ups.status: OL` means utility power is present. `battery.runtime` is an
estimate in seconds, not a tested battery-capacity guarantee. Do not trigger
a discharge, self-test, forced shutdown, outlet command or unplug test as a
monitoring check.

### Safety Contract

- Only the confirmed `0764:0501` USB UPS on `storage_pve` is selected.
- The telemetry server binds only to IPv4/IPv6 loopback on port 3493.
- There are no configured control users or commands; `upsd.users` is empty.
- `nut-monitor.service` is disabled and masked; `upsmon.conf` is empty.
- The driver must report `driver.flag.allow_killpower: 0`.
- Existing unowned NUT configuration, running shutdown monitors or powerdown
  flags stop the playbook for review. It does not delete those flags.
- The playbook does not alter NAS guest configuration, network configuration,
  storage layout, power outlets or automatic restart settings.

The ownership marker permits repeat runs; it is not evidence that a host is
battery-backed. The Unraid Terraform UPS lane stays disabled because the USB
device is on the hypervisor and NAS shutdown integration is not qualified.

## Power Dependencies

Reported outlet labels are:

| Outlet | Connected Equipment |
|--------|---------------------|
| 1-4 | Four Lenovo ThinkCentre compute hosts |
| 5 | Not confirmed |
| 6 | Wireless access point |
| 7-8 | Unused |

Confirm the physical unit and battery-backed/surge-only outlet groups before
using this mapping for automation. Protection of the storage host/NAS, edge
host/router/DNS and core switch remains unverified. A USB connection does not
establish a power connection, and a PDU outlet does not establish UPS coverage.

Before enabling shutdown consumers, define and qualify a dependency-aware
sequence: stop application writers before storage, keep monitoring and network
paths alive until dependent systems acknowledge shutdown, and reserve battery
time for a clean NAS shutdown. Define restart ordering and wait for storage
readiness before starting dependent workloads. Do not enable UPS output-off
behavior until its hardware semantics and recovery path are explicitly verified.

## Backup Destination

No independent backup destination is available yet. Do not provision PBS or
schedule jobs against an arbitrary local/NAS path merely to mark backups active.
The NAS `backups` share and retained SMB PVC directories do not protect against
loss of the NAS itself.

Once a destination is selected:

1. Confirm ownership, existing contents, usable capacity and failure-domain
   independence. Do not format or repurpose a disk without explicit approval.
2. Size protected data, retention and growth before deploying PBS or selecting
   a file/application backup mechanism. Proxmox guest backups do not cover disks
   or application data excluded from those backups.
3. Use application-consistent capture where needed, with restricted credentials
   and an independently recoverable copy of configuration and encryption keys.
4. Restore into an isolated target and verify data and service behavior before
   relying on the schedule or migrating production state.

Neither configuration preimages nor a successful temporary-file storage test
replace an application-consistent backup and restore test.