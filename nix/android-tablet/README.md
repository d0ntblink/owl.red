# Bedside Android Tablet

Lenovo TB-X606FA, serial `HVA0GSZV`, stock Android 10 build
`TB-X606FA_S300623_230730_BMP`. Magisk root and physical app removal were
bootstrapped before this configuration was added. Keep the Lenovo HA-200 dock,
audio/Bluetooth, Google core services, and 60% charge-protection components.
Physical dock testing is deferred. No reboot or additional backup is authorized.

## Host Deployment

From the repository root, with Nix installed:

```sh
nix develop path:./nix/android-tablet
bash scripts/android-tablet-apps.sh install
bash scripts/android-tablet-ssh.sh
```

The flake is a host tooling shell, not NixOS on Android. Nix was unavailable in
the bootstrap WSL environment, so evaluation and generation of `flake.lock`
remain pending. Do not treat the untested flake as a locked deployment.

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

## SSH

Verified bootstrap connection:

```sh
ssh -i ~/.ssh/id_ed25519_owl_ansible -p 8022 u0_a165@10.0.10.166
```

The current address is a DHCP address, not a configured reservation. The tested
ED25519 host-key fingerprint is
`SHA256:9jVoF/iIFJNMWIo6fYOn7TTURArOUvTz98SJeNAdKxk`.

SSH uses public-key authentication only, runs as the Termux app UID, and accepts
users only from `10.0.10.0/24` and `10.0.20.0/24`. Root is a separate Magisk `su`
action. TCP forwarding, agent forwarding, and direct root login are disabled.
Other VPN source subnets require an explicit configuration update.

Termux:Boot is initialized and the startup script is installed. Boot persistence
has not been tested because reboots are prohibited. Termux is exempted from
battery optimization. Host private keys and media/server credentials do not
belong in this directory or the Nix store.

## Remaining Setup

- Leave the Home Assistant URL unset until supplied; do not enable kiosk lockout.
- Test the open-source Clock before removing the original Clock.
- Update the old system WebView before relying on modern dashboard rendering.
- Sign into Plex/Jellyfin on the tablet when the user is ready.
- Turn off temporary TCP ADB after remote administration is verified.
- Remove temporary USBIPD AutoBind policy
  `1d592795-5aaa-406e-bc27-3ef89fb60a4d` from Administrator PowerShell when USB
  maintenance is finished.