# Guest Portal Gateway Staging

The owner selected a small Debian VM with native openNDS rather than custom
session/firewall enforcement. The old OpenWrt portal is retired and its local
checkout has been removed. Its reusable artwork and new presentation live in
[the portal directory](../../../ansible/files/guest-portal/README.md), with the
[original theme](../../../docs/reference/guest-portal-original-theme.txt)
retained only as a copy reference. No portal runs on the AP.

## Current State

- VM `104`, `guest-portal-stage.owl.red`, on `edge`.
- One vCPU, 768 MiB RAM, 8 GiB local disk; protected, automatic boot disabled.
- Debian 13 genericcloud build `20261021-2638`, SHA-512 pinned in this root.
- Debian openNDS `10.3.1+dfsg-1`, with native nftables and dnsmasq dependencies.
- No production bridge, VLAN, PCI device or guest DHCP authority is attached.
- Bootstrap uses QEMU user networking and edge-loopback SSH port `22104` only.
- Strict SSH host-key pin: `~/.local/state/owl-red/guest-portal-known_hosts`.
- openNDS and dnsmasq are stopped/disabled; IPv4 forwarding is off after tests.

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

## Native Qualification

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

## Production Gates

The guest network remains disabled. Before a separately reviewed cutover:

- Choose and verify the guest-facing VLAN and isolated transit path to VyOS.
  Remove any alternate direct guest-to-VyOS bypass path.
- Reconcile the single guest DHCP/DNS authority. The dormant Technitium guest
  scope must not compete with gateway dnsmasq; the lab does not decide ownership.
- Prove that startup, daemon failure/restart and shutdown cannot open access.
  A listener or a systemd active state is not sufficient readiness.
- Test session expiry and termination of already-established connections;
  revocation of new connections alone does not prove either behavior.
- Explicitly block guest IPv6 unless equivalent enforcement is qualified.
- Configure valid portal HTTPS and supported captive-portal discovery/CAPPORT,
  without intercepting arbitrary HTTPS or exposing administration endpoints.
- Port the requested text/concept into native portal templates and test a real
  guest device before enabling the SSID generally.
- Preserve a bounded inverse for guest-only router, DHCP/DNS and AP changes.
  Failures must leave guests blocked while management/private/IoT stay unchanged.

There is no production portal URL or active guest access yet. The bootstrap
interface is staging-only, not the final production transit/management design.