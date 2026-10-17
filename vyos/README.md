# VyOS Router And Permanent Lab

VyOS VM 103 is the accepted production router `edge.owl.red`, serving
`10.0.10.1/24` with the original WAN/LAN PCI devices. VM 102 is the separate
permanent `edge-lab.owl.red` (2 vCPU, 4 GB RAM), reachable only through Proxmox's
loopback SSH forward. The old router VM 100, its 64-GB virtual disk and unused
installer ISO were explicitly deleted after acceptance. Its provider/migration
tooling and host-local cutover recovery directories are retired. Future recovery
uses pinned VyOS media, a private boot-config backup and PVE console access.

The final 2026-10-17 handoff passed native IPv4/default IPv6 routing, delegated
LAN IPv6, verified external HTTPS, DNS, core service and management checks plus
both transaction-correlated `/24` DHCP observation captures. Earlier failed
attempts and recovery remain recorded in [the roadmap](../ROADMAP.md).
The active Terraform defaults now match production; a no-refresh plan against
the state just written by the accepted apply reports no changes.

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

Native boot and core runtime acceptance are complete. A boot guard keeps IP
application traffic closed until both native default-deny families exist, with
only necessary DHCP/IPv6 control traffic permitted early. This is a mitigation,
not an exhaustive packet-level boot-window certification. IDS rule loading and
real alert coverage remain separate qualification work. Follow
[ADR 022](../docs/decisions/022-vyos-router-replacement.md)
and [Phase 0.6](../ROADMAP.md#06-stage-and-accept-the-vyos-replacement).

## Configuration Ownership

- [baseline.yml](baseline.yml) holds native production host mappings/generic NTP
  upstreams and a separate synthetic lab profile. Existing hostnames are retained
  without an incidental rename. DHCP lease-preservation inputs remain private;
  this is not a second owner of the final Technitium registry.
- [config.boot.j2](config.boot.j2) renders native VyOS grammar for the lab: DHCP
  WAN, `192.0.2.0/24` LAN, Kea DHCP `.100-.199`, recursive DNS, a sample static
  hostname, NTP, key-only LAN SSH, explicit IPv4/default-deny logging and sample
  Plex DNAT/SNAT policy. It includes passive native Suricata capture on the
  synthetic LAN, address/port variables and EVE alert/anomaly events to syslog.
  The production profile adds the current lease-preservation mappings, Plex
  reflection, DHCPv6-PD and RA. WAN `ipv6 address autoconf` is required by this
  image to accept the RA-derived default route while forwarding remains enabled.
  IPv6 is closed only in the synthetic lab profile, not in production.
- [vyos-render.yml](../ansible/playbooks/vyos-render.yml) runs only on localhost,
  refuses production profiles, fixes the lab identities and writes a private
  candidate outside Git. It has no SSH/API router connection, native commit,
  Proxmox operation or PCI transfer. No external Ansible collection is needed.
- [The Terraform root](../terraform/proxmox/vyos-vm/main.tf) owns the lab and
  separate production VM; Ansible owns native configuration and bootstrap
  orchestration. Completed migration-only runners are removed. Preserve one
  config owner and use native candidate/confirmed-commit/save for future work.
- [Credential references](credentials.json) identify separate lab/production
  console accounts in Password Manager and Secrets Manager. Passwords and rendered
  encrypted-password configurations stay outside Git. Automation uses the existing
  controller SSH key with pinned host keys; the dashboard receives no write keys.

Production bootstrap inputs live at
`~/.local/state/owl-red/vyos-production/render-input.json` (owner-only), not a
hard-coded migration-run directory. The production renderer writes a candidate,
not a live deployment. Refresh lease-preservation/WAN inputs before any future
replacement; never replay an old snapshot over the running gateway.

Preflight requires a private copy of the current saved native configuration at
`~/.local/state/owl-red/vyos-production/config.boot` (directory `0700`, file
`0600`). It contains recovery credentials and must not enter Git or chat.

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

## First VLAN Lab Qualification

[vyos-vlan-lab.yml](../ansible/playbooks/vyos-vlan-lab.yml) applies the
[source profile](baseline.yml)'s conservative VLAN-20 overlay only to VM 102
through its existing pinned loopback connection. It requires
`-e vyos_vlan_pilot_apply_allowed=true`; it refuses production identities,
endpoints and changed allocations before connecting. No VM lifecycle or switch
operation is included. It saves a mode-`0600` native boot-config preimage in a
fresh private controller directory before committing.

The isolated lab has `eth1.20` at `10.0.20.1/24`, DNS/ping access to that gateway,
scoped WAN masquerade and forwarding with nonpublic destinations denied. The
original lab management interface is unchanged. Native commit/save, unchanged
configuration on rerun, compiled rule IDs and a synthetic DNS query pass.
No pilot DHCP scope or IPv6 delegation is enabled. This is not the final
VLAN-20 application-service allowlist or a production promotion workflow.

## Accepted Wired VLAN Pilot

VLAN 20 is now accepted on the bounded cp1-to-router path. Native `eth1.20` is
`10.0.20.1/24`; switch VLAN 20 has only ports 2/25 and MAC learning enabled.
Existing native management/PVIDs and operator port 22 remain unchanged. The
temporary static client was removed after passing gateway-MAC/ping, DNS, verified
HTTPS and denials for NAS HTTPS/router SSH. All four Kubernetes nodes were Ready
and cp1 management was unchanged before confirmation. IPv6 and DHCP were not
tested or enabled for this pilot; no real clients or AP/SSID paths moved.

[vyos-vlan20.yml](../ansible/playbooks/vyos-vlan20.yml) is the production
`trial`/`confirm`/`rollback` owner. It consumes the same
[command template](../ansible/templates/vyos-vlan20-commands.j2) as the lab and
uses `commit-confirm 5 no-prompt`, with private recovery preimages. Confirmation
and boot-config save follow acceptance, never precede it.
[swos-vlan20.yml](../ansible/playbooks/swos-vlan20.yml) and its
[module](../ansible/library/swos_vlan20.py) preserve the complete preimage,
refuse unrelated drift and change only the reviewed row's membership/learning.
Both require `vlan20_pilot_allowed=true` and a fresh private
`vlan20_recovery_directory` under `~/.local/state/owl-red/vlan20-wired-*`.

The [probe](../ansible/files/vlan20-probe.sh) runs only as root on cp1, using
a temporary tagged namespace on physical `nic0`, not a new bridge. It cleans up
on exit. Earlier failed trials were rolled back; coordinated capture identified
disabled switch learning as the return-path blocker. Keep its exact accepted
state in Git; do not reset the active overlay by loading the bootstrap candidate.
Evidence is `~/.local/state/owl-red/vlan20-wired-n8rR1M`.

This remains a pilot, not the final VLAN-20 service allowlist or full switch
segmentation. Do not apply the full switch target map or transfer Technitium
authority as part of it. Remaining DHCP/client, AP/SSID and IPv6 work has separate
acceptance gates.

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

## Remaining Work

Finish the small, repeatable configuration promotion workflow from lab to
production, the read-only diagnostic view, application-specific NAT/reflection
checks and native IDS rules/events. VLAN activation and the final Technitium
DNS/DHCP handoff are still separate changes. CrowdSec, reputation feeds and new
automatic blocking need their own scoped qualification/approval; do not infer
those protections from a configured service or the successful router replacement.