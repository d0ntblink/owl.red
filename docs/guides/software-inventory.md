# Software Inventory For Vulnerability Monitoring

The initial workflow collects observed running Kubernetes/NAS containers,
Kubernetes/Talos node versions, Unraid/Docker versions and native Proxmox package
versions. It generates cached image SBOMs and a private input document for a
future personal vulnerability news feed. No news feed, CVE applicability engine,
dashboard, automatic patching or IoT/network probing is enabled by this workflow.

## Collection And Automation

[The collector](../../scripts/software-inventory.mjs) uses existing authenticated
read-only commands. It selects fields rather than exporting pod specifications,
runtime container environments, mounts or Kubernetes Secrets. A native `flock`
prevents overlapping manual and scheduled runs. Reports are written atomically
outside Git under `~/.local/state/owl-red/software-inventory/`, with owner-only
permissions:

- `inventory.json`: observed platforms, running containers and unique immutable
  image identities, with deployment associations and collection time.
- `feed-input.json`: component names, versions, ecosystems, PURLs, unverified CPE
  candidates, cataloger provenance and SBOM timestamps linked to current assets.
- `last-attempt.json`: success/failure of the latest collection attempt. A failed
  attempt does not replace the previous inventory/feed; consumers must check
  this status and timestamps rather than present old data as current.
- `sboms/<Syft version>/`: native Syft and CycloneDX reports cached by image digest.
  Native reports can contain image-build metadata and package paths; keep them
  private and do not send whole reports to an AI or publish them.

Run with the controller's existing tools:

```bash
node scripts/software-inventory.mjs collect
node scripts/software-inventory.mjs refresh
```

`collect` reads metadata only. `refresh` additionally scans up to eight uncached
images, sequentially, through their registries. It never mounts a live filesystem
or shares the NAS Docker socket with the controller. Each scan has a three-minute
timeout, two cataloger workers, a 512 MiB maximum layer size and a 1 GiB Go soft
memory target. It stops before another scan if less than 10 GiB is available.
These are workload limits, not a hard aggregate disk/memory sandbox.

Successful immutable-image SBOMs are reused. Failed images retain a private error
log and have a 24-hour retry cooldown; they do not starve other images. Pending
and failed images stay explicit in the feed input. Runtime-installed packages,
bind-mounted apps, unidentified binaries and firmware are not implied coverage.
Container names and mutable tags are never converted into guessed CPEs.

## Controller Requirements

- Node.js 18.15+; tested with the installed system Node 18.19.1 and Node 24.
- Existing `kubectl` access, strict-host-key OpenSSH and the existing controller
  SSH identity. The NAS read uses its existing PHP/cURL Docker API support;
  Proxmox reads use `pveversion --verbose`. No new remote agent is installed.
- The repository `.venv/bin/python` with PyYAML for projecting Proxmox targets
  from the existing Ansible inventory. The collector does not read `env.secret`
  or fetch Bitwarden values; kubectl and SSH use their existing authentication.
- Native `flock`, sufficient temporary disk space and registry connectivity.
- Syft **1.56.0**, installed at
  `~/.local/share/owl-red/tools/syft/1.56.0/syft`.
  [Upstream Linux amd64 release](https://github.com/anchore/syft/releases/tag/v1.56.0),
  archive SHA-256:
  `1c2493cfcf52d3367d6cb25780d9190c111c2219c34c820574c43e8bae15c528`.
  Verify the archive against the official checksum list before extracting only
  the binary; keep the verification record beside it. Do not pipe an installer
  into a privileged shell or automatically follow newer releases.

[The Syft configuration](../../ansible/vars/software-inventory-syft.yml) disables
update checks, external enrichment and unpinned Python-version guessing; registry
TLS verification remains enabled. Registry access is anonymous initially. Do not
copy broad Docker/Bitwarden credentials into a scanner to bypass a failed image.

## Hourly Controller Timer

The source [service](../../scripts/software-inventory.service) and
[timer](../../scripts/software-inventory.timer) are installed as user units named
`owl-software-inventory.service` and `owl-software-inventory.timer`. The timer
runs hourly with up to five minutes of jitter and missed-run catch-up. It uses
`/usr/bin/node`, `~/owl.red` and `~/.kube/config`; review those paths when moving
the checkout. It runs under the existing controller account and its credentials,
not an isolated or dedicated least-privilege scanner identity.

After preparing the prerequisites, install the user units from `~/owl.red`:

```bash
mkdir -p "$HOME/.config/systemd/user"
ln -s "$PWD/scripts/software-inventory.service" "$HOME/.config/systemd/user/owl-software-inventory.service"
ln -s "$PWD/scripts/software-inventory.timer" "$HOME/.config/systemd/user/owl-software-inventory.timer"
systemctl --user daemon-reload
systemctl --user enable --now owl-software-inventory.timer
```

If either link already exists, inspect its ownership and target; do not force
an overwrite. Starting the service below runs one bounded refresh immediately.

```bash
systemctl --user status owl-software-inventory.timer
systemctl --user start owl-software-inventory.service
journalctl --user -u owl-software-inventory.service -n 20
systemctl --user disable --now owl-software-inventory.timer
```

This is WSL/controller automation, not an always-on Kubernetes service. It cannot
collect while Windows/WSL is stopped; catch-up occurs when the user manager runs
again. Disabling the timer leaves an active refresh running. No host lingering,
boot, firewall, service-account or cluster permission changes are made implicitly.

## Future Personal Vulnerability Feed

CPE candidates are tool-produced naming hypotheses, not reviewed NVD dictionary
matches or proof of vulnerability. PURLs and exact distro/package versions remain
first-class identities. Preserve unresolved products rather than force a CPE.

The later feed should consume `feed-input.json` and collection status, flag data
older than two hours, and join only current deployed components to vulnerability
sources. Correlate candidate CPEs carefully; use distro/vendor advisories for
backports and keep reviewed mappings/exceptions separately. Deduplicate alerts,
track fixes and retirement, and prioritize exploitation/exposure rather than
report every scanner match as an incident. Add firmware/endpoint collection and
the actual news-delivery channel as separately scoped follow-ups.

## Focused Checks

```bash
node --test scripts/software-inventory.test.mjs
```

Tests cover immutable identities, privacy projections, image deduplication,
native version parsing and explicit unverified CPE candidates. Native image
contents still require an actual successful Syft run; a metadata-only inventory
does not establish SBOM or vulnerability coverage.