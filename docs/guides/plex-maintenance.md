# Plex Collections, Artwork And Image Cleanup

Status: the suspended Fleet job and NAS-local ImageMaid definition are deployed.
All 13 UHD movies and both UHD series have styled, badged local posters. The
operator confirmed the movie posters in Jellyfin, completing the UHD trial's
cross-server visual acceptance; the series pilot verified both selected JPEGs
on Plex and Jellyfin against the local files. The next approved run covers the
318 series in Shows. Daily scheduling remains paused and no ImageMaid deletion
is enabled.

## Placement

The recommended split is Kometa as a Fleet-owned Kubernetes CronJob and
ImageMaid as a NAS-local Unraid container/job. Kometa talks to Plex over its API
and never mounts the Plex profile. A 4 GiB `longhorn-appdata` claim holds its
SQLite cache and native working state; bulk clean artwork and poster preimages
use a separate NAS appdata claim. Do not put SQLite on SMB or replicate bulk
poster storage onto Longhorn. SMB claim sizes are not storage quotas.

The bounded export adapter mounts only the existing `Movies-uhd` media subtree
with the already-authorized SMB credential. No share or recursive ownership
change is required. This mount technically permits video writes, so the adapter
must enforce its poster-only path, media identity and drift guards. Neither
Posterizarr nor Jellyfin receives this new writable mount.

ImageMaid walks and can modify Plex's actual metadata tree. The existing Hotio
profile is `/mnt/user/appdata/plex`, containing `Metadata`, `Cache` and
`Plug-in Support` directly. Keeping it on Unraid avoids granting a worker a
read-write SMB mount of that production profile and avoids network-dependent
metadata traversal. Running it in Kubernetes is possible but requires that
extra mount and permission review; it is not an API-only workload.

Both are headless tools: real application icons are appropriate, but do not add
fake WebUI endpoints. Kometa job history/logs and ImageMaid's report/logs are the
operational views. Do not restart Plex or change NAS/GPU/network settings.

## Approved Functional Direction

The operator selected collections plus resolution/rating overlays, with Music
untouched. Target the existing `Movies`, `Shows`, `4K Movies` and `4K Shows`
libraries. Do not enable Radarr/Sonarr additions, searches, library trash
emptying, bundle cleanup or database optimization implicitly.

Use the maintained official images; releases observed during preparation are
Kometa `2.5.4` and ImageMaid `1.2.2`. Resolve immutable image digests and verify
the actual release's CLI/config support before activation: current wiki features
can differ from a stable image.

## ImageMaid Safety

Do not use Plex's `/diagnostics/databases` endpoint for this deployment. The
initial report request timed out after ten minutes and Plex's HTTP service
stalled during that attempt. One explicitly approved Plex-container-only restart
recovered HTTP 200 without changing its container definition, image or mounts.
The exact internal cause is not established; no database repair was performed.
ImageMaid returned exit code 0 despite a Critical Report, so exit status alone is
not report acceptance.

The guarded [report launcher](../../unraid/imagemaid/report.py) uses SQLite's
consistent backup API against the read-only profile mount and hands the result
to ImageMaid's existing-database mode. Diagnostic HTTP fallback is blocked and
all destructive operations are forced off. It checks metadata-table readability,
not full database integrity: stock SQLite cannot perform a whole-Plex
`quick_check` with Plex's custom `collating` tokenizer.

That snapshot passed an isolated test against the actual profile, but the
bounded report-container attempt exceeded its 120-second limit. Reporting is
paused and no deletion inventory has been accepted. Inspect private
`report-error.log` and the current container state before another attempt. Do
not automatically increase limits, restart Plex again, enable `IGNORE_RUNNING`,
or fall back to copying the live database file. Keep the report stopped until
the snapshot can complete safely.

TMDb credentials are in Bitwarden Secrets Manager, not Google Secret Manager:

- `tmdb-api-key`: `e0e521e0-3c99-4084-84c3-b4f6016c561f`
- `tmdb-api-read-access-token`: `1311a600-2ed8-44d9-9072-b4f6016c3adf`

Kometa requires the v3 API key. Both named entries were found, but values were
not printed or committed. A Plex claim token is not a reusable Plex API token.
Tautulli's native ConfigObj parser in its existing pod validated read-only Plex
access. Its existing API credential is privately mirrored as
`plex-maintenance-token`: `d1c34bdb-f269-4723-ae74-b4f601709440`.
Keep runtime secret values out of Git, logs and process arguments.

## Community Style

