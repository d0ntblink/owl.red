# Thingino Cameras

Ansible owns the two cameras' Wi-Fi client configuration over SSH. Firmware,
video settings, passwords, bootloader and recording data are not managed or
reset by this lane. No Python, agent or additional package is installed on a
camera.

| Camera | Address | Hostname | Wi-Fi |
|--------|---------|----------|-------|
| Foyer | `10.0.40.12` | `wuuk-ptz-foyer.owl.red` | `owl.red-iot-local`, 2.4 GHz |
| Office | `10.0.40.13` | `wuuk-ptz-office.owl.red` | `owl.red-iot-local`, 2.4 GHz |

Both use DHCP reservations, mask `/24`, gateway `10.0.40.1` and DNS
`10.0.40.30`. Their web login pages and TCP 554 listeners were verified after
the move; HA stream authentication, ONVIF support and pairing remain separate
work. Local-IoT internet isolation comes from the existing network policy.
No broad discovery or firewall exception is enabled here.

## Configuration Owner

- [Inventory](../../ansible/inventory/hosts.yml): expected MAC, stable SSH alias,
  desired IP and the old address for initial migration only.
- [Camera group variables](../../ansible/inventory/group_vars/thingino_cameras.yml):
  SSID, allowed 2.4 GHz frequencies, expected AP BSSID, gateway/DNS and vault refs.
- [Playbook](../../ansible/playbooks/thingino-cameras.yml): one camera at a time,
  explicit mutation opt-in, controller delegation and secret-safe reporting.
- [Runner](../../scripts/thingino-run.mjs) and
  [transaction helper](../../scripts/thingino-camera.mjs): vault access, strict
  SSH identity, read/compare/apply/verify and independent local rollback.

The persistent source is `/etc/wpa_supplicant.conf` on Thingino's overlay.
Only its single client network's SSID/PSK fields are reconciled. Native global
settings, device identity material, roaming options and formatting are retained.
The PSK is derived using standard WPA PBKDF2; neither passphrase nor equivalent
PSK is passed in command arguments or printed.

The AP advertises the target SSID on radio0 only. Verification requires the
expected BSSID and an actual association frequency between 2412 and 2462 MHz;
both cameras currently use 2412 MHz/channel 1. A matching SSID name alone is not
accepted as evidence of 2.4 GHz operation. DHCP mode is required, not rewritten.

## Run

From the repository root:

```bash
node scripts/thingino-run.mjs inspect
node scripts/thingino-run.mjs plan
```

The plan prints its private recovery directory. An Ansible changed result in
plan mode is a forecast; it does not modify the camera. To apply, use that
reviewed directory, replacing `thingino-PLAN` below with its actual basename:

```bash
recovery="$HOME/.local/state/owl-red/thingino-PLAN"
THINGINO_APPLY_ALLOWED=true THINGINO_LIMIT=camera_foyer \
  node scripts/thingino-run.mjs apply "$recovery"
node scripts/thingino-run.mjs verify "$recovery"
```

Use `camera_office` for the other device, or omit `THINGINO_LIMIT` for serial
reconciliation of both. Repeat plans should report no drift. Verification can
settle a prior transaction in the supplied recovery directory only after its
saved configuration and live network match; it does not blindly cancel recovery.

The camera saves its original WPA file and an independent cron rollback before
the network restart. Without confirmation, rollback restores that file after
five minutes, plus up to one minute of cron scheduling. The deadline uses
monotonic uptime; a changed boot ID triggers restoration at the next cron run.
Confirmation removes only that transaction's cron entry. Other scheduled jobs
are preserved. Do not remove an active trial directory or its recovery job.

After disconnection, readiness is checked from `edge_pve` before SSH reconnects.
MAC, firmware image family, desired IP/mask, authenticated SSID/BSSID, frequency,
gateway/DNS and web/RTSP listeners must pass before confirmation. Keep the other
camera untouched if any step fails. Preimages and logs contain private network
material and stay owner-only outside Git or in private camera trial directories.

## Controller Access

Use the existing Node 20.12+ and Ansible environment, PyYAML, OpenSSH, `sshpass`
and the pinned controller key for `edge_pve`. Camera commands run through that
native-management jump host; no new SSH firewall rule is required. Camera SSH
host keys are pinned in `~/.local/state/owl-red/thingino-known_hosts` under
stable aliases, so an IP change does not bypass identity checking. New or
changed host keys require an independent identity/fingerprint check.

The runner pins Bitwarden CLI `2026.7.0` and its previously verified private
profile. System CLI `2026.4.1` has the documented
[session regression](bitwarden-secrets-flow.md#known-cli-session-regression);
do not repeat unlock attempts with it. The runner uses the existing private
controller input, captures vault output and supplies camera credentials only
through child environment/stdin with Ansible `no_log`. It does not rotate vault
or Wi-Fi credentials.

## Terraform Assessment

No native Thingino provider was identified in the targeted Terraform registry
search. That is not proof that no third-party implementation exists. This
mutable SSH configuration is better served by the existing Ansible lane with
drift checks and reconnect/rollback handling. A Terraform SSH provisioner would
not itself supply that behavior or a useful camera resource lifecycle, so it
is not introduced as a competing owner.