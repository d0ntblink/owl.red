# Home Assistant

Home Assistant Container runs through Fleet at `https://ha.owl.red`, with one
replica and a Recreate update strategy. It is not Home Assistant OS: Supervisor
and its add-on store are not included. Supporting services are separate workloads.

For adding integrations/modules, areas, zones and YAML packages, use the
[Home Assistant and IaC guide](../../docs/guides/home-assistant.md).

## Storage

- The retained `config` PVC uses `nas-appdata-smb` and only its own generated
  directory. The workload runs as `1001:100`; no existing appdata permissions
  are changed. The requested size is not an enforced SMB quota.
- Recorder uses its own database and login in the NAS's [shared PostgreSQL
  service](../../docs/guides/postgresql.md), displayed as `postgresql` on the NAS.
  The general service name and PostgreSQL icon do not change HA's credentials.
  Its bind mount is `/mnt/ssd/appdata/home-assistant-db/data`, directly on local
  SSD storage, never through SMB. Its separate application role is not a superuser.
- PostgreSQL listens on the NAS management address, TCP 15432, using SCRAM
  authentication. Database traffic currently uses the private management network,
  not TLS; never expose that port to the internet or untrusted networks.
- `configuration.yaml` is Git-managed and mounted read-only. UI onboarding,
  integration state, automations, scripts and scenes remain on the config PVC.
  The initializer creates missing YAML files only; it never replaces existing ones.

Home name, location, region and internal/external URLs remain in HA's own core
storage, editable through its settings pages. Do not put the URL fields back
under `homeassistant:` in base YAML: this HA release treats that as YAML ownership
of the whole General page and disables otherwise unrelated controls. Both URLs
remain `https://ha.owl.red`; these core settings are separate from ingress and
the Git-managed HTTP proxy configuration below.

HTTP proxy settings live in the ConfigMap's `http.yaml`. Before HA starts, the
`configure-http` initializer uses HA's own storage API to migrate and confirm
them as stable settings. This release migrates HTTP YAML only once and otherwise
ignores later YAML changes; an unconfirmed pending trial reverts after five
minutes. Keep HTTP settings in this Git-managed initializer rather than adding
an ignored `http` block back to `configuration.yaml`. The initializer touches
only HTTP configuration, not authentication or recorder storage.

SMB configuration plus a separate recorder does not make the NAS redundant.
Retained storage is not a backup. Cloud/rclone backups and power work remain
deferred; existing NAS applications and production media are not migrated here.

## Recorder Management

The [shared application registry](../../ansible/vars/postgresql.json) preserves
HA's database and credential references. Use the shared runner from the
repository root:

```bash
node scripts/postgresql-run.mjs --apply
```

HA retains these three Bitwarden entries; new applications use separate entries:

- `home-assistant__postgres__admin-password`
- `k8s__home-assistant__recorder__password`
- `k8s__home-assistant__recorder__db-url`

It rejects duplicate keys or mismatched existing values rather than rotating
credentials. SDK authentication runs in a captured child with verified Error
logging; private values enter Ansible only through its child environment and
secret-bearing tasks use `no_log`. Never run the SDK worker directly or enable
verbose credential logging. Failed output is retained only in owner-only
controller state outside Git.

The Docker API is reached through a temporary, owner-only SSH-forwarded Unix
socket; no TCP Docker API is enabled. Only the named shared container and its
marked directory are managed. Do not recreate it through an unrelated Unraid
template or remove its local data during an image upgrade.

Controller requirements: Node 20.12+; the existing Ansible/OpenSSH environment;
`community.docker` 5.2.0, `community.postgresql` 4.2.0 and controller Python
`psycopg[binary]` 3.3.6; official `@bitwarden/sdk-napi` 1.0.0 at the controller's
private tool prefix. The NAS needs Docker, the existing pinned SSH key and its
mounted SSD pool; this lane does not install NAS Python or manage array settings.
Images are digest-pinned. Changing a database major version requires a separate
migration procedure, not a tag replacement against the same data directory.

## Initial Onboarding

