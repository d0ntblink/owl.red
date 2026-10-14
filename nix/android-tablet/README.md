# Bedside Android Tablet

Repeatable setup and operating record, checked against the tablet on
**2026-10-14**. Keep Lenovo Android rather than replacing it with AOSP: the
HA-200 dock and stock 60% charging limit have not been validated on another ROM.

| Item | Verified value |
|------|----------------|
| Device | Lenovo TB-X606FA, serial `HVA0GSZV` |
| Platform | ARM64, MediaTek MT8768; MTKClient identified code `0x766` as MT6765/MT8768t |
| Firmware | Android 10, `TB-X606FA_S300623_230730_BMP`, security patch 2023-05-05 |
| Root | Magisk 30.7; `su -c id` returned UID 0 |
| Boot security | Bootloader unlocked; dm-verity disabled; SELinux enforcing |
| System | Read-only after the approved reboot on 2026-10-14 |
| Management | Wi-Fi ADB `10.0.10.166:5555`; key-only SSH `d0ntblink@10.0.10.166:8022` |
| Network | DHCP, no reservation; see [MAC inventory](../../docs/mac-inventory.md) |
| Charging | `battery_protected_charge=1`; stock UI specifies a 60% limit |
| Reboot test | SSH and Wi-Fi ADB returned automatically on 2026-10-14 |

No further reboot, factory reset, or backup is authorized by these scripts.
A new tablet needs separate unlock/wipe approval and its own recovery images.
Do not reuse this unit's boot image, host keys, or lock configuration on another
tablet. Dock audio, actual charge cutoff, screen-off alarms, power-loss startup,
and unattended first-unlock behavior still need physical validation.

## Current Installed Apps

The [2026-10-14 snapshot](installed-apps/2026-10-14T174435Z-HVA0GSZV.json) contains
**181 installed packages for Android user 0**, including framework, vendor and
Google services, and overlays. This is not a count of 181 launcher apps. Each
record includes package ID, version code, and APK path; no app data or secrets.

| App | Package | Observed version code / status |
|-----|---------|--------------------------------|
| F-Droid | `org.fdroid.fdroid` | `1023052` |
| Termux | `com.termux` | `1002` |
| Termux:Boot | `com.termux.boot` | `1000` |
| kiFOSSk | `com.shinydiscoballsdev.kifossk` | `7` |
| FOSS Browser | `de.baumann.browser` | `159` |
| Open-source Clock | `com.best.deskclock` | `2037` |
| Finamp | `com.unicornsonlsd.finamp` | `52` |
| Plexamp | `tv.plex.labs.plexamp` | `324001157` |
| Android System WebView | `com.google.android.webview` | `803710601`; runtime 154.0.8037.106 previously verified |
| Magisk | `com.topjohnwu.magisk` | `30700` |
| Material Files | `me.zhanghai.android.files` | `40`; observed addition, not in the managed manifest |
| Jellyfin video | `org.jellyfin.mobile` | Absent; requested in the manifest |
| Plex video | `com.plexapp.android` | Absent; store install pending |
| Files by Google | `com.google.android.apps.nbu.files` | Absent |

[apps.json](apps.json) is the requested deployment; the snapshot is the observed
state. Do not silently equate them or reinstall apps simply to match a log.
From the repository root, refresh the inventory after maintenance:

```sh
bash scripts/android-tablet-inventory.sh
```

The exporter checks device identity through SSH and creates a new timestamped
JSON file under `installed-apps/`, without overwriting previous logs or copying
APKs/app data. Overrides: `TABLET_MANIFEST`, `TABLET_INVENTORY_DIR`, `TABLET_HOST`,
`SSH_USER`, `SSH_PORT`, `SSH_IDENTITY_FILE`, and `SSH_KNOWN_HOSTS`.

## Host Deployment

### Tools And Transport

Required: Bash, jq, curl, GnuPG, OpenSSH, Git, unzip, Android platform tools, and
e2fsprogs for checking the recovery image. MTKClient uses an isolated Python
environment. Exercised versions: platform tools 37.0.1, Magisk 30.7, and MTKClient
commit `7cb40e727727dfe3faa065eefb29b16ed29bbdf1` (package version 2.1.4).

From the repository root, an optional Nix tooling environment is:

```sh
nix develop path:./nix/android-tablet
```

The flake is a host tooling shell, not NixOS on Android. Nix was unavailable in
the bootstrap WSL environment, so evaluation and generation of `flake.lock`
remain pending. The scripts also work with installed host tools. This is not a
locked Nix deployment, Android app-data rollback, or unattended rooting tool.

