# Jellyfin On Unraid

Jellyfin runs independently beside Plex on Unraid. This Fleet bundle owns only
its restricted HTTPS ingress, not the container or its data. Intended WebUI:
`https://jellyfin.owl.red`.

## Runtime And Storage

- Official Jellyfin `12.4.0`, pinned by amd64 digest in
  [the registry](../../ansible/vars/jellyfin.json).
- UID 99 / GID 100, four-CPU and 2 GiB memory limits, no Linux capabilities,
  no privilege escalation, rotating Docker logs and `unless-stopped` restart.
- Config: `/mnt/cache/appdata/jellyfin/config` to `/config`.
- Cache and transcodes: `/mnt/cache/appdata/jellyfin/cache` to `/cache`.
- The five configured Plex library roots are mounted individually, read-only,
  and registered as matching Jellyfin libraries. Plex configuration, downloads
  and transcode directories are not mounted.
- Native HTTP backend binds `10.0.10.5:8096`. Traefik terminates HTTPS and
  permits only management `10.0.10.0/24` and trusted private `10.0.20.0/24`. Backend HTTP remains
  unencrypted on the existing management network; this is not public ingress.
- Owner credentials are in the private Bitwarden item **Jellyfin Access**.
  Jellyfin has its own owner account, independent of Plex and Arr credentials.
- Automatic port mapping is disabled. Jellyfin's application remote-access
  option allows the reverse-proxy connection; it does not create a WAN rule.

The saved Unraid template has a real icon and the DNS HTTPS WebUI button:
[jellyfin.xml](../../unraid/templates/jellyfin.xml). The previous undeployed
Binhex template was backed up privately before replacement. Any old
`appdata/binhex-jellyfin` data is left untouched; official and Binhex profile
layouts are not treated as interchangeable.

### Media Sources

| Library | Jellyfin Type | NAS Source | Container Path |
|---------|---------------|------------|----------------|
| Movies | movies | `/mnt/user/media/Movies` | `/media/Movies` |
| Shows | tvshows | `/mnt/user/media/Shows` | `/media/Shows` |
| Music | music | `/mnt/user/media/Music` | `/media/Music` |
| 4K Movies | movies | `/mnt/user/media/Movies-uhd` | `/media/Movies-uhd` |
| 4K Shows | tvshows | `/mnt/user/media/Shows-uhd` | `/media/Shows-uhd` |

These roots and names were inspected from Plex's actual database using
`SQLITE3_OPEN_READONLY` at
`/mnt/user/appdata/plex/Plug-in Support/Databases/com.plexapp.plugins.library.db`.
Only section/location records were read; Plex's database and configuration
were not modified. This Hotio Plex profile is directly under `/config`, not
an assumed nested `Plex Media Server` directory.

Jellyfin's native API verifies all five names/types/paths, and its process
identity has read/traversal access to the mounted roots. Read-only bind mounts
prevent it from changing original media. `SaveLocalMetadata=false` keeps
metadata in Jellyfin's profile rather than beside the media files.
Library addition uses `refreshLibrary=false`; adding sources does not certify
that a full scan, item indexing or playback has finished.

## Shared GPU

The NVIDIA runtime exposes only GTX 1060 6 GB
`GPU-c94e5971-7089-c23b-b3ab-361af1a1583c`, with compute/video/utility
capabilities. This is the same physical GPU available to Plex. No driver,
Plex container, Plex library or Plex credential was changed or restarted.

Jellyfin's saved encoding configuration selects NVENC with hardware encoding
enabled and `/cache/transcodes` as the temporary directory. H.264, HEVC,
MPEG-2 and VC-1 hardware decoding are enabled; AV1 encoding and HEVC output
encoding are not enabled. The GTX 1060 has no AV1 hardware support.

A generated one-second 720p test pattern was successfully encoded using the
running container's bundled `h264_nvenc` FFmpeg encoder. Plex's container ID
and start time were unchanged before and after deployment and qualification.
This verifies usable NVENC access, not all codec/decode paths, concurrent
stream capacity or a real Jellyfin client transcode. GPU memory/encoder
capacity is shared with Plex and any other GPU consumer, not reserved per app.

## Controller Operations

[jellyfin-run.mjs](../../scripts/jellyfin-run.mjs) uses the existing trusted
Unraid SSH lane and native Docker/Jellyfin APIs. `inspect` is read-only.
Other phases require `JELLYFIN_DEPLOY_ALLOWED=true`:

- `deploy`: refuses an existing container/profile, saves private preimages,
  creates only the new SSD directories/template/container and verifies Plex
  continuity and the declared read-only media mounts.
- `configure`: first-time setup only; creates/reuses the private vault item,
  refuses an initialized server and configures the owner and NVENC.
- `finish`: guarded continuation for completed owner onboarding with remaining
  configuration, using the existing vault item. It does not reset passwords
  and refuses unexpected existing libraries. Do not retry an unknown outcome.
- `template`: backs up and refreshes the owned Unraid template only after
  verifying its image/WebUI and the running NAS-only backend binding.
- `media-plan`: authenticates with the existing owner credential and reports
  missing libraries and required read-only mount changes without changing
  media configuration. It refuses conflicting same-name libraries or mounts.
- `media-apply`: saves private container/library preimages. If mounts are
  missing, it recreates only Jellyfin and returns `librarySetupPending=true`;
  verify health and actual mounts before a second guarded pass creates missing
  library records. Existing matching libraries are preserved, not duplicated.
- `media-verify`: checks all declared library names/types/paths, read-only binds,
  process read/traversal permissions and unchanged Plex identity/start time.
- `qualify`: runs the generated NVENC test and checks Plex continuity. It is
  a bounded GPU workload, not a read-only health check.

Session tokens use Jellyfin's native `Authorization: MediaBrowser ... Token`
header; legacy token-header transport was rejected by the installed version.
No password, owner session token or request body is printed or committed.

The media change preserves Jellyfin's existing profile, owner account, cache,
NVENC configuration and HTTPS settings. Do not rerun first-time `configure` to
add libraries. A media-only rollback restores the exact archived container
mount definition and removes only newly created library records after checking
their identities; it does not remove source files or alter Plex.

## Recovery

Private deployment/template preimages are retained on the NAS under
`/root/.local/state/owl-red/jellyfin-*`, with controller outcomes under
`~/.local/state/owl-red/jellyfin-*`. If new-service rollback is needed, stop
only Jellyfin, remove only its route/DNS/Homepage/Fleet additions, and restore
the exact saved Unraid template after checking current ownership. Keep the new
SSD profile/cache, vault login and all library data unless deletion is
separately approved. Never stop Plex, restart Docker, change GPU drivers or
recursively alter media ownership as part of this rollback.