Fleet declares the namespace and recorder Secret mapping through the existing
Bitwarden bundle. Once the namespace exists, bootstrap its private operator
token without putting it in a manifest or overwriting an existing token:

```bash
node scripts/postgresql-run.mjs --apply --bootstrap-kubernetes --application homeassistant
```

Initial ingress is limited to `10.0.10.0/24` and the administration workstation
at `10.0.20.10/32`. Open `https://ha.owl.red` from that path and create the owner
account yourself; account passwords and integration credentials do not belong
in chat or Git. User accounts are not pre-created by deployment automation.

The container uses ordinary pod networking, with no host network, USB/Bluetooth
mapping or new inter-VLAN firewall permissions. Device-specific discovery,
thermostat/printer setup and any broader client access remain separate work.
The HTTP proxy trusts the cluster pod CIDR for Traefik headers; this is not a
multi-tenant security boundary.

ConfigMap and environment-Secret changes require a controlled restart to be
loaded. Keep one active writer during updates; never start a parallel Home
Assistant instance against the same config volume or recorder database.

## Device Integrations

[devices.json](devices.json) declares the qualified Canon IPP, two Thingino ONVIF,
Ecobee HomeKit, Bambu A1 LAN and built-in OpenWrt LuCI setup inputs. Use the repository-root runner:

```bash
node scripts/home-assistant-devices.mjs inspect
node scripts/home-assistant-devices.mjs plan
node scripts/home-assistant-devices.mjs apply canon
node scripts/home-assistant-devices.mjs apply camera_foyer
node scripts/home-assistant-devices.mjs apply camera_office
node scripts/home-assistant-devices.mjs apply ecobee
node scripts/home-assistant-devices.mjs apply bambu_a1
node scripts/home-assistant-devices.mjs apply openwrt
```

The API token is read from Secrets Manager's existing
`homeassitant-iac-long-live-token` entry. Source contains credential UUIDs only.
Plans do not create integration entries; apply requires exactly one named
device, checks for an existing entry and cleans up incomplete setup flows.
Existing entries are not deleted or overwritten. This manages supported setup
flows, not every option subsequently editable in HA.

