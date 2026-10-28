# Rotate A Wi-Fi Password

Bitwarden Password Manager is the Wi-Fi password authority. The Grandstream
must reuse the established SSID names and credentials. Editing Bitwarden alone
does not change the AP. The production API runner syncs the vault, reconciles
declared profiles and verifies read-back. Do not treat a vault edit alone as a
successful rotation or a proof that clients have reconnected.

Keep passwords out of Git, command arguments, temporary scripts and chat.

## Select The Correct Item

| Wi-Fi network | Bitwarden item | Effect |
|---------------|----------------|--------|
| `owl.red` | `owl-red-wifi-private` | Private Wi-Fi, VLAN 20; 2.4 / 5 GHz |
| `owl.red-iot-local` | `owl-red-wifi-iot-local` | Local-only IoT, VLAN 40; 2.4 / 5 GHz |
| `owl.red-iot-cloud` | `owl-red-wifi-iot-cloud` | Internet-enabled IoT, VLAN 50; 2.4 / 5 GHz |
| `silence of the lans` | `owl-red-wifi-guest` | Guest Wi-Fi, VLAN 30; 2.4 / 5 GHz; portal consent remains separate |

Change the item's **Password** field, not its name, username or notes. Save it
and let the Bitwarden application sync only as part of a reviewed rotation.
Prefer a generated printable-ASCII passphrase of 20 or more characters within
the AP/security mode's supported limits. Keep local/cloud IoT keys distinct.

## Production Apply

Review [Wi-Fi policy](../../ansible/vars/wifi-networks.yml) first: the runner
reconciles all owned fields, not just passwords. Keep policy unchanged for a
key-only rotation, retain wired management and private preimages, and use the
[controller requirements](controller-setup.md#grandstream-ap-scope-and-power).

```bash
node scripts/gwn-manager-run.mjs inspect-production
GWN_MANAGER_APPLY_ALLOWED=true node scripts/gwn-manager-run.mjs apply-production
```

The runner verifies Personal/WPA2/AES, exact private PSK equality, VLAN, bands,
enablement and isolation. Values are not printed. Native backup/restore testing
is a separate outstanding recovery task; do not assume an automatic timed AP
rollback exists.

After the reviewed AP change, verify the intended SSID/VLAN and reconnect one
affected client before proceeding with the rest. AP read-back alone does not
prove that clients have received the new key. Local-only IoT intentionally has
no internet. Guest portal consent is independent of the WPA credential.

If an apply times out, inspect actual state before retrying; do not assume it
succeeded or rolled back. Keep private backups and recovery material owner-only
and outside Git. Do not reset the AP as a routine password-recovery step.