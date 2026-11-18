# IoT Wi-Fi UI Setup And Maintenance

Manage IoT Wi-Fi at **https://gwn.owl.red** using the **GWN Manager** login.
`owl-red-iot` is enabled on the existing AP with the seven-account PPSK group.
All seven devices have been moved according to the user. The obsolete
`owl.red-iot-local` and `owl.red-iot-cloud` profiles are deleted; private and
guest profiles are unchanged. The mixed-VLAN DHCP fault was resolved by the AP
firmware update; see **Firmware And Acceptance** below and
[Decision 024](../decisions/024-single-ssid-iot-ppsk.md).

## Settings

| Setting | Value |
|---------|-------|
| SSID / PPSK group | `owl-red-iot` |
| Client IP assignment | Bridge |
| Default VLAN | 40, local-only |
| Bands | 2.4 GHz and 5 GHz |
| Security | PPSK without RADIUS; WPA2/AES |
| Client isolation | Enabled, Radio mode; no Custom MAC exemptions |
| Captive portal / MAC-Based RADIUS / Multi-VLAN | Off |
| Access point | Existing GWN7660E |

All accounts use the same **two-word passphrase with one space**, stored as
`owl-red-wifi-iot` in both Bitwarden Password Manager and Secrets Manager.
Each account has a one-client limit, its device MAC binding and an explicit
VLAN. Shared passwords lose independent per-device credential rotation;
MAC addresses can be spoofed and are not strong device identity.

## Device Accounts

| PPSK account | Device MAC | VLAN | Migration / policy |
|--------------|------------|------|--------------------|
| `canon-printer` | `20:0b:74:a5:15:05` | 40 | Moved; local printing |
| `bambu-a1` | `80:65:99:a1:5f:9c` | 40 | Moved; LAN-only operation |
| `camera-foyer` | `02:7f:f6:05:40:fc` | 40 | Migrated; `10.0.40.12` |
| `camera-office` | `02:2d:1f:56:ee:b8` | 40 | Migrated; `10.0.40.13` |
| `merkury-outdoor-plug` | `a0:92:08:50:a5:e4` | 50 | Moved; user-selected internet assignment; LocalTuya unverified |
| `ecobee` | `44:61:32:08:d6:2c` | 50 | Fresh DHCP and public-service session verified |
| `typhur-air-fryer` | `90:70:69:8e:a1:70` | 50 | Moved; absent from post-upgrade client list; recheck when associated |

The Merkury plug is SKU `1DZ64X306MHR`; offline vendor-app and LocalTuya
operation remain unverified.

For future device setup, select `owl-red-iot` and enter
the phrase from `owl-red-wifi-iot`. GWN cannot push saved Wi-Fi credentials to
those devices. Do not factory-reset appliances just to change Wi-Fi. If app
onboarding needs internet or local phone access, qualify a temporary path
instead of disabling isolation globally.

## Tracked Import CSV

The complete CSV is versioned as
[iot-wifi.csv.vault](../../ansible/vars/iot-wifi.csv.vault), encrypted with
Ansible Vault AES-256. Its separate random encryption key is the hidden
`import_csv_vault_password` field on the Bitwarden Password Manager item
`owl-red-wifi-iot`. The two-word Wi-Fi phrase is not the encryption key.

Requirements: Node.js 24, Python 3, the repository's `.venv/bin/ansible-vault`,
the existing Bitwarden CLI 2026.7.0/profile, and `BW_SECRET` in ignored
`env.secret`. See [controller setup](controller-setup.md).

From the repository root:

```bash
node scripts/iot-wifi-csv.mjs export
```

This writes the usable CSV to the ignored
`ansible/artifacts/iot-wifi/owl-red-iot-import.csv`. Upload it through
**Add PPSK > Import** for new accounts. For existing accounts, edit them in
the UI rather than reimporting duplicates. The exact column order is:

```csv
Account Name,Wi-Fi Password,Max Num of Access Clients,MAC,VLAN,Upload Limit (Kbps),Download Limit (Kbps),Email
```

