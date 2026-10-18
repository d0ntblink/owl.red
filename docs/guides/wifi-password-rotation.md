# Rotate A Wi-Fi Password

Bitwarden Password Manager is the password authority. Ansible/native UCI applies
the desired value to the OpenWrt AP through the versioned controller entry point.
Editing Bitwarden alone does not change the AP. Do not edit the key in LuCI or
put it in Git, a command argument, a temporary script or chat.

## Select The Correct Item

| Wi-Fi network | Bitwarden item | Effect |
|---------------|----------------|--------|
| `owl.red` | `owl-red-wifi-private` | Private Wi-Fi on both bands |
| `owl.red-iot-local` | `owl-red-wifi-iot-local` | Local-only IoT, VLAN 40 |
| `owl.red-iot-cloud` | `owl-red-wifi-iot-cloud` | Internet-enabled IoT, VLAN 50 |
| `silence of the lans` | `owl-red-wifi-guest` | Stored guest key; changing it does not enable guest Wi-Fi |

Change the item's **Password** field, not its name, username or notes. Save it
and let the Bitwarden application sync. Prefer a generated printable-ASCII
passphrase of 20 or more characters; the current workflow accepts 8-63 UTF-8
bytes and refuses newline/NUL characters. Keep local/cloud IoT keys distinct.

## Prerequisites

- Use the existing controller from the repository root, with Node.js 24 on PATH
  or set `NODE` to that executable. Node 18 cannot run this entry point.
- Follow [controller setup](controller-setup.md): existing Ansible venv,
  requests/urllib3, private Bitwarden CLI profile, SSH/sshpass and credential file.
- Keep wired management at `https://10.0.10.40` available. Wireless reload can
  briefly disconnect clients; do not depend solely on the SSID being rotated.
- Leave the AP profile/templates unchanged for a password-only operation.

No firmware update, package installation, switch change or new daemon is needed.
Do not rerun `bootstrap` for an ordinary password rotation.

## Apply Through IaC

1. Create a fresh private recovery directory and read the live preimage:

   ```bash
   cd ~/owl.red
   NODE="${NODE:-node}"
   "$NODE" --input-type=module -e 'import { parseEnv } from "node:util";'
   umask 077
   RECOVERY="$(mktemp -d "$HOME/.local/state/owl-red/openwrt-rebuild-rotate-XXXXXX")"
   "$NODE" scripts/openwrt-run.mjs inspect "$RECOVERY"
   "$NODE" scripts/openwrt-run.mjs plan "$RECOVERY"
   ```

   Every invocation unlocks the existing private CLI profile, runs `bw sync`
   and reads the referenced items. Keys remain in child-process input/private
   controller files and are redacted from Ansible output. The default endpoint
   is the permanent wired AP address, not the retired `10.10.20.1` address.

   Expect only the `wireless` package to change. Stop if other packages change
   or the profile/templates contain unrelated pending edits. A no-change plan
   means the AP already matches the vault; no apply is needed.

2. Run the guarded trial and verification, then confirm only on success:

   ```bash
   OPENWRT_APPLY_ALLOWED=true "$NODE" scripts/openwrt-run.mjs trial "$RECOVERY" &&
   "$NODE" scripts/openwrt-run.mjs verify "$RECOVERY" &&
   OPENWRT_APPLY_ALLOWED=true "$NODE" scripts/openwrt-run.mjs confirm "$RECOVERY" &&
   OPENWRT_APPLY_ALLOWED=true "$NODE" scripts/openwrt-run.mjs finish "$RECOVERY" &&
   "$NODE" scripts/openwrt-run.mjs plan "$RECOVERY"
   ```

   `trial` stages native UCI changes under a five-minute rollback window and
   reconciles actual SSID bridge attachments. `verify` requires exact desired
   configuration, wired management, enabled radios/SSIDs and the correct kernel
   bridge membership. `confirm` accepts the transaction. `finish` enforces the
   no-local-DNS/DHCP/portal/routing service state. The last plan should report
   `changed=0` and no changed packages.

3. Update one IoT device to the new key and confirm it reconnects to the intended
   network and receives that VLAN's lease. Then update the remaining devices.
   AP read-back is not proof that every device has received its new credential.
   Local-only IoT intentionally has no internet access.

## Failure Or Rollback

If verification fails, do not run `confirm`. The unconfirmed native transaction
is designed to revert after its timer. While the transaction is still pending
and management is reachable, request the explicit native rollback with:

```bash
OPENWRT_APPLY_ALLOWED=true "$NODE" scripts/openwrt-run.mjs rollback "$RECOVERY"
```

Inspect the actual endpoint/state before retrying; a timeout is not proof that a
change succeeded or rolled back. Bitwarden still holds the new desired key after
an AP rollback. Resolve the failure and use a fresh recovery directory for a new
attempt rather than reverting the vault blindly or resetting the AP.

Recovery directories can contain Wi-Fi keys, native session identifiers and full
configuration preimages. Keep them owner-only and outside Git; do not print or
share their contents.

## Recorded Rotation

On 2026-10-17, the refreshed vault changed only `iot_cloud_radio0.key` for
`owl.red-iot-cloud`. The timed trial, runtime verification, confirmation and
finish passed; the final plan was unchanged. Private and local-IoT keys, VLANs,
SSIDs, radio power and Ethernet settings were preserved. Private evidence:
`~/.local/state/owl-red/openwrt-rebuild-rotate-7j4vud`.