An optional `area` on a device names an existing HA area exactly. Plan reports
assignment drift; apply updates the existing device and its attached children
without re-pairing. Area creation and per-entity overrides remain HA-managed.
Pushing JSON does not run the script: explicitly run plan and apply from the
controller after a change. The runner requires Node 22+ with native WebSocket
support. See the [area procedure](../../docs/guides/home-assistant.md#assign-existing-devices-from-json).

ONVIF uses port 80 and per-camera Secrets Manager entries
`home-assistant__camera-foyer__onvif` and
`home-assistant__camera-office__onvif`, each containing a private JSON object
with `username` and `password`. These preserve the cameras' native ONVIF
credentials, which are different from their SSH/web login. Do not rotate the
camera password merely to make these accounts match. Snapshot retrieval does
not qualify PTZ, audio, every advertised switch or continuous recording.
Canon's IPP sensors do not replace an actual printing test.

### Built-In OpenWrt

OpenWrt uses HA's built-in **OpenWrt (LuCI)** integration (`luci`) over
`https://ap.owl.red`, with both SSL and certificate verification enabled. It
provides client-presence trackers, not AP CPU/RAM graphs or Wi-Fi controls.
It uses the existing AP administrator item in Bitwarden Password Manager;
HA stores that credential in its protected configuration. This is admin access,
not a read-only monitoring account. No custom HA integration or SSH sensor is used.

Provision its approved AP prerequisites from the controller:

```bash
node scripts/openwrt-luci-run.mjs plan
node scripts/openwrt-luci-run.mjs apply
node scripts/home-assistant-devices.mjs plan openwrt
node scripts/home-assistant-devices.mjs apply openwrt
```

The prerequisite runner installs official `luci-mod-rpc`, uses Technitium
`10.0.10.30` for the AP's own DNS and deploys the `openwrt-luci-tls` Secret to
owned AP TLS paths. It reloads only uhttpd when the certificate changes; it
does not reload networking or Wi-Fi. The AP-only finish task also maintains a
direct resolver, because stopping local dnsmasq otherwise leaves localhost
nameservers that cannot answer package/ACME queries.

The HA manifest declares Certificate `openwrt-luci` for `ap.owl.red` through
the existing DNS-01 issuer. Certificate/Secret resources must exist before
running the prerequisite command. cert-manager renews the Kubernetes Secret,
but there is **no automatic AP certificate-copy job**: rerun the prerequisite
plan/apply after renewal and before the AP certificate expires. The runner
verifies the certificate/key and updates the existing controller TLS pin only
after HA successfully validates the new HTTPS service. Keep its private
controller/AP recovery records outside Git; never dump Secret contents.

LuCI tracker entities are disabled by default. Enable only the clients you want
under **Settings > Devices & services > OpenWrt (LuCI) > Entities**. Device
coverage depends on what this bridged AP reports; DHCP on Technitium means it
is not a complete network-wide DHCP/presence inventory.

The LuCI integration creates tracker entities, not an AP device with a room.
An `area` value on its registry entry is retained as placement metadata and
reported as not applied. It is never propagated to all tracked clients.
Assign client areas individually where supported.

### Ecobee Local HomeKit

Ecobee uses HA's built-in **HomeKit Device** integration (`homekit_controller`),
not the Ecobee cloud-account integration. Keep it at `10.0.50.10` on
`owl.red-iot-cloud`; HA communication is local and does not require Ecobee MFA.
Before initial pairing, open the thermostat's HomeKit / Add to Home screen and
leave it active. Store its current eight-digit code in Secrets Manager's
`ecobee-homekit-code` entry. The code and service port can change when pairing
mode is reopened, so do not reuse an old displayed code or hard-code its port.

The runner queries the genuine service through the existing pinned router SSH
account on VLAN 50, checks its configured HomeKit ID, model and IPv4 address,
and verifies HA can reach the advertised TCP port. It delivers only those
service records to HA's local mDNS listener for initial discovery. No persistent
multicast relay, firewall exception or host networking is enabled. The bootstrap
requires `kubectl`, existing router SSH access and the running HA pod's DNS
library. Existing paired entries bypass discovery and PIN retrieval.

HA owns the resulting pairing keys on the retained config PVC. Do not reset
HomeKit, remove another controller's pairing or edit HA authentication storage
to recover discovery. Pairing and verification do not change HVAC modes or
setpoints. Never put the HomeKit code in source, shell arguments or chat.

### Bambu LAN Setup

The approved third-party integration is
[greghesp/ha-bambulab](https://github.com/greghesp/ha-bambulab), release `v2.2.26`,
commit `cd67ed90e08561175a831f35b45773fe427996d7`. The manifest's `install-bambu`
initializer verifies the source archive's SHA-256 before installing only
`/config/custom_components/bambu_lab`. It preserves upstream licensing, sets
the release version in its packaged manifest and records owned file hashes.
Repeat runs leave matching files unchanged; unmanaged installations, modified
files and unreviewed version replacements are refused. No HACS is installed.

In the existing **Bambu Lab** Bitwarden Password Manager item, add hidden custom
fields named `printer_serial` and `lan_access_code`, using the A1's own LAN
settings. The cloud account password is not a LAN access code. The runner uses
only these fields, the pinned working Bitwarden CLI `2026.7.0` and its existing
copied profile; it never submits cloud-account credentials for LAN pairing.

Keep the A1 at `10.0.40.11` on `owl.red-iot-local`. Enable its LAN access in the
printer UI if it is not already enabled. Firmware updates remain disabled in
the integration and TLS verification stays enabled. An actual authentication
or certificate failure requires review, not repeated guesses or a silent TLS
bypass. The runner does not reset, update or move the printer to cloud Wi-Fi.

The boot initializer takes effect only after this manifest is published through
Fleet. An installed component persists on the config PVC across restarts;
publishing code is not the same as pairing the printer with its private LAN
fields. Do not apply partial ConfigMap data under Fleet's field manager.