Do not add a Bandwidth Control column. After editing the local CSV, update both
vault stores if the phrase changed, then regenerate the encrypted file:

```bash
node scripts/iot-wifi-csv.mjs seal
```

Only the encrypted file belongs in Git. Neither command changes GWN settings
or automatically synchronizes Password Manager with Secrets Manager.

## Ownership And Checks

The [Wi-Fi policy](../../ansible/vars/wifi-networks.yml) retains separate routed
VLAN 40/50 policies but marks their shared SSID `gwn-manager-ui` owned. The GWN
API reconciler skips them, preventing shared-PSK overwrites or recreation of
the old IoT SSIDs. Private and guest reconciliation are unchanged. DHCP/DNS
remain Technitium-owned; firewall policy remains VyOS-owned.

After device onboarding or a VLAN change, verify MAC/SSID/VLAN in Manager,
`10.0.40.x` or `10.0.50.x` DHCP addressing, local functions and the intended WAN
policy. Test peer blocking on the same band and across bands; a checkbox is
not packet proof. The two migrated cameras passed gateway reachability, local
HTTP positive controls, bidirectional same-band peer HTTP/ICMP denial and WAN
HTTP denial. Fresh DHCP was observed on both VLANs after the firmware update;
cross-band isolation remains untested.
GWN client history can retain the previous SSID; camera-native association
readback is the stronger evidence for those moves. Do not globally disable
isolation for onboarding. Existing
private/guest SSIDs and management networking are outside this workflow.

## Firmware And Acceptance

Use the approved GWN7660E firmware reference in the
[AP manifest](../../ansible/vars/gwn-manager.json), currently 1.0.27.20. Version
1.0.25.34 failed fresh DHCP on a non-common PPSK VLAN. Changing the common VLAN
only moved the failure; changing DHCP/firewall policy was not the solution.

The upgrade restored fresh leases on both VLANs while common VLAN 40,
passwords, explicit account VLANs and isolation stayed unchanged. Ecobee's
VLAN 50 public-service connection and both cameras' local-only policy passed.
Typhur and Merkury were not associated during final inspection; verify their
addresses and functions when they reconnect. Do not infer current addresses
from retained leases or stale controller client history.

For firmware work, retain wired management, private configuration preimages
and a verified model-specific image. Use the versioned HTTPS image path and
check the AP's actual running version afterward; a successful schedule alone
does not prove an upgrade. Firmware security-version changes may prevent a
simple downgrade. No failed forwarding experiment is retained in production.

## Later Maintenance

| Task | UI action and follow-through |
|------|------------------------------|
| Add a device | Add an account with the shared phrase, one-client limit, verified MAC binding and VLAN 40 by default. Update the inventory, local CSV and encrypted copy. |
| Allow internet | Change only that device's PPSK VLAN to 50 after reviewing the need. Reconnect it so VLAN/DHCP state updates; align any reservation/DNS changes through Technitium IaC, not Manager DHCP. |
| Remove internet | Change its key's VLAN to 40 and reconnect. Verify old cloud-VLAN connectivity no longer works; saved UI settings alone do not revoke an existing session. |
| Rotate shared phrase | Update both Bitwarden stores, all PPSK accounts and the private CSV, then reconnect all affected devices. Verify the old phrase no longer authenticates; a shared phrase loses independent per-device password rotation. |
| Replace a device | Revoke the old account and add the replacement's verified MAC. Update inventory, allocation source and both CSV forms. |
| Remove a device | Remove/revoke its PPSK and disconnect any existing session using the available client control. Check it cannot rejoin; retire its DHCP/DNS allocation through the owning IaC lane. |
| Firmware/controller update | Take a private backup, review model/version support and qualify PPSK VLANs and isolation afterward. Do not combine upgrades with bulk VLAN changes. |
| Backup/recovery | Use the controller's supported backup/export UI. Treat PPSK exports as secrets; store protected copies outside Git. Restore testing is a separate maintenance operation. |

Guest session length and consent remain openNDS-owned, separate from this guide.