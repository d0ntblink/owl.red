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

Librespeed has an external PostgreSQL dependency; Tautulli, Seerr and Arr apps
have persistent state requiring application-specific database/storage checks.
qBittorrent's VPN/shared-network behavior is also a migration boundary. Do not
copy their config directories onto SMB and assume SQLite, locking, paths or
VPN isolation remain correct. GPU apps remain on the NAS.

## Longhorn Database Volumes

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
identity. Radarr, Sonarr and Tautulli use the existing NAS DNS name and distinct
published ports while they await their own migrations. Native API bodies omit
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
