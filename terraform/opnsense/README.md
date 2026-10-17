# terraform/opnsense — OPNsense config as code (Terraform-primary lane)

**Retired historical guide (2026-10-17).** The old VM, disk, provider/module,
draft resources, wrapper and migration-only tests/playbooks are removed. This
README is retained as requested documentation, not a runnable Terraform root.
Do not execute the old examples against `.1`, which is now VyOS. Current
ownership is in [ADR 022](../../docs/decisions/022-vyos-router-replacement.md)
and [the change guide](../../docs/guides/changing-owl-red.md).

Manages `edge.owl.red` (OPNsense, `https://10.0.10.1`) firewall / DNS / NAT / VPN config
declaratively. Run with `scripts/opnsense-terraform-run.sh <plan|apply|...>`, which pulls
the dedicated least-privilege API key from Bitwarden. Decision:
[ADR 016](../../docs/decisions/016-opnsense-terraform.md).

## Decision: Terraform primary, with a documented manual floor (R1)

OPNsense config splits into two worlds:

- **API/MVC-backed** (manageable as code) — firewall rules, NAT, aliases, VLAN/VIP,
  Unbound DNS, Kea DHCP, VPN (WireGuard/OpenVPN/IPsec), certs, static routes.
  **Terraform owns these** via the `browningluke/opnsense` provider.
- **Legacy `config.xml`-only** (no safe declarative API in *any* tool) — base interface
  assignment + IP/WAN/DHCP-client, gateways, system general settings incl. **NTP**,
  captive portal, traffic shaper, IDS/IPS. These stay **Manual** (documented + drift-watched).

Ansible (`ansibleguy.opnsense`) was evaluated — broader coverage (IPS, shaper, gateways,
HAProxy, ACME, savepoint rollback) but no `plan` preview, and it *also* can't manage base
interfaces (its Interface module is virtual-only; its System module is action-only). We
chose Terraform primary for plan-before-apply safety on the router, and will pull in
Ansible *surgically* only if a specific gap (gateways/IPS/shaper) must be codified.
**Never manage the same object in both tools.**

## What's manageable here

| Provider resources (v0.24.0) | OPNsense area |
|---|---|
| `opnsense_firewall_filter` | Firewall → **Automation** → Filter (see note) |
| `opnsense_firewall_alias` / `_category` | Firewall → Aliases |
| `opnsense_firewall_nat` / `_nat_one_to_one` / `_nat_port_forward` | Firewall → NAT |
| `opnsense_interfaces_vlan` / `_vip` | Interfaces → Devices / Virtual IPs |
| `opnsense_unbound_*` | Services → Unbound DNS |
| `opnsense_kea_*` | Services → Kea DHCP |
| `opnsense_wireguard_*` / `_openvpn_*` / `_ipsec_*` | VPN |
| `opnsense_route`, `opnsense_quagga_bgp_*` | System → Routes / Quagga |
| `opnsense_trust_*` | System → Trust (certs) |

### ⚠️ Classic vs Automation firewall rules
`opnsense_firewall_filter` rules land under **Firewall → Automation → Filter**, a
*separate* ruleset from the classic per-interface pages (Firewall → Rules → LAN/WAN).
Terraform rules will **not** show on those pages. If you ever go "Terraform-only" and
delete the classic rules, do it safely:
1. `apply` the equivalent automation rules, 2. verify connectivity (internet egress +
router access still work), 3. *then* delete the classic rules — in a maintenance window,
with **anti-lockout left ON**, a config backup taken, and console access ready.
(Intra-LAN traffic is L2-switched on the flat `/16` and never hits the firewall;
automatic outbound NAT is not a filter rule, so internet egress survives rule deletion.)

## The manual floor (NOT in this module)
Base interface assignment + IP/WAN/DHCP-client · gateways · system general settings incl.
**NTP (ROADMAP §16.1)** · captive portal · traffic shaper · Suricata IDS/IPS. No safe API
exists for these in Terraform *or* Ansible; the only code path is `config.xml` surgery,
ruled out as a lockout risk on the production router. Change in the WebUI, document it,
and rely on drift-awareness.

## Live baseline (2026-06-19)
Near-default: WAN `igc0` (199.126.63.38/24), LAN `ixl1` `10.0.10.1/16`, spare `ixl0`.
No VLAN interfaces; no custom aliases / rules / NAT / overrides. **Nothing to import** —
so this module currently declares **no resources** and `plan` shows **no changes**. It is
the ready lane for the VLAN transition (§1); forward-looking drafts sit in `planned/`.

## DHCP Range And Recovery Preparation

