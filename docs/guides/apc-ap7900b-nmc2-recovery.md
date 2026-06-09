# APC AP7900B PDU — NMC2 Recovery Guide

**Device:** APC AP7900B Rack PDU  
**NMC:** NMC2 embedded (model `0G-1238`, HW Rev `05`)  
**Applies to:** AP7900B units manufactured ~2017 with NMC2 (`apc_hw05_*` firmware)

---

## Symptom Index

| Symptom | Section |
|---------|---------|
| Can't log in — unknown password | [§1 Factory Reset](#1-factory-reset) |
| PDU got DHCP address instead of static IP | [§2 Set Static IP via Telnet](#2-set-static-ip-via-telnet) |
| Web UI shows "Application Was Not Able to Load" | [§3 Restore Missing APP Firmware](#3-restore-missing-app-firmware) |
| FTP upload dies at ~55 KB with "Connection reset by peer" | [§4 FTP Upload Method](#4-ftp-upload-method) |
| `about` shows `Invalid Module Header!` for Application Module | [§3 Restore Missing APP Firmware](#3-restore-missing-app-firmware) |
| Telnet banner shows `Stat: A-` (Application status bad) | [§3 Restore Missing APP Firmware](#3-restore-missing-app-firmware) |
| Want to upgrade firmware on a working NMC2 | [§5 Full Firmware Upgrade Procedure](#5-full-firmware-upgrade-procedure) |

---

## Background: NMC1 vs NMC2 vs NMC3

APC Network Management Cards come in three generations. It matters because firmware is not cross-compatible.

| Generation | Firmware prefix | Bootmon | AOS era | APP for Rack PDU |
|------------|----------------|---------|---------|-----------------|
| NMC1 | `apc_hw02_*` | < v1.0.6 | < v3.x | `apc_hw02_rpdu_*.bin` |
| NMC2 | `apc_hw05_*` | v1.0.6–v1.0.9 | v6.x–v7.x | `apc_hw05_rpdu2g_*.bin` |
| NMC3 | `apc_hw21_*` | v1.5.x+ | v1.x (NMC3 numbering) | `apc_hw21_rpdu_*.bin` |

**How to identify NMC generation via telnet `about` command:**

```
APC Boot Monitor
----------------
Version: v1.0.8   → NMC2
Version: v1.0.9   → NMC2 (latest)
Version: v1.5.x   → NMC3
```

**This guide covers NMC2 only.** The AP7900B shipped with NMC2 through ~2019; later units have NMC3.

---

## Prerequisites

- Jump host with network access to PDU management VLAN (`10.0.10.0/24`)
  - In this environment: `edge.pve` at `10.0.10.3`
- `expect` installed on jump host
- Python 3 installed on jump host (for FTP upload workaround)
- Physical access to the PDU for factory reset

---

## 1. Factory Reset

**Use when:** Password is unknown or device is not responding to credentials.

### What factory reset does

- Resets all credentials to default (`apc` / `apc`)
- Resets IP configuration to DHCP
- **Wipes the APP firmware module** — the Application module (`rpdu2g`) is erased and must be re-uploaded after reset

### Hardware reset procedure

1. Locate the **reset button** on the NMC face plate (recessed, requires a pin or straightened paperclip)
2. Power the PDU on and let it fully boot (wait ~90 seconds until the LED is solid or slow-blink)
3. Hold the reset button for **~20–25 seconds** until the LED sequence changes (rapid blink or color change)
4. Release — the NMC reboots into factory defaults

> **Pitfall:** Holding reset during early boot can trigger a different mode. Let the device fully boot first, *then* hold reset.

### After reset

The NMC comes up on **DHCP**. Find the address:

```bash
# Check your DHCP server's lease table, or scan the subnet
ssh root@10.0.10.3 "nmap -sn 10.0.10.0/24 | grep -A1 '00:C0:B7'"
```

The NMC MAC prefix is `00:C0:B7` (APC/Schneider Electric).

Default credentials after reset: `apc` / `apc`

Verify access:

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet <DHCP-IP>
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"about\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

---

## 2. Set Static IP via Telnet

After reset the device is on DHCP. Set a static IP before proceeding.

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet <DHCP-IP>
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"tcpip -i 10.0.10.9 -s 255.255.255.0 -g 10.0.10.1\r\"
  expect \">\"
  send \"reboot\r\"
  expect -re \"(ontinue|YES)\"; send \"YES\r\"
  expect eof
"'
```

Wait ~60 seconds for reboot, then verify:

```bash
ping -c 3 10.0.10.9
ssh root@10.0.10.3 'expect -c "
  set timeout 10
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"tcpip\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

---

## 3. Restore Missing APP Firmware

After a factory reset, the Application Module shows:

```
Application Module
------------------
Invalid Module Header!
```

And the telnet banner status shows `A-`. The web UI at `http://<IP>/home.htm` shows:

> "There was a problem loading the application. Please login to the device via telnet for more details."

This is because factory reset erases the APP (`rpdu2g`) firmware. It must be re-uploaded via FTP.

**Proceed to [§4 FTP Upload Method](#4-ftp-upload-method) and [§5 Full Firmware Upgrade Procedure](#5-full-firmware-upgrade-procedure).**

---

## 4. FTP Upload Method

### The problem: embedded FTP server resets at ~55 KB

Standard FTP clients (`ftp`, `curl -T`, `lftp`) fail when uploading large files to the NMC2 FTP server:

```
Send failure: Connection reset by peer
```

This happens at ~55 KB regardless of file size. The embedded FTP server on the NMC2 cannot handle large TCP send buffers.

### The fix: Python ftplib with 512-byte block size

Use Python's `ftplib` with `blocksize=512` and passive mode. This sends data in 512-byte chunks, which the embedded server handles reliably.

```python
import ftplib

ftp = ftplib.FTP()
ftp.connect("10.0.10.9", 21, timeout=120)
ftp.login("apc", "apc")
ftp.set_pasv(True)

with open("/tmp/apc_hw05_rpdu2g_726.bin", "rb") as f:
    ftp.storbinary("STOR apc_hw05_rpdu2g_726.bin", f, blocksize=512)

ftp.quit()
```

> **Note:** A ~2.8 MB file takes several minutes at 512 bytes/chunk. This is expected.

### Upload script for all three firmware files

```bash
ssh root@10.0.10.3 'python3 -c "
import ftplib, time

files = [
    \"/tmp/apc_hw05_aos_722.bin\",
    \"/tmp/apc_hw05_rpdu2g_726.bin\",
    \"/tmp/apc_hw05_bootmon_109.bin\",
]

for fpath in files:
    fname = fpath.split(\"/\")[-1]
    print(f\"Uploading {fname}...\", flush=True)
    ftp = ftplib.FTP()
    ftp.connect(\"10.0.10.9\", 21, timeout=120)
    ftp.login(\"apc\", \"apc\")
    ftp.set_pasv(True)
    with open(fpath, \"rb\") as f:
        ftp.storbinary(f\"STOR {fname}\", f, blocksize=512)
    ftp.quit()
    print(f\"Done: {fname}\", flush=True)
    time.sleep(5)

print(\"All uploaded\")
"'
```

> **Important:** Upload AOS first, then APP (rpdu2g), then bootmon. The NMC may auto-apply and reboot between files — if it does, re-connect and upload the remaining files.

---

## 5. Full Firmware Upgrade Procedure

### Step 1: Identify current firmware

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"about\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

Confirm you see `bootmon v1.0.x` and hardware revision `05` — this confirms NMC2. If you see `bootmon v1.5.x`, this is NMC3 and this guide does not apply.

### Step 2: Download NMC2 RPDU 2G firmware package

Firmware is distributed by Schneider Electric. The package contains all three bin files in a self-extracting Windows EXE bundled in a ZIP.

```bash
# Download the ZIP (no file type param required)
curl -L "https://download.schneider-electric.com/files?p_Doc_Ref=APC_RPDU2G_EN" \
  -o /tmp/rpdu2g.zip

# Verify it's a ZIP
file /tmp/rpdu2g.zip
# Expected: Zip archive data

# Extract the ZIP to get the self-extracting EXE
unzip /tmp/rpdu2g.zip -d /tmp/rpdu2g/
ls /tmp/rpdu2g/
# Expected: apc_hw05_aos722_rpdu2g726_bootmon109.exe  PDU RN 990-9958R-001.pdf

# Extract the EXE (it's a self-extracting ZIP)
unzip /tmp/rpdu2g/apc_hw05_aos722_rpdu2g726_bootmon109.exe -d /tmp/rpdu2g/extracted/
ls /tmp/rpdu2g/extracted/Bins/
```

Expected bin files:

```
apc_hw05_aos_722.bin       (3,134,720 bytes)  — AOS v7.2.2
apc_hw05_rpdu2g_726.bin    (2,813,764 bytes)  — APP v7.2.6  ← critical for web UI
apc_hw05_bootmon_109.bin   (262,144 bytes)    — Bootmon v1.0.9
```

> **If the SE download URL returns 404:** Schneider Electric periodically reorganizes their download portal. Check [https://www.se.com/us/en/product/AP7900B/](https://www.se.com/us/en/product/AP7900B/) under "Downloads & Documentation" → "Firmware". Look for "Network Management Card v7.x.x RPDU 2G Firmware Release".

> **Do not use** firmware labeled `apc_hw05_rpdu_*.bin` (without `2g`) — that is a different APP for older NMC2 RPDU 1G devices and is not compatible with the AP7900B.

### Step 3: Copy firmware to jump host

```bash
scp /tmp/rpdu2g/extracted/Bins/*.bin root@10.0.10.3:/tmp/
ssh root@10.0.10.3 "ls -la /tmp/apc_hw05_*.bin"
```

### Step 4: Upload firmware via FTP

Use the upload script from [§4](#4-ftp-upload-method). The NMC will apply firmware in the order: AOS → APP → bootmon, rebooting as needed.

After the upload script completes, verify the files landed:

```bash
ssh root@10.0.10.3 'python3 -c "
import ftplib
ftp = ftplib.FTP()
ftp.connect(\"10.0.10.9\", 21, timeout=30)
ftp.login(\"apc\", \"apc\")
ftp.set_pasv(True)
print(ftp.nlst())
ftp.quit()
"'
```

The NMC consumes firmware files as it applies them — an empty listing means they were applied. Files remaining in the listing means they are staged for the next reboot.

### Step 5: Reboot to apply

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 30
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"reboot\r\"
  expect -re \"(ontinue|YES)\"; send \"YES\r\"
  sleep 3
  expect eof
"'
```

Wait for PDU to come back up:

```bash
for i in $(seq 1 30); do
  sleep 10
  result=$(ping -c 1 -W 2 10.0.10.9 2>&1 | grep -c "1 received")
  [ "$result" -eq 1 ] && echo "Back up after ${i}0s" && break || echo "Waiting ${i}0s..."
done
```

### Step 6: Verify firmware

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"about\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

Expected output:

```
Schneider Electric     Network Management Card AOS  v7.2.2
(c) Copyright 2025    RPDU 2g APP                  v7.2.6
...
Stat: P+ N4+ N6+ A+       ← A+ means APP is valid

Application Module
------------------
Name:     rpdu2g
Version:  v7.2.6

APC OS(AOS)
-----------
Name:     aos
Version:  v7.2.2

APC Boot Monitor
----------------
Name:     bootmon
Version:  v1.0.9
```

### Step 7: Verify web UI

```bash
curl -sL "http://10.0.10.9/" -w "%{http_code} → %{redirect_url}\n" -o /dev/null
# Expected: 303 → http://10.0.10.9/logon.htm

curl -s "http://10.0.10.9/logon.htm" | grep -i "title"
# Expected: <title>Log On</title>
```

---

## 6. Post-Recovery Configuration

### Set hostname

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"system -n pdu.owl.red\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

### Set NTP

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"ntp -e enable -p 10.0.10.1\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

### Change default password

**Do this immediately after recovery.** Default `apc`/`apc` credentials should not remain active.

Via web UI: `http://10.0.10.9` → log in → Administration → Security → Local Users → Super User → change password.

Via telnet:

```bash
ssh root@10.0.10.3 'expect -c "
  set timeout 15
  spawn telnet 10.0.10.9
  expect \"User Name\"; send \"apc\r\"
  expect \"Password\"; send \"apc\r\"
  expect \">\"
  send \"user -n apc -pw NEWPASSWORD\r\"
  expect \">\"
  send \"quit\r\"
  expect eof
"'
```

---

## 7. Troubleshooting

### `about` shows `bootmon` in Application Module slot after upload

```
Application Module
------------------
Name:    bootmon       ← wrong
Version: v1.0.9
```

This means the NMC applied bootmon but the rpdu2g file was not staged correctly when the reboot happened. Re-upload `apc_hw05_rpdu2g_726.bin` alone and reboot:

```bash
ssh root@10.0.10.3 'python3 -c "
import ftplib
ftp = ftplib.FTP()
ftp.connect(\"10.0.10.9\", 21, timeout=120)
ftp.login(\"apc\", \"apc\")
ftp.set_pasv(True)
with open(\"/tmp/apc_hw05_rpdu2g_726.bin\", \"rb\") as f:
    ftp.storbinary(\"STOR apc_hw05_rpdu2g_726.bin\", f, blocksize=512)
print(\"Done\")
ftp.quit()
"'
```

Then reboot. After reboot the banner should show `RPDU 2g APP v7.2.6`.

### FTP returns `421 Service not available`

The NMC is mid-reboot applying firmware. Wait 60–90 seconds and retry.

### PDU not reachable after reboot

The NMC firmware flash takes longer than a normal reboot. Allow up to 3–4 minutes. If still unreachable after 5 minutes, verify the static IP was set correctly. If the static IP was not saved before the reboot that wiped it, the device may have fallen back to DHCP — scan for MAC `00:C0:B7:DF:67:08`.

### Web UI login page blank / immediate redirect loop

Clear browser cache, or try a different browser. The NMC2 web UI uses inline JavaScript that some browsers block in strict content security modes. Chrome in a private window is reliable.

---

## 8. Reference

### This device's final configuration

| Field | Value |
|-------|-------|
| Model | AP7900B |
| NMC Model | 0G-1238 (NMC2) |
| NMC HW Rev | 05 |
| MAC | `00:C0:B7:DF:67:08` |
| IP | `10.0.10.9` |
| Hostname | `pdu.owl.red` |
| AOS | v7.2.2 |
| APP | rpdu2g v7.2.6 |
| Bootmon | v1.0.9 |
| Credentials | see vault |
| NTP | `10.0.10.1` |
| Switch port | `SW16` → `PP32` |

### Firmware package contents (`APC_RPDU2G_EN`)

| File | Component | Version |
|------|-----------|---------|
| `apc_hw05_aos_722.bin` | AOS (OS) | v7.2.2 |
| `apc_hw05_rpdu2g_726.bin` | APP (Rack PDU 2G application) | v7.2.6 |
| `apc_hw05_bootmon_109.bin` | Boot Monitor | v1.0.9 |

### Telnet command quick reference

| Task | Command |
|------|---------|
| Show firmware versions | `about` |
| Show / set IP config | `tcpip -i <ip> -s <mask> -g <gw>` |
| Set hostname | `system -n <name>` |
| Enable NTP | `ntp -e enable -p <server>` |
| Set date | `date -d mm/dd/yyyy` |
| Set time | `date -t hh:mm:ss` |
| Change password | `user -n apc -pw <password>` |
| Reboot | `reboot` then `YES` |
| List all commands | `?` |