The scripts also work with existing tools. For Windows-native ADB from WSL,
set `ADB_BIN` to the Windows `adb.exe` path and `ADB_PORT=5038`. The separate
port avoids contacting WSL's Linux ADB server through localhost forwarding.
`ADB_TARGET`, `SSH_PUBLIC_KEY`, `TABLET_MANIFEST`, and `TABLET_CACHE` can override
their documented script defaults. The default public key is
`~/.ssh/id_ed25519_owl_ansible.pub`; private keys are never deployed.

`apps.json` pins F-Droid APK URLs and version codes. Downloads are verified with
F-Droid's published OpenPGP fingerprint. Already-installed equal or newer
versions are left alone; app data and Android settings are not Nix rollbacks.
Plex, Plexamp, and WebView use their official Google Play entries separately.

Working WSL setup for Windows-native ADB:

```sh
export ADB_BIN="$(wslpath -u "$(powershell.exe -NoProfile -NonInteractive -Command '(Get-Command adb.exe -ErrorAction Stop).Source' | tr -d '\r')")"
export ADB_PORT=5038
export TABLET_MANIFEST="$PWD/nix/android-tablet/apps.json"
SERIAL=$(jq -r '.device.serial' "$TABLET_MANIFEST")
export ADB_TARGET="$SERIAL"
adb_host() { "$ADB_BIN" -P "$ADB_PORT" "$@" </dev/null; }
adb_device() { adb_host -s "$ADB_TARGET" "$@"; }
adb_host devices -l
```

Approve the computer on the tablet. Windows ADB, Linux ADB, and SSH have separate
authorization/host-key state. Use Linux fastboot/MTKClient with USBIPD for their
low-level modes, but detach from WSL for Windows-native Android transfers.
Do not change a working transport repeatedly or trust a partial APK/image.

### Fresh-Tablet Identity Gate

1. Record the model, serial, firmware, Android version, ABI, and network address.
  Check the stock dock and charging limit before modification when possible.
2. Obtain explicit factory-reset approval. **OEM unlocking** only permits an
  unlock; it does not perform one or provide root.
3. For another unit, update [apps.json](apps.json), the serial guard in
  [the cleanup script](../../scripts/android-tablet-debloat.sh), and the serial
  guard in [the ADB boot hook](start-wifi-adb.sh). The cleanup firmware guard and
  paths are build-specific: inspect a different build rather than deleting
  those guards. Review the SSH subnet allowlist for the intended network.
4. Pre-download and verify the app set while preparing the tablet:

  ```sh
  bash scripts/android-tablet-apps.sh download
  ```

The cache is `${XDG_CACHE_HOME:-$HOME/.cache}/owl-red/android-tablet`. Signature
verification uses F-Droid's published key
`37D2C98789D8311948394E3E41E7044E1DBA2E89`. Existing equal/newer app versions are
preserved. Do not add per-app backups when the user has declared them disposable.

### Read This Tablet's Stock Images