The serving engine is Dnsmasq, not Kea. The approved 2026-10-16 range-only
deployment changed its LAN pool from `10.0.10.100-10.0.10.200` to
`10.0.10.100-10.0.10.199`, removing the overlap with MetalLB's unchanged
`.200-.250` pool. Only the existing range end was edited. Refresh both systems
before future work: a source edit or a smaller future range does not resolve
an address already leased or allocated.

Do not apply Kea resources to this Dnsmasq instance or infer provider support
from the existence of an appliance API. Verify the locked provider's schema
before choosing an owning automation path. This preparation is not permission
to add a second writer, change the DHCP engine, import a whole configuration,
or apply the provider-only root as a repair.

Before an approved range change, retain the exact range object and lease/
reservation evidence privately, verify the router backup download/restore
path, and review the inverse with current `.200` ownership on both systems.
A full router export can contain credentials and private keys: never print it
or put it in Git. Keep local trusted copies owner-only and protect copies
leaving that trusted controller. A backup download is not a restore rehearsal;
do not invoke revert/import or reboot merely to test it.

This change leaves LAN `10.0.10.1/16`, VLANs, client DNS/DHCP authority,
existing reservations and lease timing unchanged. Any required Dnsmasq service
reconfiguration and its interruption risk need explicit review and approval.

### Guarded Range Playbook

The locked `0.24.0` schema was inspected locally: it supports
`opnsense_dnsmasq_host`, not Dnsmasq ranges. The prepared
[range-only playbook (retired)](../../docs/decisions/016-opnsense-terraform.md) is the
specific Ansible exception permitted by ADR 016; no Terraform resource owns
this range and no second writer is introduced. Its reviewed one-time deployment
completed below; unattended activation is neither configured nor approved.

The playbook reads only the reviewed existing UUID, checks complete lease/
reservation evidence and actual Kubernetes service allocations, and refuses
observed ownership of `.200`. Missing objects are refused before the API's
upsert-capable setter. It records a fresh private JSON preimage before posting
exactly one selected range field; every other returned range field must remain
identical before reconfigure. Default `opnsense_range_field=end_addr` retains
the completed `.200 -> .199` operation. Explicit `subnet_mask` selects only the
reviewed empty-to-`255.255.255.0` transition, requires the corrected `.100-.199`
pool and refuses observed IPv4 DHCP clients outside `10.0.10.0/24`. Other fields
and before/after values are refused. Coordinate other router operators: these
requests are not an atomic transaction lock.

Preview only, with `OPNSENSE_API_KEY` and `OPNSENSE_API_SECRET` supplied through
the child process environment:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/opnsense-dhcp-range.yml \
  --limit opnsense --check -e opnsense_range_validate_certs=false
```

The certificate exception is limited to the known self-signed appliance.
The Terraform wrapper's `TF_VAR_*` values are not aliases for these variables.
Without `--check`, both `opnsense_range_apply_confirmed` and
`opnsense_range_recovery_verified` must be explicitly true. Keep them false
during preparation. Live execution also requires a new private recovery
directory. On failure, the playbook stops without retrying or automatically
restoring `.200` into the overlapping pool.

OPNsense 26.1.9's Dnsmasq reconfigure path can reload firewall rules as well
as interrupt DHCP/DNS. A saved API value and a running service are not complete
wire/client acceptance; verify connectivity and runtime behavior separately.
The [twelve offline cases (retired)](../../docs/decisions/016-opnsense-terraform.md) use a
loopback fake API and synthetic credentials, never the router.

### DHCP Mask Preparation Before Router Contraction

The NAS is DHCP-managed, not a candidate for a separate `network.cfg` writer.
The 2026-10-16 read-only survey confirms `.5/16`, DNS `.1`, the expected physical
MAC, matching current reservation and reachable HTTPS/SMB TCP. The active range
mask is blank; the wired baseline advertises `/16`, gateway/DNS `.1` and a
24-hour lease. OPNsense's Dnsmasq template supports an explicit range mask, so
DHCP clients can be prepared without changing router LAN `.1/16` or DNS/DHCP
authority. This is not permission to activate contained routed VLANs yet.

Preview the explicit mask operation with the same child-only credentials:

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/opnsense-dhcp-range.yml \
  --limit opnsense --check -e opnsense_range_validate_certs=false \
  -e opnsense_range_field=subnet_mask
```

Both activation/recovery flags remain false until approval. A successful
check-mode proposal reports `changed=1` but performs no API writes. Before live
save/reconfigure, retain exact range/lease/reservation and NAS before-state
evidence, preserve console access and review interruption risk. Afterward,
require a correlated zero-drop wire offer containing `/24`, unchanged gateway/
DNS/lease time and no Technitium offer before renewing a real client.

