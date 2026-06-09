# Issue 001 — Intel I217-V e1000e EEE-Induced Hardware Unit Hang

**Date:** 2026-05-12  
**Affected nodes:** cp1, cp2, cp3, worker1 (all ThinkCentre M73 Tiny)  
**Severity:** Critical — nodes freeze their NIC, require manual power cycle to recover  
**Status:** Fixed

---

## Symptoms

- Periodic NIC disconnect on cp2, cp3, worker1 requiring manual physical reboot
- Cable-pull/reconnect did **not** restore link — hang is at the MAC/descriptor ring level, not physical
- `dmesg` on cp3 showed 44 consecutive entries before link failure:
  ```
  e1000e: nic0 NIC Link is Down
  e1000e 0000:00:19.0 nic0: Detected Hardware Unit Hang
  ```
- Hang survives `ip link set nic0 down/up`; only full reboot restores NIC
- ethtool `--show-eee` misleadingly reported EEE as "disabled" — the NIC was still **advertising** EEE at link autonegotiation despite driver-level disable

---

## Root Cause

**Intel I217-V (8086:153b rev 04)** — integrated LOM on Lenovo M73 Tiny (Haswell platform).

Known silicon bug: the I217-V PHY negotiates EEE (Energy Efficient Ethernet, IEEE 802.3az) at link-up regardless of the `ethtool --set-eee eee off` driver flag. When the link partner (MikroTik CSS326) agrees to enter LPI (Low Power Idle) mode, the NIC MAC enters a state it cannot recover from — the hardware descriptor ring freezes and the kernel detects a hardware unit hang.

Contributing factors also found and fixed during investigation:

| Factor | Nodes affected | Risk |
|--------|---------------|------|
| `pcie_aspm=off` missing from GRUB | cp3, worker1 | PCIe link power-down causing additional device hangs on Haswell |
| Deep C-states C6/C7s enabled (`max_cstate=9`) | all 4 | etcd jitter from 100–300µs wakeup latency |
| `intel_iommu=on iommu=pt` not set | all 4 | IOMMU not in passthrough mode, DMA overhead, silent regression risk |
| cp3 on e1000e driver 7.0.0-3-pve (older) | cp3 | Weaker hang recovery; 7.0.2-2-pve has improved reset path |

---

## Investigation

```bash
# Confirm EEE advertisement despite "disabled" status
ethtool --show-eee nic0
# Look for: "Advertised EEE link modes:" — if anything other than "Not reported", EEE is being negotiated

# Check kernel hang messages
dmesg | grep -i 'hardware unit hang\|NIC Link is Down\|e1000e' | tail -30

# Confirm NIC PCI ID
lspci -nn | grep Ethernet
# Expected: 00:19.0 Ethernet [0200]: Intel I217-V [8086:153b] rev 04

# Check current e1000e driver version
modinfo e1000e | grep ^version
# Target: 3.8.7-NAPI or newer (bundled with pve-kernel-7.0.2-2-pve)
```

---

## Fix

### 1. EEE advertisement disable + NIC offload hardening

Deployed via: `ansible-playbook ansible/playbooks/fix-e1000e-eee.yml`  
Script: `ansible/scripts/fix-e1000e-eee.sh`

Creates `/etc/systemd/system/disable-nic-eee-offload-nic0.service` on each node:

```ini
[Unit]
Description=Disable NIC EEE and hardware offloading on nic0 (Intel I217-V EEE hang workaround)
After=network.target

[Service]
Type=oneshot
RemainAfterExit=true
ExecStart=/sbin/ethtool --set-eee nic0 eee off advertise 0
ExecStart=/sbin/ethtool -K nic0 gso off gro off tso off tx off rx off rxvlan off txvlan off sg off

[Install]
WantedBy=multi-user.target
```

**Why `advertise 0`:** Forces the autonegotiation advertisement bitmap to zero, preventing EEE LPI mode negotiation at the PHY level, not just the driver level.

**Why offloading disabled:** Hardware GSO/GRO/TSO/checksum offloads on I217-V are unreliable under the LPI recovery path and have caused additional descriptor ring corruption after a partial hang.

### 2. GRUB kernel parameter hardening

Deployed via: `ansible-playbook ansible/playbooks/fix-grub-kernel-params.yml`  
Script: `ansible/scripts/fix-grub-kernel-params.sh`

Target cmdline (all 4 nodes):
```
quiet pcie_aspm=off intel_idle.max_cstate=3 intel_iommu=on iommu=pt
```

Requires reboot to activate. EEE service fix is live immediately (no reboot needed for that part).

### 3. cp3 kernel upgrade

Installed and pinned `proxmox-kernel-7.0.2-2-pve` on cp3. cp3 was on `7.0.0-3-pve` which had the older e1000e reset path.

```bash
apt-get install -y proxmox-kernel-7.0.2-2-pve
proxmox-boot-tool kernel pin 7.0.2-2-pve
# Activates on next reboot
```

---

## Verification

After reboot, confirm on each node:

```bash
# EEE no longer advertised
ethtool --show-eee nic0 | grep 'Advertised EEE'
# Expected: Advertised EEE link modes:  Not reported

# GRUB params active in running kernel
cat /proc/cmdline
# Must contain: pcie_aspm=off intel_idle.max_cstate=3 intel_iommu=on iommu=pt

# Systemd service running
systemctl status disable-nic-eee-offload-nic0.service
# Expected: active (exited)

# No hardware unit hang in dmesg
dmesg | grep -c 'Hardware Unit Hang'
# Expected: 0
```

---

## Notes

- **NIC firmware is not updatable.** The I217-V is a LOM with NVM bundled inside the Lenovo BIOS (FHKT87AUS 1.87). FHKT87AUS 1.87 is the final BIOS version for M73. No standalone NIC firmware update path exists.
- **Switch-side EEE (MikroTik CSS326):** SwOS does not expose an EEE toggle in the GUI for this model. Not required — since no host advertises EEE, autoneg for LPI mode never completes regardless of switch capability.
- **EEE fix is active immediately** — the systemd service runs at boot and can be started now with `systemctl start disable-nic-eee-offload-nic0.service`. GRUB changes require reboot.
- **Reboot order:** worker1 → cp3 (urgent: also activates kernel pin) → cp2 → cp1. Always keep 2 of 3 CP nodes up for etcd quorum.