A downloaded firmware archive is not the only path. MTKClient read this tablet's
own stock images through MediaTek boot-ROM mode. Verify support on each device;
a chip-family listing alone does not prove its security configuration permits
readback. Use [upstream MTKClient](https://github.com/bkerler/mtkclient), its
[installation guide](https://github.com/bkerler/mtkclient/blob/main/README-INSTALL.md),
and the tested commit above in a dedicated venv.

Run from a dedicated recovery directory and retain MTKClient's `.state` between
commands in the same download-agent session. Here `python` is its venv Python:

```sh
python /path/to/mtkclient/mtk.py printgpt
python /path/to/mtkclient/mtk.py r boot,vbmeta,recovery,dtbo,seccfg boot-stock.img,vbmeta-stock.img,recovery-stock.img,dtbo-stock.img,seccfg-stock.bin
sha256sum boot-stock.img vbmeta-stock.img recovery-stock.img dtbo-stock.img seccfg-stock.bin
```

Start the reader first, power the tablet fully off, then connect using its
boot-ROM key sequence. Both volume buttons were used in this session. Confirm
actual chip identification and successful reads; a black or charging screen
does not establish the mode. Do not issue write/erase/unlock commands during
readback. The read path can load a temporary agent in RAM without modifying
stock partitions.

Observed USB IDs: Android `17ef:7c46`, fastboot `0e8d:201c`, boot-ROM `0e8d:0003`.
`Shared` in USBIPD does not mean `Attached` to WSL. For short-lived modes, use a
temporary policy from Administrator PowerShell, substituting the actual bus ID:

```powershell
usbipd policy add --effect Allow --operation AutoBind --busid 7-3
usbipd attach --wsl --busid 7-3 --auto-attach --unplugged
```

Record the returned GUID. This policy affects any device on that physical port.
Stop the watcher before Windows-native ADB use. If the agent's reset hangs after
completed reads, unplug and use the normal power-button restart into Android;
never interrupt an active partition write.

For this unit, `boot` and `recovery` are 32 MiB each; `vbmeta`, `dtbo`, and
`seccfg` are 8 MiB each. Original images and `SHA256SUMS.stock` are outside Git at
`/home/n0rth/android-backups/lenovo-TB-X606FA-HVA0GSZV-S300623/`. They are not
portable recovery images for another unit or firmware build.

### Patch And Root

Follow [official Magisk installation](https://topjohnwu.github.io/Magisk/install.html).
Install the verified official Magisk APK, copy the backed-up stock boot image
to Downloads, and use **Select and Patch a File on the same tablet**. Preserve
force encryption. Pull the output back and compare tablet/host SHA-256 and
partition size. Magisk's `magiskboot cpio ramdisk.cpio test` returned `1` for
the validated patched ramdisk here. Never flash a partial transfer or someone
else's patched image.

Prepare all images before entering Linux fastboot with USB attached to WSL:

```sh
fastboot -s "$SERIAL" getvar product
fastboot -s "$SERIAL" getvar unlocked
fastboot -s "$SERIAL" flashing unlock
```

Confirm the physical unlock prompt and require `unlocked: yes` afterward.
**Unlocking can erase local data, accounts, alarms, and pairing.** If it
automatically reboots, return to fastboot before the next commands.

```sh
fastboot -s "$SERIAL" flash boot /path/to/this-tablets-magisk-patched.img
fastboot -s "$SERIAL" --disable-verity flash vbmeta /path/to/this-tablets-vbmeta-stock.img
fastboot -s "$SERIAL" reboot
```

The vbmeta write disables dm-verity for physical system-app removal; it does not
rewrite bootloader code or replace Lenovo's system/vendor contents. Root alone
does not make system files writable. This weakens integrity checking: keep
SELinux enforcing and do not relock a modified device.

Plan the approved boot and verity writes in one fastboot visit for a fresh
setup. These individual operations were verified here; that optimized combined
sequence has not been run end-to-end on a second tablet. Avoid reboots between
each app removal. After Android starts, restore debugging authorization, open
Magisk to complete any setup, and check:

```sh
adb_device shell su -c id
adb_device shell getprop ro.boot.veritymode
adb_device shell getenforce
```

Expected: UID 0, verity `disabled` for physical deletion, and SELinux `Enforcing`.
The initial superuser request needs an on-device grant.

### One Recovery Copy And One Cleanup Batch

Before physical deletion on a **new** tablet, obtain an approved stock system
recovery image. With root available, binary-safe Windows `adb.exe exec-out` can
read `/dev/block/by-name/system`; do not send binary data through PowerShell
text output. A small vbmeta read was first compared byte-for-byte with the
MTKClient copy to verify the transport.

This unit's system image is **4,085,252,096 bytes**, SHA-256
`0e3941108615a7a75f71db993e25580d87e6ca313fac72bac744e8f84068c45c`.
The copy took approximately six minutes at 11 MB/s. `e2fsck -fn system-stock.img`
passed all five checks. A new unit requires its own size/hash. Do not repeat
this full backup per app or create extra backups without approval.

Install the replacement browser and Clock before deleting their originals:

```sh
bash scripts/android-tablet-apps.sh install
```

The [cleanup script](../../scripts/android-tablet-debloat.sh) now contains all
**38 approved removal targets**, including the first 17 previously removed
outside the repo. Review the list for each fresh device. It preserves Settings,
the launcher, Google core services, WebView, Bluetooth/audio, Dolby's service,
integrated Lenovo dock components, and charging support. Standalone Alexa and
the Dolby UI were removed by request; Dolby restoration was cancelled.

Transfer the script with `adb push`, restore mode `0700` after each upload, and
run its read-only preflight before the actual removal:

```sh
adb_device shell chmod 700 /data/local/tmp/android-tablet-debloat.sh
adb_device shell 'su -mm -c "/system/bin/sh /data/local/tmp/android-tablet-debloat.sh --check"'
adb_device shell su -mm -c /data/local/tmp/android-tablet-debloat.sh
```

Windows ADB needs the local push source converted with `wslpath -w`. The script
checks device/build/path identity, removes factory and matching update APK
directories, and unregisters packages. `pm uninstall --user 0` here is **in
addition to physical APK deletion**, not user-only removal that leaves system
APKs behind. No disabling, backup, or reboot is performed. Missing apps are
skipped; unexpected paths stop the run. The old Clock screensaver is migrated
to the open-source replacement.

Verify package and APK absence, retained required services, and
`battery_protected_charge=1`. If read-only remount reports busy, do not force
it or silently reboot. Report actual mount state and perform one final reboot
only with approval.

### Finish Apps And Management

1. Open Termux once to initialize its filesystem, then provision:

  ```sh
  bash scripts/android-tablet-ssh.sh
  bash scripts/android-tablet-wifi-adb.sh
  ```

2. Run `~/.termux/boot/00-sshd` once **inside Termux**, not through Magisk's
  execution context. Verify the SSH host fingerprint before connecting.
3. Use the official Play Store entries in the manifest for Plex/Plexamp and
  WebView. Sign in on the tablet; keep credentials out of scripts/Git. Update
  WebView before relying on modern dashboards. F-Droid updates remain separate.
4. Leave the Home Assistant URL unset until supplied; do not enable kiosk
  lockout without a dashboard and maintenance exit path.
5. Test the local alarm with the screen off before relying on it; it remains a
  fallback until backend alarms are implemented. Test dock audio and actual
  charging cutoff when the HA-200 is available.
6. With approval, reboot once and check a changed boot ID, fresh SSH and ADB
  logins, root, enforcing SELinux, read-only system, apps, and charge protection.
  SSH can become available later than ADB during Android startup.
7. Stop the USBIPD watcher, detach the device, and remove the temporary rule
  using `usbipd policy remove --guid <GUID>` in Administrator PowerShell. The
  original session's rule was verified absent before wrap-up.

The current tablet is already rooted and boot-tested. Routine deployment and
inventory capture must not repeat unlocking, flashing, wiping, or rebooting.

## SSH

Verified bootstrap connection:

```sh
ssh -i ~/.ssh/id_ed25519_owl_ansible -p 8022 d0ntblink@10.0.10.166
```

The current address is a DHCP address, not a configured reservation. The tested
ED25519 host-key fingerprint is
`SHA256:9jVoF/iIFJNMWIo6fYOn7TTURArOUvTz98SJeNAdKxk`.

The configured SSH login name is `d0ntblink`, verified on 2026-10-14. Termux maps
the login to its existing Android app identity, currently `u0_a165` (UID 10165);
this does not create or rename an Android account. Other accepted login names
are not revoked by this alias change.

SSH uses public-key authentication only, runs as the Termux app UID, and accepts
users only from `10.0.10.0/24` and `10.0.20.0/24`. Root is a separate Magisk `su`
action. TCP forwarding, agent forwarding, and direct root login are disabled.
Other VPN source subnets require an explicit configuration update.

Termux:Boot invokes `~/.termux/boot/00-sshd`. Termux is exempted from battery
optimization. The managed daemon uses `owl-tablet-sshd.pid`, separate from a
diagnostic listener. On 2026-10-14, both a targeted boot-receiver test and a
subsequent approved software reboot passed: SSH started in Termux's normal app
sandbox and accepted the authorized key. A power-loss cold start and startup
before the first device unlock remain separate, untested cases.

For diagnostics, use a separate port **and PID file** in a separate Termux
session; leave unrelated user programs running:

```sh
sshd -D -e -f ~/.ssh/sshd_config -p 8023 -o PidFile="$PREFIX/var/run/owl-ssh-debug.pid"
```

Stop the diagnostic listener when finished. Its host key should match the
normal server; verify it rather than disabling host-key checking.

## Persistent Wi-Fi ADB

Explicitly requested on 2026-10-14. `start-wifi-adb.sh` is deployed by
`scripts/android-tablet-wifi-adb.sh` to Magisk's
`/data/adb/service.d/90-owl-wifi-adb.sh`, owned by root with mode `0700`.
It sets `persist.adb.tcp.port=5555` and ensures the current ADB daemon uses that
port. Repeated execution leaves an already-running TCP listener undisturbed.
It requires `ro.adb.secure=1`; host-key authorization is not disabled.

```sh
adb connect 10.0.10.166:5555
```

For the existing Windows ADB server, include `-P 5038`. The IP is still DHCP and
may change. Android 10's legacy TCP ADB transport is unencrypted and reachable
from networks that can route to the tablet; the SSH `AllowUsers` restriction
does not restrict ADB. Keep it on trusted networks and do not forward this port
from the internet. This is a boot-time configuration, not a watchdog for later
manual changes to debugging. Automatic return on port 5555, with authorization
still required, was verified after the approved reboot on 2026-10-14. The tablet
must still be powered on and reachable on the network.

To turn persistence off later, remove this boot script and clear
`persist.adb.tcp.port` with root access, then use `adb usb` to stop the live TCP
listener. Clearing only the live port would be undone by the boot script.

## Pitfalls Already Resolved

| Symptom | Cause / proven correction |
|---------|---------------------------|
| File stuck at 0%, partial 65 KB image | WSL USB transport dropped; use Windows-native ADB on 5038 and verify size/hash |
| Windows ADB sees no tablet with a healthy driver | Default port can reach WSL's Linux server; use a distinct Windows server port |
| USB visible but fastboot cannot connect | `Shared` is not WSL `Attached`; Android and bootloader USB IDs differ |
| Matching firmware archive unavailable | Supported MediaTek readback produced this tablet's exact stock images |
| Root works but system APK deletion fails | Root alone does not disable dm-verity or change a read-only system mount |
| Empty package name in removal loop | Android mksh treats an unescaped pipe as alternation; escape the separator in shell parameter expansion |
| Uploaded script cannot execute | Restore `chmod 700` after `adb push` resets its mode |
| Installer stops after the first app | ADB consumed the manifest loop's stdin; the wrapper redirects stdin from `/dev/null` |
| Package DNS fails under the Termux UID | The root-launched process lacked Android's `inet` group; use its UID and internet group while dropping capabilities |
| Existing Kerberos library reported missing | Magisk-created files lacked Termux's SELinux categories; restore labels with `restorecon -RF /data/data/com.termux` |
| SSH works only when started under Magisk | Test from the normal app sandbox; the provisioner now repairs labels and does not launch the daemon in Magisk's context |
| Startup silently skips normal SSH | A diagnostic daemon shared the PID file; use separate managed/diagnostic PID files and check the executable |
| Busy read-only remount | Unregister deleted packages; report mount state and defer any required reboot until approved |

Do not disable SELinux, weaken SSH authentication, relock modified firmware,
or reinstall packages blindly when their labels are wrong. After an interrupted
tool response, check actual state before repeating a mutation. A shell syntax
check alone is not enough: validate device scripts in Android's actual shell.

## Execution Record

- **2026-10-13:** stock images read through MTKClient; boot patched on the same
  tablet using Magisk 30.7; bootloader unlocked with approval; patched boot and
  stock-derived verity metadata flashed. Lenovo firmware/system retained.
- **2026-10-13:** 38 nonessential apps physically removed. The repository script
  now consolidates the batches for future single-pass use. Integrated dock,
  audio and charging services retained. No additional backups or unapproved
  reboots were performed after the user restricted those operations.
- **2026-10-13:** F-Droid, Termux/Boot, kiFOSSk, Clock, FOSS Browser, Jellyfin and
  Finamp installed from verified APKs. Google Play updated WebView and installed
  Plexamp. Subsequent inventory supersedes this installation history.
- **2026-10-14:** corrected Termux SELinux labels and SSH PID handling; verified
  normal-sandbox key login and optional root escalation. Enabled persistent
  Wi-Fi ADB at the user's request. An approved reboot verified both management
  services, root, enforcing SELinux, read-only system and charging preference.
- **2026-10-14:** verified SSH alias `d0ntblink` and saved the 181-package log.
  Material Files is present; Plex video and Jellyfin video are currently absent.

## Remaining Setup

- Supply the Home Assistant URL, choose kiosk behavior, and sign into the media
  services on the tablet; no backend URL or credentials are stored here.
- Test an audible alarm with the screen off, and HA-200 audio/charging cutoff.
- Confirm the intended per-network MAC and create a DHCP reservation if wanted;
  disabling randomization was attempted but not verified successful.
- Validate and lock the host Nix flake. Its shell is not a full declarative
  Android OS/app-data manager.
- Decide whether to reconcile the desired app manifest with the live snapshot;
  do not automatically undo later user app choices.