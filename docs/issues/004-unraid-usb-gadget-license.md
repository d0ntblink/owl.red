# 004 — Unraid license USB flash replaced with software USB gadget

**Host:** storage (10.0.10.4)  
**VM:** nas.owl.red (VMID 101)  
**Resolved:** 2026-05-20

---

## Problem

Unraid 7 internal boot (booting from an internal disk rather than the USB flash) still requires
the original USB flash drive to be present for license validation. The license is tied to the
USB flash GUID, which is derived from the device's VID, PID, bcdDevice, and serial number.

Long-term operation with a physical USB flash permanently plugged into a server is unreliable:
USB flash drives are not rated for continuous power and can fail silently. The goal was to
replace the physical USB entirely with a software equivalent.

---

## Approaches considered

### Virtual TPM (blocked)

Unraid 7 supports license transfer to a virtual TPM, which would eliminate the USB dependency.
A swtpm v2.0 TPM was added to the VM (`tpm_state` on local-lvm) and is visible inside the guest
as `/dev/tpm0` and `/dev/tpmrm0`.

**Why it failed:** Unraid's license transfer wizard detects virtual machines via ACPI tables
(specifically the `BOCHS` manufacturer string in ACPI). It refuses to bind a license to a VM's
virtual TPM. There is no documented workaround short of patching the Unraid binary.

### USB gadget emulation (implemented)

The Linux USB gadget framework (`libcomposite` + `usb_f_mass_storage`) combined with a software
USB Device Controller (`dummy_hcd`) can create a virtual USB mass storage device that is
indistinguishable from the physical flash drive. Proxmox passes it through to the VM using the
same VID:PID matching as the original.

---

## Implementation

### USB flash identifiers (original drive)

| Field       | Value       |
|-------------|-------------|
| VID         | `0x24a9`    |
| PID         | `0x205a`    |
| bcdUSB      | `0x0320`    |
| bcdDevice   | `0x0000`    |
| Serial      | `40687012`  |
| Product     | `PHILIPS`   |
| Manufacturer| *(empty)*   |
| Unraid GUID | `24A9-205A-0000-000040687012` |

> **Note on bcdDevice:** `lsusb` reported `1.10` (0x0110) for this field, but the Unraid
> license portal shows `0000` in the GUID. The gadget is configured with `0x0000` to match
> exactly what Unraid has on record.

### Image

The physical USB was imaged as a sparse file before removal:

```bash
qm stop 101
dd if=/dev/sdb of=/var/lib/unraid-usb/unraid-license-usb.img bs=64M conv=sparse status=progress
sync
```

Logical size: 59G. Actual disk usage: ~14G (2.7G of real data, rest is sparse zeros).

### dummy_hcd module

`CONFIG_USB_DUMMY_HCD` is explicitly disabled in the Proxmox 9 kernel config. It must be built
as an out-of-tree DKMS module.

```bash
apt install build-essential git dkms proxmox-headers-$(uname -r) pve-headers

cd /root
git clone https://github.com/xairy/raw-gadget.git
mkdir -p /usr/src/dummy_hcd-0.1
cp -av /root/raw-gadget/dummy_hcd/* /usr/src/dummy_hcd-0.1/
rm -rf raw-gadget/
cd /usr/src/dummy_hcd-0.1

cat > /usr/src/dummy_hcd-0.1/dkms.conf <<'EOF'
PACKAGE_NAME="dummy_hcd"
PACKAGE_VERSION="0.1"

BUILT_MODULE_NAME[0]="dummy_hcd"
DEST_MODULE_LOCATION[0]="/updates/dkms"

AUTOINSTALL="yes"

MAKE[0]="make KDIR=/lib/modules/${kernelver}/build"
CLEAN="make clean"
EOF

dkms add -m dummy_hcd -v 0.1
dkms build -m dummy_hcd -v 0.1
dkms install -m dummy_hcd -v 0.1
depmod -a
modprobe libcomposite
modprobe usb_f_mass_storage
modprobe dummy_hcd
```

DKMS will automatically rebuild the module on kernel upgrades (`AUTOINSTALL="yes"`).

### Module auto-load

```bash
cat > /etc/modules-load.d/unraid-usb-gadget.conf <<'EOF'
dummy_hcd
libcomposite
usb_f_mass_storage
EOF
```

