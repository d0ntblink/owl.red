# Roadmap

Unfinished work only. Remove completed items; keep implementation details in
the relevant guides and configuration sources.

## Execution Order

1. Finish Fleet reconciliation and the NAS-backed Kubernetes storage rollout.
2. Establish power protection, backups and storage recovery before moving
   production application state.
3. Deploy Home Assistant and migrate applications in small, reversible batches.

<a id="stabilization-gates"></a>

## Platform And Recovery

- [ ] Reconcile Fleet agent ownership, scheduling and disruption budgets;
  ensure each application bundle applies its intended Git revision.
- [ ] Remove Traefik's global backend TLS bypass, retain only the scoped PDM
  exception, provide trusted management certificates and restrict dashboard access.
- [ ] Verify UPS monitoring, shutdown ordering and restart recovery for the NAS,
  hypervisors and essential network services without unsafe power-loss testing.
- [ ] Establish application-consistent backups, an independent copy for NAS
  loss and restore tests. Deploy PBS and schedule protected guest backups.

## Shared Storage

- [ ] Publish and activate the [Fleet SMB CSI bundle](gitops/csi-smb/README.md),
  then verify a retained PVC survives pod recreation on another node.
- [ ] Inventory and clean shared appdata: identify application directories,
  active writers, obsolete content and retention requirements before changes.
- [ ] Validate each application's permissions, locking and database storage;
  shared SMB storage does not make every database or multi-writer layout safe.
- [ ] Resolve the production-media export constraint before enabling the
  separate Proxmox NFS path. Keep media data, paths and access unchanged.
- [ ] Configure restricted Proxmox shared storage and prove the intended guest
  migration/failover behavior before moving guest disks.
- [ ] Add backup and scanner service accounts when their consumers and exact
  share permissions are defined; choose a dedicated scanner inbox.

Reference: [storage design and procedures](docs/guides/shared-storage.md).

## Home Assistant And Applications

- [ ] Deploy Home Assistant through Fleet with one active instance, persistent
  configuration and a supported database layout after storage acceptance.
- [ ] Select an unused Home Assistant hostname, configure trusted HTTPS/proxy
  access and add only the required IoT discovery/service paths.
- [ ] Integrate the thermostat, printers and other selected smart-home devices.
- [ ] Inventory remaining NAS applications and migrate selected services:
  Plex, Arr applications, qBittorrent, slskd, Seer, Tautulli, Reclaimerr,
  speedtest-tracker, Librespeed and FlareSolverr. Preserve application identity,
  state, media paths and any GPU requirements during each migration.
- [ ] Choose a consistent certificate issuance/distribution method for
  off-cluster services and automate renewal through their configuration lanes.

<a id="15-subnet-migration-16--24-per-vlan"></a>

## Network Follow-Ups

- [ ] Complete the [device migration and physical checks](docs/guides/vlan-client-migration.md):
  target-SSID tablet identity, remaining client placement, RF coverage,
  static-appliance addressing and protected recovery/access ports.
- [ ] Add narrowly scoped device-specific and multicast policies where required;
  verify required media, printing and discovery flows without broad management access.
- [ ] Select off-AP captive-portal enforcement, then configure guest DNS,
  CAPPORT/HTTPS and IPv4/IPv6 isolation before enabling guest DHCP and Wi-Fi.
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

- [ ] Extend [Cloudflare IaC](https://github.com/d0ntblink/cloudflare-iac) to the
  required existing records using imports and narrowly reviewed plans.
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
- [ ] Finish focused operating guides for Fleet, VLAN changes, storage,
  certificates and remote access; document new tool requirements with each feature.

## Cabinet And Physical Documentation

- [ ] Complete and label the patch-panel map, trace remaining cable runs and
  verify switch-to-device paths against the [device inventory](docs/mac-inventory.md).
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