# Home Assistant And IaC

Use this guide to add integrations, organize devices into rooms, create
geographic zones and change HA configuration without conflicting with Fleet.
Open [Home Assistant](https://ha.owl.red) from the administration network or the
authorized workstation. Run controller commands from the `owl.red` repository
root, using the [controller setup](controller-setup.md).

## Terms And Ownership

| Term | Meaning | Example |
|------|---------|---------|
| Integration | Connects HA to a device or service | IPP, ONVIF, HomeKit Device |
| Device | A physical or logical product represented by an integration | Ecobee thermostat |
| Entity | One sensor, control or function | `climate.ecobee` |
| Area | A room or physical grouping inside the home | Office, Foyer |
| Floor | Groups areas by building level | Ground floor |
| Zone | A geographic region used for presence | Home, Work |
| Custom component | Third-party integration code loaded by HA | Bambu Lab |
| Package | A YAML grouping of related configuration | Helpers and automations for a room |

An area is not a geographic zone, VLAN or subnet. Assigning an area or creating
a zone does not move devices between Wi-Fi networks or grant network access.
"Module" usually means an integration, custom component or YAML package here;
choose the matching procedure below.

| Configuration | Owner / Source |
|---------------|----------------|
| Deployment, image pins, ingress, PVC and base YAML | [HA manifest](../../gitops/home-assistant/home-assistant.yaml), reconciled by Fleet |
| Bundle namespace and dependencies | [Fleet configuration](../../gitops/home-assistant/fleet.yaml) |
| Supported device setup inputs, desired device areas and credential references | [Device registry](../../gitops/home-assistant/devices.json) |
| Qualified setup flows | [Device runner](../../scripts/home-assistant-devices.mjs), explicitly run from the controller |
| Home name, location, region and HA URLs | HA core storage, managed through Settings/UI or the supported core API |
| Area definitions, floors, labels, UI zones, dashboards and integration state | HA UI/API, persisted on the retained `/config` PVC |
| UI automations, scripts and scenes | HA-managed files on `/config`; initialized only when missing |
| Recorder database and role | [Shared PostgreSQL registry](../../ansible/vars/postgresql.json) and [PostgreSQL guide](postgresql.md) |
| Passwords, access codes, tokens and pairing PINs | Bitwarden; source contains references, not values |
| Device reservations and DNS | [DHCP registry](../../gitops/technitium/dhcp-reservations.json) and [DNS zone](../../gitops/technitium/zones/owl.red.zone) |

The device registry is not a Fleet controller: pushing a change does not run
the script, pair a device or assign an area. The runner provisions supported
setup flows and reconciles declared device-area assignments; it does not create
area definitions or reconcile all UI options or zones. UI state is persistent, but is not automatically
exported to Git or recreated from this registry after losing `/config`.

HA runs as **Container**, not HA OS. There is no Supervisor/add-on store, HACS,
host networking or general cross-VLAN discovery service. Configuration storage
uses retained SMB; recorder uses a separate NAS-local PostgreSQL database.
See the [bundle reference](../../gitops/home-assistant/README.md) for deployment,
proxy, storage and device-specific credential details.

## Add An Integration Or Device

### Prepare The Device

1. Choose local-only IoT VLAN 40 or internet-connected IoT VLAN 50 according to
   the device's requirements. Follow the [client migration guide](vlan-client-migration.md).
2. Reserve its actual Wi-Fi/interface MAC and publish DNS through the existing
   DNS/DHCP lane. Do not invent an unused IP or change a reservation in HA.
3. Store credentials in Bitwarden. Keep PINs, stream URLs containing passwords
   and API tokens out of source, shell arguments, screenshots and chat.
4. Verify the integration's actual unicast port is reachable from the HA pod.
   A working browser connection from the workstation does not prove HA access.

Do not enable a broad multicast reflector or firewall exception just to make
automatic discovery work. Prefer a supported manual host entry or an explicitly
qualified, device-specific discovery path.

### Use An Existing Runner Flow

The supported integration domains are `ipp`, `onvif`, `bambu_lab` and
`homekit_controller`. The HomeKit bootstrap is specifically restricted to the
known Ecobee; adding another HomeKit device requires extending that code safely.

```bash
node scripts/home-assistant-devices.mjs inspect
node scripts/home-assistant-devices.mjs plan
node scripts/home-assistant-devices.mjs plan canon
node scripts/home-assistant-devices.mjs apply canon
```

The device runner requires Node 22 or newer with native WebSocket support,
`bws` and the existing private controller credentials. Use the configured
controller Node executable if the default `node` is older.

Replace `canon` with an existing registry key: `camera_foyer`, `camera_office`,
`ecobee` or `bambu_a1`. Apply requires exactly one named device. Plans do not
create integrations or initiate pairing; they do authenticate and may read the
configured vault fields. The HA token is referenced by the existing Secrets
Manager entry `homeassitant-iac-long-live-token` (spelling intentional).

To add another IPP printer, merge an entry like this **inside `devices`**, using
its reserved address in place of the placeholder:

```json
{
  "office_printer": {
      "area": "Office",
    "integration": "ipp",
    "host": "<reserved-printer-ip>",
    "port": 631,
    "base_path": "/ipp/print",
    "ssl": false,
    "verify_ssl": false
  }
}
```

This is a template, not a complete replacement registry. Create the `Office`
area in HA before applying it. Confirm the actual IPP
path and TLS support; the example matches the existing Canon's local setup,
not a universal recommendation to disable verification.

```bash
node --check scripts/home-assistant-devices.mjs
node scripts/home-assistant-devices.mjs plan office_printer
node scripts/home-assistant-devices.mjs apply office_printer
node scripts/home-assistant-devices.mjs plan office_printer
```

The final plan should recognize the existing entry and report `changed: false`.
Current matching uses integration-specific entry titles; renaming an entry in
HA may require adapting that matching. A plan proposing an already-configured
device is a reason to inspect, not delete or re-pair it.

ONVIF needs its own credential reference, name and MAC for matching. Do not
assume its password equals SSH/web credentials. Bambu needs its LAN serial and
access code, not its cloud password. Ecobee needs its current on-screen HomeKit
code and an active pairing screen. Follow the
[device-specific procedures](../../gitops/home-assistant/README.md#device-integrations).

### Add A New Integration Domain

1. Check the official integration documentation and confirm it supports HA
   Container and the device's local/cloud mode.
2. For a one-off setup, use **Settings > Devices & services > Add integration**.
   Select the integration, enter its host/credentials privately and complete
   any authorization. This creates HA state, not a new IaC implementation.
3. For repeatable provisioning, inspect the installed integration's config flow
   and qualify its actual forms, fields, types, errors and completion result.
4. Extend the runner's allowlist, form transitions, private credential lookup
   and existing-entry matching. Add registry inputs only after that path is
   supported. A domain string alone does not implement a new flow.
5. Validate syntax, run a non-mutating plan, apply one device, verify live
   entities, then repeat the plan to check that no duplicate is proposed.

Use HA's supported config-flow API. Never create integrations by editing
`.storage/core.config_entries`. Do not log complete API responses, vault items,
entity attributes or stream URLs. Form field types matter: the installed Bambu
flow represents numeric inputs as strings because they are text selectors.

### Add Third-Party Code Or A Supporting Service

Third-party components run with HA's access to its config and credentials.
Review the source, license, compatibility and dependencies before installation.
Pin an immutable commit/release and verify the downloaded archive checksum.

The existing Bambu installer in the HA manifest is the pattern: restricted init
container, one owned component directory, retained licensing, file hashes,
idempotent installation and refusal to overwrite unmanaged or modified code.
Its guards deliberately refuse an unreviewed upgrade. Review the upgrade and
recovery procedure rather than deleting its ownership marker to bypass them.

Do not install another component by changing Bambu's installer into an arbitrary
download command. Add a separately scoped, reviewed installer and test it in a
temporary directory in the actual HA image before touching the live component.
Publish its manifest through Fleet and arrange one controlled restart.

An MQTT broker, Zigbee2MQTT or other supporting server is a separate service,
not a Supervisor add-on in this installation. Define its Fleet workload,
persistent state, credentials and narrowly required connectivity, then connect
HA through the relevant integration. Use the
[change guide](changing-owl-red.md) to select its configuration lane.

## Add An Area Or Floor

Create area definitions in HA. Device assignments can then be declared with
the optional `area` field in the device registry.

1. Go to **Settings > Areas, labels & zones** and open **Areas**.
2. Select **Add > Create area**. Choose a room name such as `Office`, an icon,
   and optionally a floor, labels or aliases. Select **Create**.
3. Under **Settings > Devices & services > Devices**, open the physical device,
   select its edit button and set **Area**. Its entities inherit that area.
4. Only when an entity belongs elsewhere, open it under **Entities**, select
   settings, turn off **Use device area**, and choose the override area.
5. Check the area dashboard and any automations targeting that area. Assigning
   a camera's area does not automatically create a camera dashboard card.

Create floors from the same organization page and assign areas to them; devices
belong to areas rather than directly to floors. Use labels for cross-room
groupings such as `security` instead of creating duplicate physical devices.
Keep the foyer camera in Foyer and the office camera in Office, for example.

### Assign Existing Devices From JSON

Set `area` to the exact existing HA area name on each device entry. For example,
use `"area": "Office"` for the printers and office camera. This field is runner
metadata, not a field sent to an integration's setup form.

```bash
node scripts/home-assistant-devices.mjs plan
node scripts/home-assistant-devices.mjs apply canon
node scripts/home-assistant-devices.mjs apply camera_office
node scripts/home-assistant-devices.mjs apply bambu_a1
node scripts/home-assistant-devices.mjs plan
```

Plans report `wouldUpdateArea`; successful repeats report `false`. Apply updates
the existing HA device registry without deleting or re-pairing integrations.
It includes attached child devices in one verified parent tree, such as the
A1's External Spool, and refuses unrelated device roots. Missing or ambiguous
area names are errors; the runner does not silently create rooms.

Omitting `area` leaves the current assignment untouched. Empty values do not
clear it. A declared value takes precedence over a manual device-area change
on the next explicit apply. Per-entity area overrides are preserved and may
still put individual entities elsewhere; check **Use device area** when needed.

Pushing this JSON through Git/Fleet does not execute these commands. There is
no automatic registry reconciliation Job or watcher. After running apply,
refresh the HA dashboard; no HA restart is required for an area assignment.

Deleting an area unassigns its devices and can break automation targets. Review
references first. Area creation/deletion and floor/label reconciliation are not
implemented by the runner. Never hand-edit HA's area/device/entity registry
storage files.

## Add Or Edit A Geographic Zone

1. Go to **Settings > Areas, labels & zones > Zones**.
2. Select **Create zone**, enter a descriptive name, set the location on the map
   or enter coordinates, then set the radius in meters and save.
3. Use **Passive** for a zone used by automations but not as a person's named
   location. Do not use a room-sized zone as a substitute for an area.
4. Check the zone on the map. Presence automations also need a configured person
   or device tracker; creating a zone does not track a phone by itself.

These UI zones are stored by HA on `/config`. Precise coordinates are private
location data; do not put actual home/work coordinates into publicly readable
Git merely to make the configuration declarative.

### The Special Home Zone

`zone.home` is created by HA itself. The missing-unique-ID warning in its entity
dialog is expected, not a broken integration. Do not recreate it or add an
unsupported `unique_id` setting.

- Edit location and radius through **Settings > Areas, labels & zones > Zones > Home**.
- Edit the home name through **Settings > System > General**.
- Check time zone and units separately after moving the location.

Home cannot be deleted or made passive. Keep core home settings in HA storage.
Even setting only `internal_url` or `external_url` under `homeassistant:` in YAML
marks core configuration as YAML-owned in this release and locks the entire
General page, including unrelated name/location/region controls. Do not assume
that omitting latitude and longitude alone keeps the page editable.

Manage both HA URLs under **Settings > System > Network**; retain
`https://ha.owl.red` for this installation. If migrating existing YAML-owned
values, first preserve them through HA's supported `config/core/update` API,
remove the core YAML overrides through Fleet, then restart once and verify
`config_source` is `storage`. Do not edit `.storage/core.config` directly or
replace the existing location with guessed coordinates.

### Deliberately Manage A Zone In YAML

Prefer UI zones unless a specific zone needs version-controlled configuration.
If YAML is required, add `zone:` inside the ConfigMap's `configuration.yaml`
literal block in the HA manifest, **not** as a Kubernetes manifest field.
This fictional example uses placeholder coordinates and must be adapted before
deployment:

```yaml
zone:
  - name: Example site
    latitude: 0.0
    longitude: 0.0
    radius: 150
    icon: mdi:office-building
```

A YAML zone is not editable through the Zones UI. Do not define the same place
in both UI storage and YAML. Use the deployment procedure below; the read-only
ConfigMap mount is not updated by a UI zone reload alone.

## Add A YAML Package

Packages group related helpers, automations and other YAML-supported
integration configuration. They do not install Python integrations, add-ons,
areas or network services. No package-directory include is currently enabled.

For a small package, add this inside the manifest's `configuration.yaml`.
If a `homeassistant:` mapping already exists, merge `packages` into it rather
than creating a duplicate key:

```yaml
homeassistant:
   packages:
      guest_controls:
         input_boolean:
            guest_mode:
               name: Guest mode
               icon: mdi:account-group
```

Do not reintroduce URL, name, location or region overrides alongside the package:
those core settings must remain UI/storage-owned. This example creates a YAML-owned
helper; avoid also creating a UI helper for the same purpose. Integrations in
a package must actually support YAML configuration.

For larger packages, first define how Git files reach the container: ConfigMap
keys and read-only mounts, then a matching include path. Adding a file somewhere
under `gitops/` does not make it visible under `/config`. Do not overwrite
HA-managed automation/script/scene files as a side effect of packaging.

## Validate And Deploy An IaC Change

1. Review only the relevant source diff. Validate YAML structure and any changed
   runner with `node --check`; a generic YAML parser does not validate HA's
   integration schemas or custom `!include`/`!env_var` tags.
2. Check prospective HA YAML with the pinned HA image against an isolated
   configuration when practical. Do not start a second HA instance against the
   live config volume or recorder database. Test installers in temporary paths.
3. For Kubernetes changes, server-dry-run the complete intended resources. Never
   send a partial ConfigMap under Fleet's field manager: omitted owned fields
   can be pruned. Do not print rendered Secrets in validation output.
4. Publish only the reviewed scope when authorized and let Fleet reconcile.
   Wait for the intended Deployment/ConfigMap revision, not just a Git fetch or
   a stale Ready result. Pure UI area/zone changes do not need a Git deployment.
5. A changed Deployment template rolls itself. A ConfigMap-only change or changed
   environment Secret requires a controlled rollout after reconciliation:

```bash
kubectl -n home-assistant rollout restart deployment/home-assistant
kubectl -n home-assistant rollout status deployment/home-assistant --timeout=240s
```

Do not restart twice when a Deployment change already rolled the intended
revision. The read-only base YAML uses a `subPath` mount, so editing source or
reloading integrations is not a substitute for loading the updated pod config.

Verify the touched integration is loaded and a representative entity reports
live data. Repeat the relevant device plan. Use harmless observation rather
than printing a test job, moving cameras, changing HVAC settings or starting a
3D print as a generic connectivity test.

On failure, preserve the existing config PVC, recorder and pairing keys. Roll
back the reviewed manifest or affected UI setting through its owning lane;
don't wipe `/config`, reset HomeKit or delete the shared PostgreSQL cluster.
Retained storage is not a backup. Restoring UI registries and pairing state
needs a matching private config backup, not just Git and recorder history;
the broader [power and recovery work](power-and-recovery.md) remains separate.

## References

- [HA bundle and device procedures](../../gitops/home-assistant/README.md)
- [Wi-Fi password rotation](wifi-password-rotation.md)
- [Thingino camera management](thingino-cameras.md)
- [Bitwarden credential flow](bitwarden-secrets-flow.md)
- [Official areas documentation](https://www.home-assistant.io/docs/organizing/areas/)
- [Official zones documentation](https://www.home-assistant.io/integrations/zone/)
- [Official packages documentation](https://www.home-assistant.io/docs/configuration/packages/)