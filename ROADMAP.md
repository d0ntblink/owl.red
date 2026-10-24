# Roadmap

Unfinished work only. Remove completed items; keep implementation details in
the relevant guides and configuration sources.

## Execution Order

1. Inventory application storage and active writers; qualify permissions and
  database placement without changing existing data.
2. Complete Home Assistant onboarding/integrations and migrate applications in
  small, reversible batches.

<a id="stabilization-gates"></a>

## Deferred Power And Recovery

- [ ] Confirm battery-backed power paths and qualify shutdown ordering/restart
  recovery for the NAS, hypervisors and essential network services without
  unsafe power-loss testing. Keep automatic power actions disabled until qualified.
- [ ] Implement future cloud offsite backups with rclone: select a provider,
  configure encryption and retention, capture application-consistent data and
  verify restores before relying on the copy. Do not treat a destructive sync
  as a versioned backup.
- [ ] Define a PBS datastore and guest recovery path before deploying PBS or
  scheduling protected guest backups.

Reference: [power monitoring and recovery requirements](docs/guides/power-and-recovery.md).

## Shared Storage

- [ ] Inventory and clean shared appdata: identify application directories,
  active writers, obsolete content and retention requirements before changes.
- [ ] Validate each application's permissions, locking and database storage;
  shared SMB storage does not make every database or multi-writer layout safe.
- [ ] Resolve the production-media export constraint before enabling the
  separate Proxmox NFS path. Keep media data, paths and access unchanged.
- [ ] Configure restricted Proxmox shared storage and prove the intended guest
  migration/failover behavior before moving guest disks.
- [ ] Review/import existing root-level ISO files into the Proxmox-visible
  `nas-isos` directories without moving or deleting the originals implicitly.
- [ ] Add backup and scanner service accounts when their consumers and exact
  share permissions are defined; choose a dedicated scanner inbox.

Reference: [storage design and procedures](docs/guides/shared-storage.md).

## Home Assistant And Applications

- [ ] Complete owner onboarding at `https://ha.owl.red` and review the intended
  client access policy before expanding beyond administration sources.
- [ ] Add only the device-specific IoT discovery/service paths needed by Home
  Assistant; keep broad inter-VLAN access and host networking disabled by default.
- [ ] Integrate the thermostat, printers and other selected smart-home devices.
- [ ] Verify Frigate retention cleanup and native UI exports for footage kept
  longer without changing production media or adding a custom camera-SD pipeline.
- [ ] Activate the Open WebUI Fleet bundle and internal DNS, complete owner/API
  onboarding, and verify a WebUI request releases GPU memory without restarting
  persistent Ollama. Review native model presets and the shared-GPU behavior
  alongside Frigate/Plex before accepting broader use.
- [ ] Qualify the deferred Arr/Bazarr SQLite-to-PostgreSQL conversion separately;
  their existing schemas now run on Longhorn by the approved batch exception.
- [ ] Choose a consistent certificate issuance/distribution method for
  off-cluster services and automate renewal through their configuration lanes.

<a id="15-subnet-migration-16--24-per-vlan"></a>

## Network Follow-Ups

Reference: [current Wi-Fi architecture, SSIDs, rules and clean AP refresh](docs/guides/wifi-architecture.md).

- [ ] Restore stable AP/client connectivity before further network changes.
  Guest Wi-Fi is intentionally paused until WAP replacement; keep the gateway
  infrastructure but do not re-enable the SSID during further troubleshooting.
  Unexpected whole-device restarts continued after the approved 25.12.6 to
  25.12.2 rollback. Separate physical power/hardware from shared driver faults;
  require real-client internet and sustained uptime, not just visible SSIDs.
- [ ] Complete the [device migration and physical checks](docs/guides/vlan-client-migration.md):
  target-SSID tablet identity, remaining client placement, RF coverage,
  static-appliance addressing and protected recovery/access ports.
- [ ] Add narrowly scoped device-specific and multicast policies where required;
  verify required media, printing and discovery flows without broad management access.
- [ ] Complete an RF/coverage walk and broader handset captive-browser checks.
  The owner-confirmed browser login and automated guest acceptance already passed;
  these do not establish coverage, roaming or universal handset compatibility.
- [ ] Qualify a truthful client-specific CAPPORT endpoint before advertising
  DHCP option 114; keep it absent until the endpoint is proven.
