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

## Foyer Network Watchdog Repair

The foyer camera's repeating PTZ homing was a full reboot loop, not just a
Frigate stream reconnect. Two read-only SSH snapshots had different boot IDs.
Its native `S52netwatch` was enabled with target `10.0.10.1`, interval 30
seconds and failure threshold three. That old management gateway did not answer
from the camera's isolated IoT network, while its actual gateway `10.0.40.1`
did. The native watchdog forcibly reboots after those failed checks.

The [health helper](../../scripts/thingino-health.mjs) supports `inspect` and
the narrow `repair-netwatch` operation. It pins the existing SSH identity,
checks the foyer MAC and firmware family, verifies the local gateway answers,
and changes only `netwatch.target` through Thingino's native `jct` tool. It
restarts only the software network-watchdog loop; the hardware watchdog stays
enabled. Wi-Fi credentials, firewall rules, firmware and PTZ settings are not
changed. A full config preimage is private on the camera at
`/etc/owl-red-netwatch-before.json`; it contains private material and must not
be printed or committed. Controller output logs are also private under
`~/.local/state/owl-red/foyer-health-*` and `foyer-diagnostics-*`.

The same boot ID persisted to 412 seconds of uptime after repair while stream
qualification and Frigate setup ran. Both foyer profiles passed native H264 probing and NVIDIA decoding:
main `2560x1440`, substream `768x432`. Frigate previously omitted foyer because
its target was disabled following failed reachability qualification. The
qualified camera was enabled with five-FPS detection, native go2rtc restreams
and existing three-day event retention. The partial enable helper preserves
the office camera and unrelated Frigate settings, with a private preimage on
the NAS. It does not re-home the camera or replace the whole recorder config.
Authenticated runtime metrics then reported both cameras at five camera/process
FPS with zero skipped FPS.

This observed watchdog cause does not rule out every possible power or hardware
fault. If physical rebooting returns, compare boot IDs/uptime first and inspect
the current watchdog target before changing power supplies or disabling safety
mechanisms.

## Matching Watchdogs And Manual PTZ

Office originally had `netwatch.enabled=false` and no explicit target. Both
cameras had the correct DHCP gateway; only foyer had an enabled watchdog pinned
to the old gateway. The Wi-Fi migration verified routing but did not reconcile
that separate native watchdog configuration.

Both now use `enabled=true`, target `10.0.40.1`, interval 30 seconds and failure
threshold three. `node scripts/thingino-health.mjs match-netwatch office` and
the equivalent `foyer` command enforce this narrow profile after checking camera
identity, the current route and gateway reachability. Existing timing values must
already match; unexpected settings require review. The helper saves the private
camera preimage `/etc/owl-red-netwatch-match-before.json` before changes.
`node scripts/thingino-health.mjs inspect office` inspects office without writes;
omitting the camera name defaults to foyer. Neither camera was rebooted.

Both cameras passed authenticated ONVIF profile and configuration-options reads
from Frigate's own runtime. Manual ONVIF is enabled on port 80 using each camera's
existing private credentials, without modifying streams, retention or detector
settings. `node scripts/frigate-run.mjs qualify-ptz` performs read-only capability
checks; `enable-ptz` saves a private preimage and updates only the ONVIF blocks.
`status` verifies authenticated live pan/tilt capabilities for both cameras.
Autotracking and startup calibration remain disabled. No motor commands were
sent during qualification or enablement.

At [Frigate](https://nvr.owl.red), open a camera from **Live**, open its **PTZ**
control panel, then use the direction arrows or preset selector. Refresh the
page if it was open before ONVIF was enabled. Both cameras advertise pan/tilt
and relative movement, with ten presets each, but do not advertise optical zoom.

## Frigate Settings Editor Compatibility

Frigate 0.18.2 accepts JSON-formatted content at startup through its `.yml`
file loader, but its settings editor passes raw text to a different parser path.
JSON-formatted text hits `json.load` with a string and raises
`AttributeError: 'str' object has no attribute 'read'`. This caused the generic
"Error parsing config" response when enabling face recognition.

All recorder config writers now emit block YAML and validate the serialized text
through `FrigateConfig.parse`, not only the decoded object. The narrow
`node scripts/frigate-run.mjs repair-yaml` command preserves all decoded values,
saves a private `config.before-yaml-*.json` preimage, and changes only encoding.
No recorder restart is required and no optional processing feature is enabled.
The installed UI update routine plus raw-text parser passed a small-model face
recognition enablement check on a private temporary copy; live config was not
changed by that check.

## Terraform Assessment

No native Thingino provider was identified in the targeted Terraform registry
search. That is not proof that no third-party implementation exists. This
mutable SSH configuration is better served by the existing Ansible lane with
drift checks and reconnect/rollback handling. A Terraform SSH provisioner would
not itself supply that behavior or a useful camera resource lifecycle, so it
is not introduced as a competing owner.