The requested source is
[bullmoose20](https://github.com/Kometa-Team/Community-Configs/tree/master/bullmoose20).
Its own README warns that the full configuration is advanced and should not be
copied wholesale. Adapt selected collection/default and overlay settings to the
operator's actual libraries, language and credentials; do not copy server URLs,
hardware-specific Plex cache values, placeholder items or destructive operations.

The operator confirmed the exact visual target, retaining Posterizarr for the
styled/textless base posters and Kometa for the overlay layout. The community
revision is `10e76ccedd228a9da20e1856c2dcad2c2fe3fdbe`.

The movie overlays adapt the community badge sequence and positions:
aspect ratio, audio, language flags/count, US content rating, studio, versions,
video format and the right-side three-rating strip. The operator approved
deferring award ribbons and streaming indicators because their native defaults
perform global discovery and IMDb-to-TMDb conversion for non-library titles,
which cannot be bounded by a small Plex library. This is intentionally a partial
style match until those sources have a quota-safe approach. The TV pilot adapts
the series-level layout only; season and episode artwork remain deferred.
Badges must describe actual media and available ratings; do not stamp screenshot
values on every title. Visual acceptance remains part of the bounded trial.

The operator declined paid fonts and selected an open-font adaptation. Use
Arimo Bold for Rotten Tomatoes, Libre Franklin Black for IMDb, and Figtree Black
for TMDb; all are already bundled in the pinned Kometa image. Keep the community
right-side strip and 63/70/70 font sizes. Posterizarr retains Comfortaa for titles.
This preserves the layout, not pixel-identical proprietary typography. Do not
download or redistribute the community commercial-font archive.

The operator added `mdblist-api-key` and `omdb-api-key`. TMDb and MDBList passed
read-only authenticated preflight; OMDb returned HTTP 401 and is disabled rather
than retried. Its credential remains in Secret Manager, but is not delivered to
the workload. The selected direct Rotten Tomatoes/IMDb/TMDb sources do not need
OMDb. Do not copy community mass operations that overwrite Plex's personal/user
rating slots. Native IMDb support uses Kometa Utilities with TSV fallback, not
the OMDb connector.

## Free API Budgets

Each free API has a 1,000-request daily limit. Treat that as a ceiling per
credential shared by all consumers, not a budget available separately to
Posterizarr and Kometa. Persistent provider caches explicitly retain results for
60 days. Keep the existing cache between runs and do not force-refresh it during
onboarding.

The first pilot targeted only `4K Movies` in both applications and ran Kometa
overlays only. The next approved pilot targets only the two series in `4K Shows`;
season posters, episode cards and backgrounds are explicitly disabled in both
the renderer and overlay definitions. Broad collection builders and the main
Movies library are not part of either pilot. Automatic job retries are disabled. Check available
provider usage before and after the trial; count credential preflight calls too.
Quota exhaustion is a stop condition, not a reason to retry or rotate keys.

After the stopped first trial, MDBList reported 10/1,000 requests used; after
the first completed overlay/export run it reported 19/1,000. Do not
infer TMDb's usage from that separate provider's counter. Keep both the manual
trial and daily CronJob suspended while reviewing an uncertain run, and do not
overlap the replacement trial with ImageMaid reporting or removal.

The guarded NAS-local report phase is:

```bash
node scripts/plex-maintenance-run.mjs imagemaid-report
```

It refuses an active artwork job, an unowned/non-exited ImageMaid container, or
an unmanaged config directory. It preserves the stopped owned definition before
replacement. The headless Unraid template has a real upstream icon, no fake
WebUI, restart policy `no`, a read-only Plex profile and a private report config.
It does not schedule cleanup or enable transcoder, trash, bundle or optimize
operations.

Caching and a small trial are not a hard daily request limiter, and longer cache
retention makes ratings less current. Keep automatic scheduling suspended until
the measured trial establishes a safe batch size and the remaining library can
be onboarded across provider reset windows with headroom for other consumers.

Run the minimal credential/inventory check with:

```bash
node scripts/plex-maintenance-run.mjs preflight
```

The successful preparation check authenticated TMDb key/read-token and MDBList,
with two TMDb calls and one MDBList usage call. MDBList reported 0/1,000 used;
usage endpoints need not themselves consume the reported item-request quota.
OMDb's two earlier authentication probes returned HTTP 401; no further OMDb
requests are made. Do not mistake a successful check's call counts for a ledger
of every consumer or the provider's complete daily usage.

## Shared Local Poster Requirement

The operator wants exactly one finished, badged `poster.jpg` beside each movie,
used by both Plex and Jellyfin. Clean working artwork remains outside media
directories so reruns cannot stack overlays. Never configure the finished
sidecar as Kometa's clean input asset. Existing artwork replacement must be
scoped during the bounded trial, with no video/NFO/subtitle deletion.

Both servers support local movie artwork. Plex Movie's Use local assets setting
is already enabled for the trial library; no preference change is needed.
Jellyfin can read sidecars through
its existing read-only mounts; it does not need write access or SaveLocalMetadata
enabled. An already-selected cached image may need a targeted image refresh.

The pinned Kometa release saves a composited temporary image and uploads it to
Plex. The small `run.py` adapter in the config resource then exports Plex's
selected finished JPEG to the exact matched movie or series directory. It requires a
successful native run, an Overlay label, a verified JPEG and unchanged library
membership. It validates every downloaded poster before replacing any local
poster, then atomically replaces only `poster.jpg`, checking preimage hashes.

The current trial inventory is 13 movies, each with one media file in its own
folder and an existing regular `poster.jpg`. The adapter refuses symlinks,
multiple versions/parts, shared directories, missing clean assets and more than
40 movies. Its series path uses one verified series directory and an existing
regular `poster.jpg`. Per-library limits are five UHD series and 318 main Shows;
the 318 limit does not apply to movies. The current job mounts only `Shows`;
other media claims are retained but not mounted. It preserves current posters
and a per-item export journal under
NAS appdata `assetsbackup/local-posters/<run-id>`, outside media directories.
Its isolated native-runtime replacement/refusal tests passed. The first completed
run exported 13 JPEGs and byte-for-byte Plex/sidecar equality passed for all 13.
Visual review then caught the wrong clean base: per-library `asset_directory`
must be nested under `settings` in this release. The corrected run resolved the
native paths, exported all 13 again, and its journal and styled sample passed.
Six items lacked a fetched Rotten Tomatoes value in the native run; do not
invent missing ratings.

Jellyfin initially listed only one UHD movie. One targeted UHD-library refresh
was accepted without cancelling or restarting its existing global scan, which
subsequently reached 52.7%. A later broad read timed out and was not counted as
an automated pass. The operator has since confirmed that Jellyfin displays the
labeled posters, closing the trial's visual acceptance without another refresh
or server restart. This confirmation does not certify full-library scan
completion or an automated per-image hash comparison in Jellyfin. Daily
scheduling, additional-library onboarding and ImageMaid cleanup remain separate
pending work.

## UHD Series Pilot

The operator approved a separate two-series pilot for `Arcane` and
`Game of Thrones` in `4K Shows`. Its writable media mount was limited to
`Shows-uhd`; other media claims were retained but not mounted by that job.
Only the series-level community layout is adapted: no season or episode
`builder_level`, global ribbons or streaming discovery. The status banner uses
bundled Figtree Black in place of the commercial font. Native renderer settings
disable season posters, backgrounds, title cards, direct Plex uploads and cleanup.

The renderer must produce exactly the two expected clean posters before the
export stage can run. Both native configuration validation and synthetic
series-poster replacement/refusal tests passed. The manual run completed and
both sidecars matched the saved outputs, Plex-selected images and Jellyfin-selected
images byte-for-byte, without a Jellyfin refresh. The finished sample passed
visual review. MDBList reported 5/1,000 requests used after the run.

## Main Shows Run

The operator approved processing the main Shows library as a whole after
confirming its size. Read-only preflight verified exactly 318 series, each with
one unique folder under `/media/Shows` and an existing regular `poster.jpg`.
The job mounts only that subtree and uses the same series-level overlays as the
accepted UHD pilot. Seasons, episodes, backgrounds, collections, Movies and
ImageMaid remain excluded.

Native generation must supply all 318 clean base posters before Kometa starts.
If the renderer stops on a provider limit or missing artwork, retained clean
assets/cache can support a later reviewed retry; do not clear them or rotate
credentials to bypass quotas. Export still preserves preimages, checks current
membership and file hashes, validates finished JPEGs, and atomically replaces
only series `poster.jpg` files. A 319th series requires a fresh scope review.
Daily scheduling stays suspended; the manual run requires its own live acceptance.

If the run fails, leave scheduling suspended and inspect the private manifest
before doing anything else. Stop the artwork writer before recovery. Use the
recorded exact paths/hashes to restore only changed local posters from that
run's `.before.jpg` files; restore Plex's prior selected images and remove only
the trial's Overlay labels as needed. Do not replay an unknown partial run or
restore an entire Plex database/profile. Native cache/originals and NAS SSH
recovery remain available independently of the Kubernetes job.

Publishing the scoped source also triggers the existing Technitium SHA-based
full sync and its brief DHCP quiescence. Publication and the one-shot trial need
bounded approval; do not activate the full-library schedule or include unrelated
Jellyfin/downloader edits in the commit. ImageMaid permanent deletion retains
its separate report/review gate.

## Initial Acceptance And Cleanup

Start ImageMaid in `report` mode with the Plex profile mounted read-only and all
other operations explicitly false. Use the guarded consistent SQLite snapshot,
never diagnostic HTTP export, a plain live file copy, or `IGNORE_RUNNING=true`. Inspect
the precise unused-artwork report before changing to deletion. The operator does
not want a recoverable-move workflow; that does not authorize deleting media,
the Plex database, selected artwork, trash contents or bundles.

Use Kometa's supported validation mode before a bounded, reviewed initial run.
`--read-only-config` only prevents rewriting YAML; it does not prevent Plex API
changes. `--tests` also performs real changes for matching test collections.
Acceptance includes successful authenticated connections, the intended new
collections and at least one correct overlay, with unrelated libraries and
current Plex access preserved.

Do not overlap ImageMaid with Kometa, Posterizarr or Plex metadata maintenance.
Time separation alone is insufficient if a run can overrun its window. Use a
single-writer policy and skip cleanup when an artwork writer is active; a failed
or unknown run must not trigger automatic deletion. Keep permanent removal and
unrecoverable operations separately scoped and reviewed.

## References

- [Kometa installation](https://kometa.wiki/en/latest/kometa/install/)
- [Kometa runtime and validation options](https://kometa.wiki/en/latest/kometa/environmental/)
- [ImageMaid operations and safety options](https://github.com/Kometa-Team/ImageMaid)