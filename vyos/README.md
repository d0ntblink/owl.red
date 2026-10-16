# VyOS Configuration Preparation

This directory contains a recorded baseline and an isolated lab candidate, not a
production router configuration ready to activate. No VM, production PCI device,
router service, client resolver or VLAN was changed by this preparation.

## Image Qualification

[image.json](image.json) pins official Stream `2026.03` by URL, Stream signing key,
SHA-256 and image build revision. Its signature and trusted comment were verified
with Minisign `0.11`. The image's own version metadata reports `2026.03`, build
`1cac4fd63750b0`, built on 2026-03-18.

**Release-specific gap:** the authenticated filesystem contains no Suricata files
or native Suricata CLI schema. The current rolling documentation does describe
that service, but it is not evidence of support in this Stream image. The owner
explicitly chose to keep Stream and defer onboard Suricata (2026-10-16). Suricata
is therefore not a core router cutover prerequisite. Do not silently change to
rolling or install ad hoc router packages; introduce IDS/IPS later as its own
version-qualified change. The image still needs the core qualification below.

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
  Plex DNAT/SNAT policy. It does not implement Plex reflection or production
  IPv6 delegation; IPv6 is closed in this lab, not silently disabled for the
  future production replacement.
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
parses the generated candidate, checks expected policy paths and verifies all
105 generated command paths against that image's CLI schema. The library needs
the controller's compatible libc, libm and libpcre2-8 runtime libraries.

Without `VYOS_NATIVE_ROOT`, the native check reports a skip; that is not a pass
for release compatibility. Even the full check proves grammar and schema paths,
not native service validators, a successful boot/commit, packet forwarding,
DHCP offers, WAN/IPv6 operation or persistence after a real native save.

## Before Production Preparation Can Complete

Resolve the paused OPNsense Save and agree the rollback/running prefix. Refresh
the affected WAN/IPv6 identities, current leases/exclusions, recursive/local DNS
behavior, automatic rules and Plex reflection. Then qualify native boot/firewall
ordering and the real hardware path. Suricata remains explicitly deferred, not
silently replaced by a container or a rolling build. No production renderer or
deployment is enabled merely by editing the image qualification booleans.