### Gadget script

`/usr/local/sbin/start-unraid-usb-gadget.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

G=/sys/kernel/config/usb_gadget/unraidusb
IMG=/var/lib/unraid-usb/unraid-license-usb.img
UDC_NAME=dummy_udc.0

mountpoint -q /sys/kernel/config || mount -t configfs none /sys/kernel/config

if [ -d "$G" ]; then
  echo "" > "$G/UDC" 2>/dev/null || true
  rm -f "$G/configs/c.1/mass_storage.usb0" 2>/dev/null || true
  rmdir "$G/functions/mass_storage.usb0" 2>/dev/null || true
  rmdir "$G/configs/c.1/strings/0x409" "$G/configs/c.1" 2>/dev/null || true
  rmdir "$G/strings/0x409" "$G" 2>/dev/null || true
fi

mkdir -p "$G"
cd "$G"

echo 0x24a9 > idVendor
echo 0x205a > idProduct
echo 0x0320 > bcdUSB
echo 0x0000 > bcdDevice

mkdir -p strings/0x409
echo "40687012" > strings/0x409/serialnumber
echo ""         > strings/0x409/manufacturer
echo "PHILIPS"  > strings/0x409/product

mkdir -p configs/c.1/strings/0x409
echo "Mass Storage" > configs/c.1/strings/0x409/configuration
echo 250            > configs/c.1/MaxPower

mkdir -p functions/mass_storage.usb0
echo 1         > functions/mass_storage.usb0/lun.0/removable
echo 0         > functions/mass_storage.usb0/lun.0/ro
echo "PHILIPS" > functions/mass_storage.usb0/lun.0/inquiry_string
echo "$IMG"    > functions/mass_storage.usb0/lun.0/file

ln -s functions/mass_storage.usb0 configs/c.1/
echo "$UDC_NAME" > UDC
```

### systemd service

`/etc/systemd/system/unraid-usb-gadget.service`:

```ini
[Unit]
Description=Create Unraid USB gadget
After=systemd-modules-load.service
Before=pve-guests.service
ConditionPathExists=/var/lib/unraid-usb/unraid-license-usb.img

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/start-unraid-usb-gadget.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable unraid-usb-gadget.service
systemctl start unraid-usb-gadget.service
```

### VM passthrough

The VM USB passthrough was previously port-bound (`host=4-6`). Updated to VID:PID matching
so it finds the virtual gadget regardless of which bus it lands on after reboot:

```bash
qm set 101 -usb0 'host=24a9:205a,usb3=1'
```

---

## Verification

```bash
# Gadget visible on host USB bus
lsusb -d 24a9:205a
# Expected: one entry, Bus 00X Device 00Y: ID 24a9:205a  PHILIPS

# Service healthy
systemctl status unraid-usb-gadget.service
# Expected: active (exited)

# UDC bound
cat /sys/kernel/config/usb_gadget/unraidusb/UDC
# Expected: dummy_udc.0
```

Start the VM and verify the Unraid WebUI shows the license as valid.

---

## Operational notes

- **Physical USB:** Permanently removed from the server. Do not reinsert — duplicate
  VID/PID/serial will conflict with the gadget and Proxmox passthrough will be ambiguous.
- **Image file:** `/var/lib/unraid-usb/unraid-license-usb.img` is the authoritative copy.
  Back it up. If the Proxmox host root volume is rebuilt, this file must be restored before
  the VM can start.
- **Kernel upgrades (CRITICAL):** DKMS rebuilds `dummy_hcd` automatically, *but only if the corresponding kernel headers are installed*. Proxmox does not always pull the headers for new kernels automatically.
  - If the VM fails to start or Unraid complains about a missing license after a host reboot, check `systemctl status unraid-usb-gadget.service`.
  - If it failed, the system likely booted into a new kernel without building the `dummy_hcd` module.
  - **Fix:** Install the headers for the active kernel (`apt install proxmox-headers-$(uname -r)`), force DKMS to rebuild (`dkms autoinstall -k $(uname -r)`), and restart the gadget service. To prevent this, ensure the metapackage `proxmox-headers-7.0` (or similar for major versions) is installed.
- **TPM:** The `tpm_state` block remains in the VM for future use, but Unraid currently
  ignores it for licensing due to the BOCHS VM detection. Do not remove it.