For the existing NAS `dhcpcd 9.5.2` IPv4 `eth0` daemon, `-P -4 -N eth0` was
verified in print-only mode against `/run/eth0-4.pid`. After explicit approval
and wire acceptance, `/sbin/dhcpcd -4 -N eth0` requests normal address renewal;
it does not reload client configuration, release the lease, stop Docker/network
services, change static DNS or operate on IPv6. Check `.5/24`, DHCP route,
gateway/DNS, same MAC/boot identity/network-config hash and NAS services after
the request; command exit alone is not renewal acceptance. Do not silently
renew the operator's Windows interfaces. Unrenewed clients can retain `/16`
until their existing leases renew; track them before the router/VLAN cutover.

The installed custom `99-create_network_ini` hook was read, not executed:
its entry gate skips `RENEW` before Docker/network-display/service-update code.
The matching dhcpcd source selects that reason for a same-address renewal from
the existing server, even with a changed mask. Do not substitute `-n` rebind,
`-k` release or daemon restart. If the expected renewal fails, stop and inspect
the DHCP outcome rather than force a new bind; that path can run Unraid service
updates. Normal DHCP runtime/cache updates are not a persistent `network.cfg`
edit or permission to rewrite client hooks.

The owner approved this bounded step on 2026-10-16. Mask activation completed
20:16:44Z-20:16:55Z (`ok=25`, `changed=5`, `failed=0`); full model comparison
shows only that one mask leaf changed. Zero-drop packet review proves `/24`,
correct broadcast, unchanged lease/T1/T2, gateway/DNS `.1` and no Technitium
offer. Router LAN remains runtime/persisted `.1/16`; all eight reservations and
service authority are unchanged. No broader interface/VLAN change was made.

The NAS prefix-changing renewal at 20:19:16Z exposed a dhcpcd/kernel route-update
edge case: the ACK contained `/24` and router `.1`, but a kernel notification
deleted the default route. Local NAS access remained available. At 20:20:44Z,
after exact config/boot/MAC and route-preimage checks, the missing route alone
was recovered as `default via 10.0.10.1 dev eth0 proto dhcp src 10.0.10.5 metric 1005`.
No persistent network setting or unrelated route was edited. A controlled
same-`/24` normal renewal at 20:22:08Z retained the default route; cached ACK,
NAS ports and external HTTPS pass with unchanged config hash, boot/MAC/IPv6/
daemon and non-`eth0` routes. Preserve this exception in future procedures:
inspect actual state after failure, and restore only an absent exact preimage
route, never overwrite an unknown route or blindly repeat a lease action.

Final router/DHCP/DNS/Kubernetes checks pass at 20:24:49Z. Operator Ethernet is
still DHCP `.174/16`; no Windows setting or renewal action was made. Other
leases are not thereby certified `/24`. Full hook/remote CI runs were not
performed; twelve local range/mask cases and the updated storage/NAS guard pass.

The owner then separately approved only operator Ethernet IPv4 renewal. At
20:32:14Z normal `ipconfig.exe /renew Ethernet` accepts `.174/24` with unchanged
NIC/address/gateway/DNS and interface/route metrics. No release, reset, IPv6 or
hotspot-routing change occurred. At 20:33:26Z router/edge/storage/NAS TCP and
external HTTPS are reachable. This supersedes only the dated operator `/16`
observation above; router LAN is still `/16`, and other clients/appliances are
not yet all verified `/24`. No broader router/interface/VLAN approval is implied.

Scoped inverse: stop and inspect actual configured/runtime state, then, only
after recovery approval and drift checks against the saved range, POST only
`{"range":{"subnet_mask":""}}` to the same existing range setter. Read back
that all other fields remain unchanged before reconfigure. This restores the
interface-derived `/16` advertisement, not leases already issued; affected
clients may need approved normal renewal. Never restore the entire router
configuration, the old `.200` range end or a stale lease map as an automatic
reaction. A saved history download is not a certified full-current export for
the later LAN-interface change.

### Router LAN Mask Cutover

Preparation on 2026-10-16 now includes a genuine current WebUI export, not just
backup history: 72,671 bytes, SHA-256
`f53c7f99353f296cac7f80659ccaa5a27c955d5096f5561e910de6c027d4ada8`, retained
owner-only outside Git. It verifies LAN `.1/16`, DHCP `/24` and the corrected
`.100-.199` pool. A read-only live LAN form check at 20:52Z found no pending
interface Apply; changing `subnet` from `16` to `24` leaves every other form
value, including IPv6 `idassoc6`, unchanged. No literal legacy `/16` network
references were found in that export. Derived LAN firewall/NAT networks will
follow the narrower interface; this is intentional and needs runtime acceptance.

