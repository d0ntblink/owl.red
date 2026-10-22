# Guest Portal Gateway

The owner selected a small Debian VM with native openNDS rather than custom
session/firewall enforcement. The old OpenWrt portal is retired and its local
checkout has been removed. Its reusable artwork and new presentation live in
[the portal directory](../../../ansible/files/guest-portal/README.md), with the
[original theme](../../../docs/reference/guest-portal-original-theme.txt)
retained only as a copy reference. No portal runs on the AP.

## Current State

- VM `104`, `guest-portal-stage.owl.red`, on `edge`.
- One vCPU, 768 MiB RAM, 8 GiB local disk; protected, native automatic boot enabled.
- Debian 13 genericcloud build `20261021-2638`, SHA-512 pinned in this root.
- Debian openNDS `10.3.1+dfsg-1`, with native nftables and dnsmasq dependencies.
- Guest NIC `02:6f:77:30:03:04` attaches to `vmbr0v30` and `br-guest`, address `10.0.30.1/24`.
- Transit NIC `02:6f:77:31:01:04` attaches to private, portless `vmbr31`, address `172.31.30.2/30`.
- VyOS `eth3` is `172.31.30.1/30`; guest traffic is routed, with NAT only upstream on VyOS.
- VyOS's old `eth1.30` gateway is disabled; its static guest route uses the private transit.
- Technitium owns DHCP/DNS on every VLAN; gateway dnsmasq is DNS-only, never DHCP.
- QEMU bootstrap networking and edge-loopback SSH port `22104` remain for recovery, not guest forwarding.
- Strict SSH host-key pin: `~/.local/state/owl-red/guest-portal-known_hosts`.
- openNDS, DNS-only dnsmasq, lease refresh timer and guest NTP are enabled; forwarding follows native openNDS lifetime.
- `silence of the lans` is enabled on 2.4 GHz only, isolated on VLAN 30.
- The bridge-only AP was clean-reset/upgraded to OpenWrt 25.12.6; private 5 GHz uses the approved channel 36. See the [Wi-Fi implementation guide](../../../docs/guides/wifi-architecture.md) for all SSIDs, components and rules.
- Private Wi-Fi remains on 5 GHz. The owner approved disabling its 2.4 GHz BSS to keep radio0 at three BSSes: guest, local IoT and cloud IoT.
- Local and cloud IoT are 2.4 GHz only. The extra cloud-IoT 5 GHz BSS was retired; the Shield moved to private VLAN 20 at its preserved `10.0.20.100` address.

This root owns only the image, seed ISO and new VM. It does not manage VyOS,
the AP, Technitium, switch ports or any existing VM. Do not apply another root
to deploy this gateway.

## Controller And Bootstrap

The repository Python environment needs Ansible/PyYAML and `pycdlib==1.14.0`.
The existing Terraform credential wrapper supplies private Proxmox credentials.
Do not put credentials in variable files or source private environment files
through shell expansion.

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg .venv/bin/ansible-playbook \
  -i localhost, ansible/playbooks/guest-portal-bootstrap.yml

scripts/terraform-run.sh -chdir=terraform/proxmox/guest-portal plan \
  -var="seed_image_path=$HOME/.local/state/owl-red/guest-portal-bootstrap/seed.iso"
```

The bootstrap creates a standard NoCloud ISO privately on the controller and
does not rebuild unchanged inputs. Its SSH user is `owl-ansible`, using the
existing controller public key with password authentication disabled. Establish
the SSH host-key pin through the trusted Proxmox host before using the inventory
entry; do not disable strict checking.

Review a saved create-only plan before first apply. The accepted initial plan
added only three resources. State and saved plans remain private and ignored.

## Historical Staging Qualification

Do not run staging or full preparation on this serving gateway without an explicit
maintenance window. Both playbooks now refuse the live attachment/daemon by default.
The following command describes the original isolated qualification, not routine
production verification. It stops forwarding services when maintenance is approved.

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg .venv/bin/ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/guest-portal-stage.yml \
  --private-key "$HOME/.ssh/id_ed25519_owl_ansible" \
  -e portal_qualification_allowed=true
```

Without the opt-in, the playbook installs the pinned package and keeps services
stopped. The test opt-in creates only a disposable bridge and client namespace
inside VM 104, obtains a genuine dnsmasq lease, and exercises native `ndsctl`
authorization. It does not modify the production guest scope or AP.

