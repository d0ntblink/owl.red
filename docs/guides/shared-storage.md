# Shared storage — NAS as central storage for HA workloads

`nas.owl.red` (Unraid) is the central shared store. **Authenticated SMB** is
selected for Kubernetes PVCs and PC access; **NFS** remains the proposed
Proxmox/infrastructure lane, subject to its separate activation gates. Reuse
one shared `appdata` share for NAS-local and Kubernetes applications.

**No fallback or destructive changes:** follow the owner's
[operating constraint](unraid-making-changes.md#no-fallback-operating-constraint).
Routine work continues without repeated permission prompts. Temporary scoped
service interruptions are acceptable; data/hardware destruction is not. Keep
production media files, placement and access/export policy unchanged.

> **Trade-off you accepted:** one Unraid box backing *all* HA workloads makes the NAS a **single point
> of failure** for everything HA — if it's down, cluster PVCs and any Proxmox guest on NFS storage stall.
> Short-term that's fine (simple, works today); medium-term, cluster-native HA storage (Longhorn) removes
> the SPOF. See [ADR 018](../decisions/018-storage-backend.md).

## Frigate Event Storage Plan

For the two existing cameras, use three-day event recording retention on local
SSD storage, not the array. This is the selected design, not a deployed Frigate
instance. Qualify the available SSD capacity, GPU/backend compatibility and
recording bitrate before provisioning it.

The prospective limits and camera references are in the
[Frigate target registry](../../ansible/vars/frigate.json). It is a draft input,
not a deployment command or a validated running configuration. Require stable
wired management access to PVE, Kubernetes and NAS throughout provisioning;
do not loosen client-network firewall policy to compensate for lost access.
Resolve and pin the image digest after the pull, then validate the rendered
configuration and detector against that exact image before starting a recorder.

Video decoding and object detection are separate compatibility gates. Do not
assume current NVIDIA TensorRT supports the GTX 1060 merely because its driver
can decode video. Qualify the proposed small OpenVINO CPU detector, low-resolution
camera stream and NVIDIA decoding independently, without upgrading the host
driver or changing PCI passthrough as an implicit prerequisite.

- Use a bounded RAM-backed `/tmp/cache` for Frigate's temporary recording
   segments. Recording streams are processed continuously; only segments matching
   the retention policy are retained on SSD. RAM cache is transient, not a place
   to retain the three days of recordings.
- Keep Frigate's configuration and SQLite database on a qualified local SSD
   filesystem. Keep retained recordings on an SSD-only location with no automatic
   Mover transfer to the array. Do not change existing production media shares.
- Configure three-day retention for the intended alert/detection recording
   categories and review snapshots separately. Validate that no longer general
   retention rule overrides the intended event expiry.
- Monitor real free space and preserve headroom for other applications. A
   three-day policy does not impose a hard storage quota or protect against a
   busy scene filling a shared SSD.

### Keep An Event Longer

Use Frigate's existing UI rather than moving its internal recording segments:

1. Before the footage expires, open its review item or the relevant time range
    in History and select **Export**. Choose a normal-speed video clip when a
    timelapse is not wanted.
2. Find the completed clip under **Exports**. Exported clips are separate from
    ordinary recordings and are not deleted by the three-day recording policy.
3. Leave it on SSD or download it for longer-term storage. Exports remain until
    explicitly deleted; inspect their usage so saved clips do not fill the pool.
4. If archiving elsewhere, verify the downloaded/copied clip before removing
    the SSD export through Frigate. Do not relocate raw recording segments or
    edit its database to work around retention.

Exporting a clip creates an additional file; it is not a zero-space pin of the
existing footage or automatic protection against SSD failure. A future
dedicated archive destination can be selected separately. Camera SD recording
and automatic SD-to-Frigate imports are not part of this design. No new camera
or storage hardware is required merely to use the native Export UI.

Reference: [Frigate recording and exports](https://docs.frigate.video/configuration/record/).

## On-Demand Text Summarizer Plan

Use one small quantized text model for concise structured context and daily
briefings. Keep the API private and authenticated. This service is not deployed;
model, engine and CUDA-image selection remain qualification work.

- Allow one inference job at a time with bounded input context, output tokens
   and runtime. Offer brief and careful modes using the same model; a careful
   mode may add a fact-checking pass, but slower execution is not an accuracy
   guarantee.
- Keep model downloads on SSD, not in the RAM recording cache. A model's disk
   size is not its runtime VRAM requirement; measure weights, context cache and
   runtime overhead alongside the other GPU consumers.
- Prefer a per-job inference worker that exits on completion, cancellation or
   timeout. Verify GPU allocations return to the pre-job baseline; do not claim
   an idle API process proves the model has unloaded.
- Evaluate a supported existing engine rather than implementing inference.
   Ollama's `keep_alive: 0` is an alternative unloading mechanism, not a GPU
   reservation or priority guarantee. Avoid an always-loaded model.
- Keep the GTX 1060 in its existing guest and share it only through qualified
   container runtimes. Do not change passthrough, reset the GPU or upgrade host
   drivers to work around an incompatible image. Measure Frigate/Plex impact
   before accepting simultaneous operation.

## Observed NAS Baseline (2026-10-18)

Read-only SSH inspection at `2026-10-18T18:50:53Z` reached `nas` at
`10.0.10.5`, running Unraid `7.3.3`. Private evidence is under
`~/.local/state/owl-red/nas-storage-audit-TWufLT/`. No NAS configuration,
service, array, disk or power changes were made.

- NFS is globally disabled in saved and runtime settings. `exportfs -v` is
   empty and no TCP 2049 listener was found. Saved exports below are not active.
- `/mnt/ssd` is XFS on one block device, about 500 GB total with 351 GB
   available. Pool redundancy and backup coverage were not verified.
- `/mnt/user` reports about 46.0 TB total, 7.29 TB available and 85% used.
- The proposed `/mnt/ssd/appdata/k8s` directory does not exist.
- Local `apcaccess status` returns connection refused, with no `apcupsd`
   process or TCP 3551 listener. Other UPS implementations, external monitoring
   and staged shutdown remain unverified; no power test was run.

| Share | Configured placement | Saved NFS export | Saved NFS security | Host list |
|-------|----------------------|------------------|--------------------|-----------|
| `appdata` | `ssd`, pool-only | Disabled (`-`) | `private` | Empty |
| `vms` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |
| `isos` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |
| `backups` | Array | Enabled (`e`) | `public` | Empty |
| `media` | Array | Enabled (`e`) | `public` | Empty |
| `sharefiles` | Array | Enabled (`e`) | `public` | Empty |
| `system` | `ssd`, pool-only | Enabled (`e`) | `public` | Empty |

Subsequent accepted change at `2026-10-18T19:25:11Z`: the owner declared all
`sharefiles` contents disposable. Fresh checks found no SMB handles, container
references or nested mounts, and only an empty `.Recycle.Bin` directory.
That directory and the share were retired through Unraid's native handler;
zero files were deleted. The path/config and SMB advertisement are absent.
All other share configs, media, disk/array/network/global config hashes remain
unchanged; NFS is still disabled. Private evidence:
`~/.local/state/owl-red/retire-sharefiles-HQj9wV/`.

Do not enable NFS with these saved public exports. Restrict intended exports
and disable unneeded exports, especially `system`, first. The Ansible file
lane is still a no-write scaffold. The owner amendments below govern the target;
they do not authorize live activation or deletion.

## Owner Amendments (2026-10-18)

- Use one shared `appdata` share for NAS-local and Kubernetes applications,
   not a separate `appdata-k8s` share. Inventory and cleanup are roadmap work;
   no live directory is renamed, moved or deleted now. Final per-app/PVC paths
   remain to be agreed; the earlier `appdata/k8s` directory is only a proposal.
- Keep distinct application/PVC ownership and avoid old NAS and new Kubernetes
   instances writing the same single-writer state during migration. Shared
   storage enables restarts elsewhere, not automatic active-active application HA.
- Production `media` is protected: no content, path, placement, share-security
   or export changes in this work. Do not merge it into a new bulk-data share.
- `sharefiles` is retired after the owner confirmed no contents were needed
   and the bounded no-consumer/empty-content checks passed. Do not recreate it.
- Keep NAS boot and essential recovery infrastructure independent of its own
   exports. Qualify database/filesystem compatibility and backups per application.
- The owner selected **SMB with a dedicated `k8s` account** instead of NFS for
   Kubernetes. Use upstream `csi-driver-smb` after qualifying the existing Talos
   CIFS/SMB3 support, with Bitwarden-backed provisioning/node-stage secrets and
   retained per-PVC directories. This is selected design, not a deployed driver.
- Plan backup and scanner identities, creating them when their consumers exist.
   Reuse existing `root` and `d0ntblink`; no accounts or credentials have changed.

**Activation blocker:** globally enabling NFS would activate media's saved
public export even without editing its configuration. Keep NFS off until a
separately agreed approach avoids exposing or changing protected media.
This is a blocker for the future NFS lane, not SMB CSI preparation. Existing
SMB media access is guest-readable and unchanged, so strict denial of media
reads to a new account cannot currently be claimed.

## Share → consumer → protocol map (reusing existing shares)

| Share | Pool | Serves | Proto | Notes |
|-------|------|--------|-------|-------|
| `appdata` | ssd | NAS-local apps + **k8s PVCs** | Local + authenticated SMB | One share with distinct app/PVC paths. Planned private access and `k8s` write grants; qualify ownership, locking and database storage rather than assuming SMB fixes network-filesystem constraints. |
| `vms` | ssd | **Proxmox** HA VM/LXC disk images | NFS | shared disks = real CT/VM failover (e.g. PDM); Unraid's own VM manager is disabled, so the share is free to reuse. |
| `isos` | ssd | **Proxmox** ISOs / CT templates | SMB 3.1.1 | Cluster storage `nas-isos`, dedicated `pve` identity; standard `template/iso` and `template/cache` layout. |
| `backups` | array | **Proxmox** vzdump + PBS + personal backups | NFS + SMB | |
| `media` | array | Existing production consumers | Existing access unchanged | Protected; no files, paths, placement, security or export changes in this work. |
| `sharefiles` | Retired | None | Not exported | Owner-authorized retirement accepted 2026-10-18; zero files and one empty recycle-bin directory removed. |
| `system` | ssd | Unraid internal (libvirt/docker img) | none | **never export.** |

## Security model (do this before flipping NFS on)

- Enable NFS only after every effective export is safe; the protected-media
   activation blocker above is not an implicit exception. Restrict intended
   exports to explicit Kubernetes/Proxmox client IPs, not the whole management
   subnet. Document each approved host rule before activation.
- Map UID/GID: Unraid shares are owned by `d0ntblink`; k8s/Proxmox write as root, so the export needs the
  right squash. Use `no_root_squash` **only** on the cluster/Proxmox-restricted exports (PVCs/VM disks),
  never on `media`/personal exports. Document the exact `shareHostListNFS` rule string per share.
- NFS is plaintext on the LAN — acceptable inside VLAN 10; do **not** expose it across VLANs or the WAN.

## Accounts And Access Roles

Read-only account inspection on 2026-10-18 found `root` (UID/GID `0:0`) and
the existing file-access user `d0ntblink` (`1000:100`, `/bin/false`). Effective
Samba configuration for `appdata`, `vms`, `backups`, `media` and `system` reports
`guest ok=Yes`, `read only=Yes`, no `valid users` restriction and
`write list=d0ntblink`. These settings permit guest read access; creating more
users alone does not restrict it. Do not change protected media in response.

| Identity / Role | Intended Access | Status |
|-----------------|-----------------|--------|
| `root` | WebUI administration and controlled break-glass SSH; not application/PC SMB credentials | Existing; preserve access |
| `d0ntblink` | Owner's PC over authenticated SMB; explicit per-share permissions | Existing; reuse, no password rotation |
| `k8s` | SMB read/write grant on shared appdata for CSI provisioning/mounting; no management login | Created, UID/GID `1001:100`, shell `/bin/false`; NAS-local SMB3 write/read and guest denial accepted |
| `svc-backup` | A named SMB backup client, limited to its backup destination | Planned; confirm consumer/grants before creation; not immutable backup protection |
| `pve` | SMB read/write on `isos` for PVE ISO/template storage | Created through Unraid's native handler; existing ISO-share policy and grants preserved; no production-media grants changed |
| `svc-media-ro` | Optional future read-only SMB media consumer | Deferred; no permission change to production media |
| `svc-scanner` | Scanner restricted to a dedicated inbox, not appdata | Planned; create when consumer/path is selected; validate write-only semantics |
| Harbor robots | Registry project pull/push permissions, not NAS-wide permissions | Harbor identities if that service is selected, not Unraid users |

For intended private SMB shares, require authentication and explicit read/write
grants; do not mistake Unraid's `secure` guest-readable mode for private access.
Review existing clients before changing access. Do not recursively reset appdata
ownership or apply blanket `777` permissions: container UIDs and database files
must retain compatible ownership. Shared AUTH_SYS NFS trusts allowed hosts;
per-app directories and SMB users do not isolate files from a privileged NFS
client. Kubernetes SMB is now the selected protocol; its shared `k8s` credential
does not strongly isolate application directories from one another. Existing
guest-readable media is also an explicit exception to any appdata-only read
claim. Appdata is now private with explicit `d0ntblink,k8s` write grants;
other shares retain their previous policy. No existing appdata ownership or
application contents were reset or migrated.

Account creation remains in the Unraid-supported manual lane from
[ADR 021](../decisions/021-unraid-hybrid-iac.md), not generic `useradd` or direct
edits to password databases. Store new credentials privately in Bitwarden and
map them only to the selected consumer; never record passwords in Git or tool
output.

The [SMB CSI bundle](../../gitops/csi-smb/README.md) is active through Fleet,
with two controllers, node plugins on all four nodes and the non-default
`nas-appdata-smb` StorageClass. The Bitwarden operator supplies the private
two-field credential secret. Appdata remains private to its existing
`d0ntblink,k8s` grants; NFS remains disabled.

A disposable PVC passed authenticated writes, UID/GID `1001:100` and
file/directory mode checks, and persistence after pod recreation from
`worker1-talos` to `cp3-talos`. Claim deletion left its NAS files intact under
the Retain policy. Only the uniquely identified test files and Kubernetes
resources were cleaned up. Other shares, media and protected NAS system/account
configuration remained unchanged. This qualifies the storage path, not an
application's database, multi-writer layout or backup strategy.

The SDK incident and continuing logging controls remain documented in the
[SDK logging safeguard](controller-setup.md#sdk-logging-safety-and-smb-checkpoint).
Talos 1.8.1 CIFS support and Kubernetes cross-node mounts are confirmed.

## Who configures what (which IaC lane)

| Piece | Lane | Where |
|-------|------|-------|
| Enable NFS + per-share export/security | **Ansible file-lane** (`unraid_settings`, Phase 2) | `share.cfg` (`shareNFSEnabled="yes"`) + `shares/*.cfg` (`shareExportNFS`, `shareSecurityNFS`, `shareHostListNFS`) |
| Array/disk/pool layout | **Manual** ⛔ | Unraid UI — never IaC |
| k8s PVCs (CSI + StorageClass) | **GitOps/Fleet** | Pinned upstream `csi-driver-smb`; source `//nas.owl.red/appdata`, private provisioning/node-stage secret references, retained per-PVC directories and qualified Talos/CIFS support. No passwords in manifests. |
| Proxmox ISO/template storage | **Native API/controller** | [target registry](../../ansible/vars/proxmox-storage.json) and [guarded storage controller](../../scripts/proxmox-storage-run.mjs); cluster-wide CIFS definition with private password submission. Guest disks/backups remain separate review work. |
| Personal SMB mounts | **Manual / documented** | already exported; fstab/Finder/Explorer |

## Phased rollout (safe order)

1. Inventory application ownership, current consumers and intended grants;
   implement and check the guarded Ansible file lane. Schedule appdata cleanup
   without touching production media. The completed `sharefiles` retirement
   must not be replayed or recreated by inventory/recapture.
2. Qualify power/shutdown and restrict intended exports, excluding `system`.
   Resolve the protected-media activation blocker before enabling NFS; global
   enable is not approved while it would activate that public export.
3. **Kubernetes workloads:** use the accepted SMB StorageClass, qualifying each
   application's ownership, locking, database placement and restore procedure
   before migration. Do not reuse production media for tests. Global NFS
   activation is not required for Kubernetes.
4. **Proxmox shared storage:** `nas-isos` is attached over SMB on all six PVE
   nodes for ISO/template content only. Select and qualify guest-disk and backup
   storage separately before moving guest disks or claiming guest HA/failover.
5. **Personal:** confirm SMB mounts; (optional) NFS for Linux desktops.
6. **Document the StorageClass name, NFS paths, and mount rules** back into this guide + README.

## Open items
- Final per-app/PVC layout and safe cleanup within the selected shared appdata.
- Protected media's saved public export versus global NFS activation.
- Keep retired `sharefiles` absent from the Ansible share inventory and snapshot.
- Confirm SMB service-account consumers and private-share grants before creation.
- `no_root_squash` scope per export (PVCs/VM-disks need it; personal must not have it).
- Per-app config/database separation before using Longhorn: ordinary configuration
   remains live on NAS `appdata`; an inseparable app requires an explicit decision.

## Proxmox ISO And Template SMB

`nas-isos` is one cluster-wide CIFS definition, active on `edge`, `storage`,
`cp1`, `cp2`, `cp3` and `worker1`. It uses the existing `isos` share and SMB
3.1.1, not global NFS. Its dedicated password is stored in Secrets Manager as
`proxmox__nas-isos__password` and submitted to Proxmox over private stdin; it
is not present in Git or process arguments.

From the repository root, run `node scripts/proxmox-storage-run.mjs plan` or
`verify` for inspection. `prepare` creates/reuses the private credential and
native Unraid `pve` account/grant without rotating an existing account. `apply`
creates the reviewed storage definition if absent, activates it on each node,
and refuses incompatible existing definitions. NAS media/disk/network settings
and existing ISO-share grants are protected during account preparation.

Proxmox lists ISOs from `template/iso` and CT templates from `template/cache`.
The existing root-level ISO files have not been moved, renamed or deleted and
will not appear in Proxmox's ISO list until a separately reviewed import/copy.
This storage attachment does not migrate VM disks or provide shared-disk HA.

## Initial Application Migration

FlareSolverr is the first completed CPU-only migration. Its Fleet bundle pins
upstream `v3.5.2`, matching the NAS service version, with non-root execution and
bounded CPU/memory. Browser state is ephemeral; this service does not place a
SQLite database on SMB or need media mounts. Its private endpoint is
`http://flaresolverr.owl.red:8191` at `10.0.10.202`, restricted to the NAS source
address. There is no browser WebUI or public ingress.

The service passed NAS reachability, disposable browser-session creation and
Prowlarr's native proxy test. Prowlarr proxy `4` now uses the DNS endpoint; its
other settings were preserved. The old NAS container is stopped with Docker's
restart policy disabled; its files and container definition remain for rollback.
Do not manually start it or re-enable it in Unraid's boot autostart list as an
unreviewed second instance.

Use `node scripts/flaresolverr-run.mjs plan` or `verify` for inspection. `apply`
performs the guarded browser/proxy tests and native consumer switch. Private
preimages remain under `/root/.local/state/owl-red/flaresolverr-migration` on
the NAS. `rollback` starts the old container and restores the proxy host
`http://flaresolverr:8191` through the native API. No application data is deleted.

Librespeed still has an obsolete external PostgreSQL endpoint to resolve.
qBittorrent's VPN/shared-network behavior is also a migration boundary. Do not
copy their config directories onto SMB and assume SQLite, locking, paths or
VPN isolation remain correct. GPU apps remain on the NAS.

## qBittorrent And Gluetun

qBittorrent `5.3.0` and Gluetun run together in one Kubernetes pod in the
`qbittorrent` namespace, using separate pinned upstream images. The
[Fleet bundle](../../gitops/qbittorrent/qbittorrent.yaml),
[application registry](../../ansible/vars/qbittorrent.json) and
[cluster migration helper](../../scripts/qbittorrent-cluster-run.mjs) own the
deployment. It uses `Recreate`, one replica, and a native Gluetun sidecar started
before the non-root qBittorrent process. Initial placement is `worker1-talos`;
ordinary node rescheduling is allowed.

The browser endpoint is `https://qbittorrent.owl.red`, with a verified
Let's Encrypt certificate and the administration allowlist. Download clients
use `http://qbittorrent-direct.owl.red:8080` at `10.0.10.203`, restricted to the
management LAN and administration PC. Sonarr HD/UHD, Radarr HD/UHD, Lidarr and
Prowlarr passed their native connection tests. Lidarr previously had no saved
credentials and relied on the Docker-network bypass; it now uses the existing
qBittorrent account credential from Sonarr's private native settings. The
Sonarr API masks that password, so it is not a credential source. No account
password was reset. Gluetun has no browser WebUI; its control API is loopback-only.

### Preserved Storage

The existing `/mnt/user/appdata/binhex-qbittorrentvpn` is still mounted at
`/config` through a retained static SMB claim, including the original profile,
torrent files and resume state. Its directory name is intentionally unchanged.
NAS media remains at `/media`, with no data movement or ownership changes.
The small legacy `/shared` contents were copied to the owned
`appdata/qbittorrent-shared` directory and remain at `/shared`; the old Docker
volume is retained. There is no SQLite database in this profile. Five torrents,
their identities, paths, categories and tags, category definitions, and the
original WebUI username/password hash matched the private final baseline.

Gluetun's configuration remains in `/mnt/user/appdata/gluetun`. Its private
WireGuard file reuses the original key, address and peer endpoint. Legacy
`PostUp`/`PostDown` scripts are not used. The custom WireGuard provider retains
that endpoint, with native ProtonVPN NAT-PMP port forwarding. Credentials stay
in the existing private Bitwarden/SMB CSI secret lane, never in Git manifests.

The owner approved adding the existing `k8s` identity to media's write list and
ordinary case-sensitive SMB mode for `appdata` and `media`. Forced-lowercase
mode hid existing mixed-case paths such as `qBittorrent` and `Downloads`.
Files were not renamed; media ownership/ACLs, existing write grants and the
secure/guest-read policy were preserved. Global NFS remains disabled, including
the latent public media export. The private Gluetun tree and newly created
shared directory are owned by `k8s`; unrelated app ownership is unchanged.
Named ACLs alone did not permit traversal of the private root-owned Gluetun
tree, so its approved ownership correction is required. Source flash settings
record these narrow changes; they do not authorize unrelated share changes.

### VPN Operation

qBittorrent binds to `wg0` and uses Gluetun's DNS. UPnP and random ports are
disabled; documented native Gluetun hooks synchronize the advertised listening
port and bind qBittorrent to loopback while the VPN is down. The existing
localhost API authentication bypass is retained, not newly enabled. Explicit
cluster, management-LAN and administration-PC route exceptions permit internal
WebUI return traffic; public internet routes through WireGuard.

The cluster directly executes qBittorrent as UID `99`, GID `100`, retaining the
original `000` umask. It bypasses the image's port updater, which does not
recognize qBittorrent 5.3's `[WebUI]` authentication layout and writes duplicate
legacy fields. Native Gluetun hooks replace it; no custom updater daemon is
installed. Privoxy and SOCKS are disabled, with no ports `8118` or `9118`.
Neither container is privileged. Gluetun has the required network/file
capabilities, including `FOWNER` to clean up runtime files. Its startup removes
only stale WireGuard table `51820` rules inside the pod namespace. Kernel
WireGuard was qualified without hostPath, `/dev/net/tun` or host networking.

The first VPN-stop check exposed a missing `FOWNER` capability and consequent
stale-rule restart failure. Both were repaired before the accepted check:
the same direct HTTPS request succeeded with VPN up and timed out with VPN
stopped. VPN restart ran in `finally`, and subsequent verification confirmed
`wg0`, renewed port synchronization, preserved state and signed HTTPS access.
Lease renewal is asynchronous: pod readiness can return before the forwarding
hook rebinds qBittorrent from `lo` to `wg0`. Verify that agreement after recovery.
This planned stop/recovery check does not certify every unclean failure mode.

From the repository root:

```sh
node scripts/qbittorrent-cluster-run.mjs verify
```

### Cutover And Rollback

The cluster helper's `media-access` and `case-access` implement the approved
native Unraid settings. `prepare` captures private container preimages and
scoped appdata ACLs. `stop` records the final baseline, stops both NAS containers
and disables restart before Fleet replicas are raised. The temporary storage
check wrote/deleted only its own unique files and its pod was removed. `peers`
tests and updates native client endpoints without replacing category settings.
Do not repeat initial preparation while the cluster writer is active.

NAS `qbittorrent` and `gluetun`, plus `qbittorrentvpn-rollback`, remain stopped
with restart disabled. Never start them alongside the cluster pod. For host
rollback, publish Fleet replicas `0`, wait for every application pod to disappear,
then run `node scripts/qbittorrent-cluster-run.mjs rollback`. It starts the clean
NAS pair against current profile/resume state, not a stale archive. Once the NAS
API is healthy, restore native client host fields from the private per-app
preimages. That host rollback has not been executed against the accepted
deployment. The [old NAS helper](../../scripts/qbittorrent-run.mjs) also guards
against cluster writers; its bundled-image rollback is not routine host rollback.
Native Unraid templates are fallback definitions, not permission to start
retired writers. Baselines, container definitions, client preimages and the
offline archive remain in `/root/.local/state/owl-red/qbittorrent-cluster`;
they are not independent backups.

## Fresh Speedtest Tracker

The owner requested a clean replacement for the broken legacy tracker rather
than a history conversion. `https://speedtest.owl.red` now serves the maintained
LinuxServer `v1.15.0-ls176` image, pinned by digest in the
[registry](../../ansible/vars/speedtest.json) and
[Fleet deployment](../../gitops/speedtest/speedtest.yaml). It uses one replica,
the administration allowlist, and a verified Let's Encrypt certificate.
Its normal internet route is not the downloaders' VPN gateway.

The fresh `speedtest` PostgreSQL database has a dedicated non-superuser role
managed by the existing [database registry](../../ansible/vars/postgresql.json).
Ordinary config stays live in the new NAS `appdata/speedtest-tracker-v2`
directory through a retained SMB claim. Neither legacy SQLite file is mounted
or imported. The LinuxServer init runs normally; application processes use
the configured `k8s` UID `1001`, GID `100`. The readiness probe uses the pinned
release's verified `/admin/login` route, not the absent generic `/up` route.

The initial admin is `admin@owl.red`. The generated password is stored in
Bitwarden as `speedtest__admin-password`, and the stable encryption key as
`speedtest__app-key`; mapped Kubernetes secrets supply both before the native
first migration creates the user. Do not rotate the app key on redeploy.
The native Laravel password-hash/admin-role checks and PostgreSQL query passed.
One initial test completed and was stored in PostgreSQL. Automatic tests run
every six hours; results are not automatically pruned. Display timezone is
`America/Edmonton`, and the public dashboard is disabled.

Use `node scripts/speedtest-run.mjs verify` for the scoped native DB/admin check.
`initial-test` refuses another run when any result already exists. `prepare`
and `retire` are guarded initial provisioning/cleanup operations, not data resets.
The stopped legacy NAS container and its native Unraid template/autostart entry
were removed after acceptance. Its two old database/history files remain under
`appdata/speedtest-tracker`, separate from the replacement, pending an explicit
decision to delete them. Private legacy-definition/template preimages are under
`/root/.local/state/owl-red/speedtest-fresh`; they are not independent backups.

## Longhorn Database Volumes

### Seven-App Arr And Bazarr Batch

Prowlarr, Sonarr HD/UHD, Radarr HD/UHD, Lidarr and Bazarr now run in namespace
`arr`. A single [local chart](../../gitops/arr/chart/Chart.yaml) renders all
seven workloads from the [shared registry](../../gitops/arr/chart/apps.json);
one replica and `Recreate` preserve single-writer operation per application.
The owner explicitly approved keeping SQLite schemas unchanged on Longhorn
for this host move and deferring PostgreSQL conversion. The shared PostgreSQL
service and its provisioning code were not changed by the batch.

Six Arr apps have their database roots on separate retained `longhorn-appdata`
claims, with `config.xml`, ASP.NET keys and existing config/log/backup/cover
directories overlaid from NAS appdata. Bazarr keeps `/config` on NAS with its
database directory overlaid from Longhorn. Existing images, API keys, download
paths, `/media` mounts and per-image timezones/umasks were retained. No live
SQLite file is opened on SMB, and no media ownership or share policy changed.

All seven NAS writers stopped before thirteen native SQLite backups were made.
Every backup passed `quick_check`, and every transferred database matched its
staged SHA-256 sum. One temporary seed pod mounted all seven volumes and was
removed after verification. The transfer is resumable: completed markers are
checked rather than recopied. Large archives are streamed through controller
private files rather than expanded into base64 in memory.

Each app passed its native API status check with its existing API key. Seerr's
four Sonarr/Radarr peers and Prowlarr's five application peers passed their
native connection tests using internal service names. Bazarr's configured
Sonarr/Radarr addresses were updated before startup. Soularr now uses
`lidarr.arr.svc.cluster.local:8686`; its VPN pod has an explicit hosts entry
for that service because its DNS deliberately uses Gluetun, not cluster DNS.
Update that entry if the Lidarr Service is recreated with a different IP.

The certificate covers `prowlarr.owl.red`, `sonarr.owl.red`,
`sonarr-uhd.owl.red`, `radarr.owl.red`, `radarr-uhd.owl.red`, `lidarr.owl.red`
and `bazarr.owl.red`. Verified HTTPS returned the existing login redirects for
the Arr apps and the Bazarr UI, with the administration allowlist retained.
No test download, library import or subtitle operation was triggered.

Use `node scripts/arr-batch-run.mjs verify` for one native status check per app.
The initial `stop` and `seed` phases refuse active cluster writers; do not
repeat initial migration against the accepted deployment. `peers` owns the
native endpoint updates, and `retire` removes only the old apps' NAS boot
autostart entries after all seven replacements are available. Their NAS
containers are stopped with restart disabled and retained files are stale
after cluster writes. Never restart them without first quiescing the cluster
and exporting the current Longhorn databases. Private preimages and snapshots
remain under `/root/.local/state/owl-red/arr-batch`, not independent backups.

### Tautulli And Reclaimerr

Both apps now run as non-root UID `99`, GID `100` in the `media-apps` namespace,
using their existing pinned images and one replica with `Recreate` strategy.
Their ordinary configurations remain live on NAS appdata. Tautulli's native
`--config /config/config.ini --datadir /data` split puts its active SQLite file
on Longhorn without relocating the NAS config, caches, logs or backups.
Reclaimerr's database and IMDb SQLite cache overlay their existing paths with
subdirectories from one Longhorn volume. This version hardcodes SQLite and
does not expose a native PostgreSQL backend.

The [registry](../../ansible/vars/media-batch.json),
[Fleet resources](../../gitops/media-apps/applications.yaml) and
[batch controller](../../scripts/media-batch-run.mjs) own this migration.
The three databases were captured with SQLite's native backup API after the
NAS writers stopped, passed `quick_check`, and matched their SHA-256 hashes
after transfer. Application table row counts were preserved after startup.
Tautulli's existing API key worked, Reclaimerr's private session/encryption
secrets file remained byte-identical, and Seerr's native Tautulli connection
update passed using the internal service name. No extra test media operation
was triggered.

Normal browser URLs are `https://tautulli.owl.red` and
`https://reclaimerr.owl.red`. Their shared certificate completed DNS-01
validation after the initial propagation delay. TLS verification passed for
both URLs; Tautulli redirects to its login and Reclaimerr serves its UI.
cert-manager creates
and removes temporary Cloudflare TXT records and renews certificates; those
challenge values are not Terraform-managed persistent records. The internal
application A records remain in the Technitium zone. Google and Cloudflare
public resolvers are both retained for self-checks, with Google now first after
a stale negative response was observed from 1.1.1.1.

NAS containers are stopped with restart disabled. Their original databases are
retained but are stale once the cluster writes. The batch controller refuses a
NAS rollback against stale data: pause both Fleet workloads, wait for all app
pods to disappear, and export the current Longhorn state before host recovery.
Private snapshots and preimages are under
`/root/.local/state/owl-red/media-batch`, not independent backups. Temporary
seed pods were removed; GPU applications, the VPN pod and NAS disk tooling
were not modified by this batch.

### slskd And Soularr

The owner approved starting the previously unstarted slskd/Soularr pair on the
cluster behind ProtonVPN. Both now share the existing qBittorrent/Gluetun pod,
not a second tunnel using the same WireGuard credentials. Normal browser URLs
are `https://slskd.owl.red` and `https://soularr.owl.red`, with verified
certificates and the administration allowlist. DiskSpeed and NAS disk tooling
remain on the NAS and were not migrated.

The [registry](../../ansible/vars/soularr.json) pins the existing images. Ordinary
configs remain live in `appdata/slskd` and `appdata/soularr` over retained SMB
claims. slskd's `/app/data` overlays a `longhorn-appdata` claim; its SQLite files
are not opened on SMB. The five existing databases were copied with SQLite's
native backup API, passed `quick_check`, and matched their staged SHA-256 sums
after transfer to Longhorn. Original NAS files remain, but become stale once
the cluster writes; never use them as automatic rollback data.

Existing Soulseek and WebUI credentials were preserved. Soularr's empty config
was initialized from its pinned upstream sample with the existing Lidarr key
and a dedicated slskd API key from Bitwarden. The API key is loopback-scoped;
no credential values are in Git. Config initialization retains the original
download and incomplete directories under `/media/Downloads`. Soularr sees the
completed directory at `/downloads`, and Lidarr sees its original `/media`
path. slskd runs as its original UID `1654`; Soularr runs as UID `99`, GID `100`.
Only required appdata directory access was adjusted, not media ownership.

Gluetun requests two Proton forwarded ports. slskd's native VPN integration
uses the primary port, monitors connection state and delays/disconnects Soulseek
when the gateway is unavailable. qBittorrent's native forwarding hook uses the
second port. Both applications' advertised ports matched the live provider
ports, Soulseek reported `Connected, LoggedIn`, and read-only API requests from
the Soularr container to both Lidarr and slskd succeeded. This acceptance did
not trigger an additional test download.

Run `node scripts/soularr-run.mjs verify` for the scoped native connection/port
check. `prepare` and `seed` are initial migration operations, not routine
reconciliation; do not repeat them against the running writer. Private
preimages and database snapshots are under
`/root/.local/state/owl-red/soularr-migration` on the NAS, not independent
backups. NAS source containers remain unstarted with restart disabled. A host
rollback of the shared pod must stop every cluster writer and preserve/export
the current Longhorn databases before considering NAS activation; the older
qBittorrent-only host rollback is not a complete rollback of this new pair.

Prefer the existing shared PostgreSQL service where the application supports it
and a verified migration preserves existing state. Use an isolated database/role
per app. Seerr `3.5.0` supports PostgreSQL and documents a specific pgloader build
for SQLite conversion; it must not start against an empty replacement database
as a substitute for transferring users and request history. Longhorn is reserved
for applications that still require file-based database storage.

Seerr's database stage is complete: version `3.5.0` now uses its isolated `seerr`
PostgreSQL database/role, with a two-connection pool. All 14 application table
counts and 36 users matched the consistent SQLite copy, including account and
credential fields. The existing authenticated API key passed after restart.
Seerr now runs in Kubernetes at `https://seerr.owl.red`. Settings/logs remain
live in the existing NAS `appdata/seerr` directory through a retained static SMB
claim; its database remains in shared PostgreSQL, not an SMB SQLite file.

The [Seerr database controller](../../scripts/seerr-db-run.mjs) has `plan`,
`prepare`, `apply` and `verify` phases. It uses the exact pinned app image and
upstream-recommended pgloader build, never a custom cross-database importer.
Preparation uses SQLite's online backup API, not a copy of an actively written
database file. Final apply stops the old writer and repeats conversion/checks.
PostgreSQL's native migration-history table is retained; SQLite's `migrations`
table must not overwrite it. Existing application data is otherwise transferred.

Private snapshots, conversion logs and runtime credentials are under
`/mnt/ssd/appdata/seerr-postgres-migration`, mode-restricted and not committed.
They are migration/recovery inputs, not independent backups. Do not print their
contents. The stopped `Seerr-sqlite-rollback` container and original SQLite files
are retained, but are stale after new PostgreSQL writes: do not start them as an
automatic rollback after acceptance or run both writers. A later rollback must
preserve any new PostgreSQL data first. `reset-target` is restricted to an owned
pre-cutover conversion target while the original SQLite instance is running;
it is not a production database reset command.

The [Seerr host controller](../../scripts/seerr-run.mjs) prepares peers through
native settings APIs, stops the old PostgreSQL NAS writer, and verifies the new
TLS endpoint, existing API key, user/request counts and application/session
identity. Sonarr and Radarr now use their HD/UHD Services in namespace `arr`.
Tautulli uses
`tautulli.media-apps.svc.cluster.local:8181` through Seerr's native settings API.
Native API bodies omit
read-only IDs and preserve integration keys/profiles/options.

Only Seerr's non-database config tree received a named `k8s` ACL for SMB writes;
ownership and unrelated appdata/media are unchanged. The initial settings-file
grant is applied after native settings saves and after the old process stops,
because Seerr replaces the file and narrows its inherited ACL mask. The original
ACL preimage is private under `/root/.local/state/owl-red/seerr-host-migration`.

The NAS PostgreSQL `Seerr` container is stopped with Docker restart disabled,
retained with its definition for host rollback. To roll back hosting, set Fleet
replicas to zero and wait for every Seerr pod to stop, then run
`node scripts/seerr-run.mjs rollback`. It restores the old runtime user's
non-database config access and starts the original PostgreSQL instance against
the same current database. Do not restart the stale `Seerr-sqlite-rollback`
container or enable two simultaneous writers. Original local migration copies
and the stopped containers are recovery inputs, not independent backups.

Longhorn is selected for database-safe single-writer volumes. Ordinary config
files remain live on NAS `appdata` over SMB. Split database state onto a block
volume only where the application supports a separate path or a qualified mount
layout. SQLite WAL/shared-memory files must remain with their database on the
same filesystem. An inseparable app needs an explicit per-app decision first.

The active Fleet bundle pins Longhorn `1.12.1`, compatible with Kubernetes `1.31.1`.
Longhorn `1.13.0` requires Kubernetes `1.34+` and is not selected. The retained,
non-default `longhorn-appdata` class requests three replicas and ext4 with the V1
engine. Replicas use dedicated local disks, not SMB-mounted directories.

The controller Helm bundle and dependent raw StorageClass bundle have separate
Fleet owners. Only the Longhorn namespace is privileged for host storage access;
its policy is declared in Fleet namespace labels. An existing namespace may
require those same labels once during bootstrap. Application namespaces remain
restricted.

Each Talos VM has a new 64 GiB `scsi1` data disk from its own physical PVE host.
The original 40 GiB `scsi0` system disks are preserved. The
[storage patch](../../talos/patches/longhorn.yaml) mounts only the verified new
`/dev/sdb` at `/var/mnt/longhorn` with kubelet shared propagation. Do not apply
it to a different disk layout. Node zone labels describe physical PVE hosts;
update them if VM placement changes.

Talos remains `1.8.1`. Its source-controlled image-factory schematic adds only
official `iscsi-tools` and `util-linux-tools`. Use a matching Talos `1.8.1`
client for the rollout: the controller's newer `1.13.0` watcher encountered a
gRPC keepalive mismatch. Stage the minimal patch, upgrade to the same-version
extension image, and require Ready, active iSCSI and the dedicated mount before
changing the next guest. Private node config preimages are recovery inputs,
not application-data backups.

Before production databases move, a disposable claim must pass write/read and
planned detach/reattach on another physical node, with three healthy replicas.
This is not a test of every unclean-failure case. Keep one application writer;
never force-detach without confirming the previous writer is stopped/fenced.
Control-plane taints also require deliberate workload placement/tolerations.

Initial acceptance passed: a disposable claim was written on `cp1-talos`,
detached after deleting its writer pod, then attached on `cp2-talos` with identical
data. Three healthy replicas occupied distinct physical hosts. The test namespace,
retained PV and Longhorn volume were removed. No production database moved.

Worker maintenance exposed application placement constraints. Certificate
components and FlareSolverr now declare control-plane tolerations in their own
bundles. Verify Homepage's live replica count and disruption budget before a
future worker drain; desired replicas are two. Tolerations alone do not guarantee
safe application failover.

No backup target or schedule is enabled by installation alone. Replication is
not backup, and Longhorn backups are not a live editable NAS config tree. Global
NFS remains disabled and production media settings remain unchanged.