The bounded change stays in the existing manual WebUI lane:
`/interfaces.php?if=lan`, same static IPv4 `10.0.10.1` on `ixl1`, prefix only
`16 -> 24`. Preserve WAN, IPv6 configuration, DHCP/DNS authority/options, switch
ports/native L2 and all host/client addresses. Refuse another operator's pending
interface changes. Save first, compare the saved configuration against the
preimage, and Apply only if no unapproved setting changed. The Apply resets LAN,
refreshes routing/firewall and restarts the WebUI; brief network/service loss is
possible. It is not an automatically reverting trial or a zero-outage change.

Before activation, require explicit approval and the available router console
through literal edge PVE `.3:8006`; the operator and PVE are already `/24` on
the same native L2. Exact inverse is prefix `24 -> 16` through the same LAN
form, then Apply, preserving all other fields. Do not restore a whole stale
configuration or edit `config.xml` directly. If a request outcome is unknown,
read actual persisted/runtime state before deciding on recovery, never retry it
blindly. Saved export and console access are not a restore rehearsal.

Acceptance: runtime and persisted `.1/24`, connected `10.0.10.0/24` without the
old `/16` connected route, unchanged WAN/IPv6 configuration and DHCP range/
reservations, working operator/PVE/NAS access, DNS/internet, Kubernetes/API VIP
and an OPNsense-only `/24` DHCP offer. Reuse the completed host/client checks
unless their state changed. Other appliance masks remain path-specific work
before their cross-VLAN access; this step does not move them or enable VLANs.

### Preserve The Control Connection

The assistant depends on the same internet connection: a WAN disruption can
remove its ability to diagnose or recover. Console access alone does not
preserve that connection. The owner offers a phone hotspot while leaving LAN
Ethernet connected. The hotspot was connected, but the observed default route
still preferred Ethernet; independent hotspot egress was not established.

Before approving any disruptive live action, ask the owner to enable the
hotspot using cellular data, not the home Wi-Fi uplink. Verify Windows and WSL
internet/DNS access actually use it and that local Proxmox/router traffic still
uses Ethernet. Check relevant IPv4/IPv6 routes and DNS dependencies; interface
presence alone is not proof. Do not silently change route metrics, gateways,
DNS or IPv6 policy. Keep switch port 22/native L2 untouched and give the owner
an executable local recovery procedure rather than relying on the assistant
remaining online. No router reconfigure is authorized by the hotspot offer.

For this range-only change, the owner subsequently explicitly requested
deployment without adjusting Windows networking. That instruction approved
the existing one-field change and its known reconfigure risk, not a silent
route/DNS modification or a broader network migration. The deployment used
fresh scoped API preimages and demonstrated console access; it did not claim
that the hotspot had become the selected internet route.

### Backup Verification Boundary

The GET backup API downloads saved history, not a newly generated active
export. The selected history entry was from August 2026; it was downloaded
privately and XML-validated, but was not certified as a full-current restore
image. No revert/import/restore was executed. Before a broader router-interface
or subnet change, retain a current export through System, Configuration,
Backups and review its restore procedure. Do not restore the older history wholesale to undo this
single-field change. The actual range-only execution used fresh affected-state
API preimages and a recorded field-only inverse, not a claimed full-current
XML export. Applicable current-export/restore requirements remain open for
the broader interface/subnet migration.

### Approved Deployment Result

Activation ran from 2026-10-16T00:40:51Z to 00:41:00Z through the guarded
playbook: `ok=24`, `changed=5`, `failed=0`, no rescue or retry. The changed count
includes the public preview message and local recovery files, not five router
settings. Only `range.end_addr` changed to `.199`, followed by the reviewed
Dnsmasq reconfigure; every other returned range field remained identical.

At 00:42:20Z, Dnsmasq was running, eight reservations and LAN `.1/16` were
unchanged, 15 lease records were retained and no `.200` lease was present.
Router external DNS, Technitium internal DNS and external HTTPS checks pass.
A DISCOVER-only probe at 00:42:50Z-00:43:05Z received only OPNsense offers;
both captures correlate transaction `0x46544f0d`, contain two packets with zero
drops, and retain mask `255.255.0.0` / DNS `.1`. This proves responsiveness and
authority, not exhaustive allocation-boundary testing. No real device lease was
accepted or released. Fresh recovery, API and packet evidence are retained
privately outside Git; no rollback or full configuration restore was needed.

## Running
```
export BW_SESSION="$(bw unlock --raw)"
scripts/opnsense-terraform-run.sh plan      # read-only
scripts/opnsense-terraform-run.sh apply     # writes the router — review the plan first
```
The wrapper parses `key=` / `secret=` from the `OPNsense — terraform` bw item notes into
`TF_VAR_opnsense_api_*`. The provider uses `allow_insecure = true` for the self-signed
cert, so no CA bundle is needed (unlike the NAS GraphQL lane).

## Files
- `main.tf` — provider + backend-deferred note
- `variables.tf` — endpoint + (sensitive) API key/secret
- `planned/` — staged drafts for §1, not loaded by Terraform