Accepted result: `NATIVE_PORTAL_GRANT_REVOKE_PASS`. Unauthenticated HTTPS was
denied, HTTP discovery returned `307`, native authorization allowed HTTPS, and
native revocation denied new HTTPS connections. Cleanup stopped both services,
removed the namespace/bridge and restored IPv4 forwarding to zero.

The HTTP listener opens before firewall setup completes. Readiness therefore
requires a fresh native control socket and the installed forwarding reject rule,
not merely an open TCP port. This Debian build reads UCI-style settings from
`/etc/config/opennds`; the legacy configuration path is not authoritative.
Its client-allocation check requires a real lease, not a fabricated lease file.

Failure diagnostics under VM `/var/tmp/owl-portal-qualification-*` are private;
do not dump or commit native session data or generated authentication material.

## Published Portal App

Presentation and its TypeScript FAS integration are owned by the public
[owl.red-guest-captive-portal repository](https://github.com/d0ntblink/owl.red-guest-captive-portal),
not this Terraform root. No PHP is used by that app. Its GitHub Actions workflow
builds and tests the container, verifies a nonroot/read-only runtime, and publishes
`d0ntblink/owl.red-guest-captive-portal` to Docker Hub using the GitHub-purpose
Docker Hub token held in Bitwarden Secrets Manager and an encrypted Actions secret.

Deployed build/publication revision: `efebef9a591ea6bcd4692fb323cb406c4f292bcc`.
Public image digest:
`sha256:7f12c8a578f2f050f099ce5fa05ac0aa63c0d604cfe00d3dd8736faabb4756e2`.
The mauve accent is Catppuccin Mocha `#cba6f7`; fonts and layout are unchanged.
Do not automatically deploy `latest` or activate a guest scope on image publication.

The app's nine tests include native Node-name/hash/framing/acknowledgment contracts,
production HTTP consent, foreign-origin rejection and untrusted Authmon denial. Desktop/mobile rendering and local artwork were
checked. A sandboxed integrated browser submits `Origin: null`; consent correctly
rejects that origin rather than bypassing CSRF checks for a preview.

## Accepted Production Path

Portal: <https://guest.owl.red>. Certificate renewal uses the existing cert-manager
issuer. Native Authmon has a source-restricted route; other guests cannot forge
its proxy header. Traefik-to-backend mutual TLS prevents direct pod access from
bypassing this boundary. Other administrative hosts on the shared ingress IP are
denied to VLAN 30 clients.

The production acceptance fixture obtained a genuine Technitium lease, proved
pre-authentication internet denial, followed real HTTPS consent through native
Authmon, verified internet access, revoked an established TLS connection, and
verified private/admin and IPv6 denial. It released its lease and removed its
namespace. The result is `PRODUCTION_GUEST_DHCP_HTTPS_CONSENT_REVOKE_PRIVATE_IPV6_PASS`.

The dedicated DHCP-view-only token lives in Bitwarden, with a private gateway
copy. A native timer refreshes facts every 10 seconds; kernel set entries expire
after at most 30 seconds. Pre-offload checks cover both routed directions.
Native expiry, daemon failure/restart and stale-cache denial also passed isolated
qualification. Authmon readiness includes its completed startup stale-request
clear, not merely a TCP listener or control socket.

Actual guest/private/IoT BSS bridge bindings were verified before confirmation.
A handset captive-browser test and RF/coverage walk remain onsite checks; no
workstation Wi-Fi association was changed to claim those tests. DHCP option 114
is not advertised without a truthful, client-specific CAPPORT endpoint.

## Recovery And Lifecycle Caveats

Private preimages and phase diagnostics are under controller
`~/.local/state/owl-red/guest-cutover-Bgjxae`. They contain credentials/session
material and must not be dumped or committed. VyOS handoff used native confirmed
commits; the gateway fail-closed trial timer was canceled only after acceptance.

The pinned bpg provider unexpectedly restarted VyOS during a NIC-only update even
with `reboot=false`. The restart was disclosed and the owner approved continuation
using the attached NICs. No further router lifecycle applies were used. Do not
assume that flag prohibits a provider-driven restart. A targeted router plan now
reports no changes. VM 104's native API confirms `onboot=1`; the provider still
reports a boot-flag-only discrepancy. Do not apply it blindly.

One explicitly approved AP reboot recovered the firmware after failed live
multi-BSS trials. Four BSSes on radio0 failed to start; the approved three-BSS
allocation is the accepted source. Do not re-enable private radio0 or guest radio1
without a new radio-capacity qualification. No firmware was flashed or factory
reset performed.