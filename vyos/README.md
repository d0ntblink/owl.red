# VyOS Configuration Preparation

This directory contains a recorded baseline and an isolated lab candidate, not a
production router configuration ready to activate. No VM, production PCI device,
router service, client resolver or VLAN was changed by this preparation.

## Image Qualification

[image.json](image.json) pins official rolling `2026.10.16-0024-rolling` by its
dated release URL, rolling signing key and SHA-256. Its signature/trusted comment
were verified with Minisign `0.11`, and the downloaded digest matches the
official GitHub asset digest. Image metadata reports that exact version, built
on 2026-10-16, build UUID `ae7b6104-8d03-4b05-952b-abd3c725e52b`; its embedded
Git revision is empty, so no commit identity is invented.

The owner explicitly selected rolling after the previously inspected Stream
`2026.03` lacked Suricata. The authenticated rolling filesystem contains its
binary, native CLI schema and configuration implementation, plus native remote
firewall groups. It contains no CrowdSec files. Do not confuse that absence
with CrowdSec being unsupported as an external service or claim it is bundled.

Rolling is a development release. Keep the exact pin, qualify changes before
upgrading, and retain the previous working image and private configuration.
Do not track `latest`, auto-upgrade nightly or install unreviewed router packages.

Native boot, semantic commit validation and boot-time firewall ordering have not
been qualified. The manifest records those limits separately from successful
signature verification. Follow [ADR 022](../docs/decisions/022-vyos-router-replacement.md)
and [Phase 0.6](../ROADMAP.md#06-stage-and-accept-the-vyos-replacement).

## Configuration Ownership

- [baseline.yml](baseline.yml) records whitelisted non-secret fields from the
  retained 2026-10-16 pre-Save OPNsense export, plus a separate synthetic lab
  profile. It is not a fresh runtime survey. Preserve the eight recorded
  reservations/client IDs and their existing names, including naming drift;
  this is not a second owner of the final Technitium registry.
- [config.boot.j2](config.boot.j2) renders native VyOS grammar for the lab: DHCP
  WAN, `192.0.2.0/24` LAN, Kea DHCP `.100-.199`, recursive DNS, a sample static
  hostname, NTP, key-only LAN SSH, explicit IPv4/default-deny logging and sample
  Plex DNAT/SNAT policy. It includes passive native Suricata capture on the
  synthetic LAN, address/port variables and EVE alert/anomaly events to syslog.
  It does not implement Plex reflection or production IPv6 delegation; IPv6 is
  closed in this lab, not silently disabled for the future production replacement.
- [vyos-render.yml](../ansible/playbooks/vyos-render.yml) runs only on localhost,
  refuses production profiles, fixes the lab identities and writes a private
  candidate outside Git. It has no SSH/API router connection, native commit,
  Proxmox operation or PCI transfer. No external Ansible collection is needed.
- Terraform will own a separate replacement VM. Native candidate deployment,
  comparison/drift removal, commit-confirm/confirmation/save and recovery remain
  future work in the single Ansible configuration lane.

## Render Locally

Follow [controller requirements](../docs/guides/controller-setup.md#vyos-image-and-offline-preparation).
Use the existing Ansible venv and the controller's Ed25519 public `.pub` file.
The default output is `~/.local/state/owl-red/vyos-lab/candidate.config`, directory
mode `0700` and file mode `0600`.

```bash
ANSIBLE_CONFIG="$PWD/ansible/ansible.cfg" \
  .venv/bin/ansible-playbook -i localhost, ansible/playbooks/vyos-render.yml
```

An optional `-e vyos_public_key_file=/absolute/path/to/controller.pub` selects a
different public key; never supply the private key. Output overrides must remain
under `~/.local/state/owl-red/`. Repeated rendering is idempotent. Production
profiles, repository output and non-Ed25519 bootstrap keys fail before rendering.

Do not use the lab candidate as a production boot file. It uses synthetic MACs,
the documentation subnet and no production DHCP reservations or live IPv6 setup.

## Layered Security Requirements

These are requested capabilities and qualification tasks, not deployed services:

- Technitium: selected DNS ad/tracker and malicious-domain lists, with source,
  allowlist, refresh and false-positive handling in Git. Final client DNS
  enforcement still waits for the approved resolver handoff; do not add early
  DNS interception or overrides. DNS filtering is not full traffic inspection
  and cannot reliably remove ads served from the same domains as content.
- VyOS: curated IP/CIDR feeds such as Spamhaus DROP and a reviewed FireHOL
  selection. Domain lists and mail DNSBLs are not interchangeable IP feeds.
  Define traffic direction, IPv4/IPv6 coverage, protected infrastructure,
  feed overlap, size, fetch validation, staleness and rollback. FireHOL feeds
  containing bogon/private ranges must not become indiscriminate LAN deny rules.
- Suricata: qualify native IDS first. On a real lab boot, fetch/maintain rules
  through the supported native mechanism, validate rule variables and service
  configuration, and prove a controlled alert reaches the logs. Empty rules or
  a configured service are not coverage. The current capture block has no inline
  interface pair or NFQUEUE rule; new IPS blocking requires a separate decision.
- CrowdSec: qualify an external Security Engine/LAPI, actual log acquisition,
  parsers/scenarios and a remediation component. A candidate is a private
  [Blocklist Mirror](https://docs.crowdsec.net/u/bouncers/blocklist-mirror/)
  consumed by native VyOS remote groups: VyOS owns firewall policy, not a second
  agent rewriting nftables. Pin service versions and declare ownership before
  deployment. Test IPv4/IPv6 decisions, expiry/revocation, valid empty feeds,
  failed refresh, cache staleness and administrative exclusions. Native remote
  groups retain cached data on fetch failure, so expiry is not guaranteed by
  polling alone. Decide a bounded stale-data policy before automatic blocking.
- Tunnelled web traffic: the router sees connector/Cloudflare peers, not the
  original HTTP visitor. Use verified real-client-IP logs and a compatible
  proxy/Cloudflare remediation point, never a blanket router ban on those peers.
  Scope secrets and API access; review Cloudflare plan/quota/failure modes and
  preserve independent local access. Do not expose LAPI publicly to make this work.
- Anubis: optional future anti-bot evaluation for anonymous/public browser
  endpoints only if the chosen Cloudflare protections leave a demonstrated need.
  Access-authenticated private applications may not need it; Tunnel alone is
  transport, not anti-bot protection. Do not break APIs/webhooks/automation or
  turn another browser challenge into a router/Zero Trust migration gate.

Keep detection, visibility and enforcement distinct. None of these layers replaces
mail-service spam filtering or the base VLAN/firewall isolation policy. CrowdSec
decisions and downloaded lists are dynamic data, not a second configuration
authority; their consumption must remain within the reviewed VyOS-owned rules.

## Focused Checks

[The tests](../scripts/vyos-config.test.mjs) run the actual local Ansible playbook,
generate an ephemeral test SSH key and clean their private fixture directory.
They require Node.js 20+, Python with Ansible/PyYAML, and OpenSSH `ssh-keygen`.
`ANSIBLE_PLAYBOOK` and `PYTHON` can override the default repository venv paths.

For the full native-path check, first create an extraction from the pinned,
signature-verified image. With the documented controller tools on `PATH`:

```bash
install -d -m 0700 "$HOME/.local/state/owl-red" && \
IMAGE_DIR="$(mktemp -d "$HOME/.local/state/owl-red/vyos-image-XXXXXX")" && \
ISO="$IMAGE_DIR/$(jq -r .filename vyos/image.json)" && \
curl --fail --location "$(jq -r .url vyos/image.json)" --output "$ISO" && \
curl --fail --location "$(jq -r .signature_url vyos/image.json)" --output "$ISO.minisig" && \
minisign -Vm "$ISO" -x "$ISO.minisig" -P "$(jq -r .minisign_public_key vyos/image.json)" && \
[[ "$(sha256sum "$ISO" | awk '{print $1}')" == "$(jq -r .sha256 vyos/image.json)" ]] && \
bsdtar -xf "$ISO" -C "$IMAGE_DIR" live/filesystem.squashfs && \
unsquashfs -no-progress -d "$IMAGE_DIR/native-parser" \
  "$IMAGE_DIR/live/filesystem.squashfs" \
  usr/lib/libvyosconfig.so.0 \
  usr/lib/python3/dist-packages/vyos/configtree.py \
  usr/share/vyos/version.json \
  opt/vyatta/share/vyatta-cfg/templates && \
VYOS_NATIVE_ROOT="$IMAGE_DIR/native-parser" node --test scripts/vyos-config.test.mjs
```

Stop if signature/hash verification or extraction fails; do not continue with
unverified files. The native check loads the image's real configuration parser
and `libvyosconfig.so.0` without modifying them, compares image version/revision,
parses the generated candidate, checks expected policy/Suricata paths and verifies
all generated command paths against that image's CLI schema. The library needs
the controller's compatible libc, libm and libpcre2-8 runtime libraries.

Without `VYOS_NATIVE_ROOT`, the native check reports a skip; that is not a pass
for release compatibility. Even the full check proves grammar and schema paths,
not native service validators, a successful boot/commit, packet forwarding,
DHCP offers, WAN/IPv6 operation or persistence after a real native save.

## Before Production Preparation Can Complete

Resolve the paused OPNsense Save and agree the rollback/running prefix. Refresh
the affected WAN/IPv6 identities, current leases/exclusions, recursive/local DNS
behavior, automatic rules and Plex reflection. Then qualify native boot/firewall
ordering, actual IDS rule loading/events and the real hardware path. CrowdSec
remediation and new IP/DNS blocking need their own scoped qualification and
approval; no production renderer or deployment is enabled merely by editing the
image qualification booleans.