- [ ] Replace the constrained WAP with maintained hardware/driver support for the
  required simultaneous VLAN-backed BSSes. Grandstream GWN7660E was selected
  2026-10-23; purchase/delivery, local IaC qualification, recovery and VLAN-path
  acceptance remain pending. Confirm cancellation/refund of the previously
  ordered GWN7665. Target private and guest on 2.4/5 GHz, IoT on 2.4 GHz; keep
  guest paused until all checks pass. See the [WAP buy order](docs/buy-order.md).
- [ ] Extend the existing Tailscale setup with reviewed management routing,
  access rules and split DNS; verify access from outside the home network.
- [ ] Standardize client NTP configuration on the router through each system's
  configuration lane and verify synchronization.

## Threat Protection

- [ ] Qualify Suricata rule updates, resource limits and retention; prove a
  controlled alert reaches a useful read-only diagnostics view.
- [ ] Define CrowdSec acquisition, parsers and private LAPI placement; validate
  detection, administrative exclusions, decision expiry and feed-outage behavior
  before enabling a single supported enforcement path.
- [ ] Select conservative DNS blocklists and IP feeds, including Spamhaus DROP
  and any FireHOL policy. Define update, licensing, false-positive and rollback
  behavior before activation; do not combine incompatible or overlapping feeds blindly.
- [ ] Provide searchable connection diagnostics with time, address, port,
  protocol, interface, rule and verdict filters; prefer an existing log backend.

## Public DNS And External Access

- [ ] Complete [Cloudflare IaC](https://github.com/d0ntblink/cloudflare-iac)
  discovery for Web Analytics and legacy Page Rules with compatible read access;
  retain the separate scoped DNS automation token.
- [ ] Review wildcard/DDNS consumers and remove obsolete public-origin exposure
  without breaking services that still depend on it.
- [ ] Select services for external publication, then configure Cloudflare Tunnel,
  Access policies and scoped connector egress. Keep local administration independent.
- [ ] Evaluate external-dns only if dynamic record management is needed; avoid
  competing writers for records already managed by Terraform.

## Mail

- [ ] Configure per-application Mailgun credentials, sender/reply-to identities
  and notifications when the corresponding applications are deployed.
- [ ] Define bounce/complaint handling, sending limits, retries and credential
  rotation; review DMARC reporting and enforcement separately.
- [ ] Select replacement inbox hosting for `d0ntb.link` and `khodayari.info`,
  preserve required Proton mail and verify aliases, receiving and authenticated
  sending before changing MX records or retiring the existing provider.

Reference: [Mailgun configuration](terraform/mailgun/README.md).

<a id="06-stage-and-accept-the-vyos-replacement"></a>

## Virtualization And IaC

- [ ] Complete protected import/no-op reconciliation for existing NAS/PDM
  workloads where required; do not recreate guests or alter passthrough to adopt them.
- [ ] Align Talos source/image pins with the selected running baseline and
  document bootstrap, configuration, upgrades and health checks without regenerating PKI.
- [ ] Complete reusable VyOS deployment, drift/removal and recovery procedures;
  keep Terraform as VM-lifecycle control and Ansible/native configuration as the router lane.
- [ ] Resolve the guest gateway provider's boot-flag discrepancy without a blind
  apply: native VM 104 reports `onboot=1`. Preserve the running router and gateway;
  see [lifecycle caveats](terraform/proxmox/guest-portal/README.md#recovery-and-lifecycle-caveats).
- [ ] Finish focused operating guides for Fleet, VLAN changes, storage,
  certificates and remote access; document new tool requirements with each feature.

## Cabinet And Physical Documentation

- [ ] Complete and label the patch-panel map, trace remaining cable runs and
  verify switch-to-device paths against the [device inventory](docs/device-inventory.md).
- [ ] Create logical/physical network and rack diagrams, a floor plan and
  labelled front/rear photographs; tidy cable management.

## File Migration

- [ ] Inventory OneDrive usage and select the Google Drive account/storage plan.
- [ ] Migrate and verify file counts/checksums, update integrations, retain a
  read-only transition copy and retire the previous service after acceptance.

## Optional Evaluations

- [ ] Compare Harbor with a lightweight image cache after storage is qualified;
  justify operational cost, limit cache growth and preserve upstream/bootstrap access.
- [ ] Revisit replicated block storage if NAS-independent application availability
  becomes a requirement; assess node capacity before selecting Longhorn or another backend.
- [ ] Evaluate a Raspberry Pi GNSS/PPS time source if independent precision
  timing is useful; it is not a prerequisite for ordinary LAN NTP.
- [ ] Evaluate Anubis only for deliberately public browser endpoints where
  existing access/bot controls leave a demonstrated gap.