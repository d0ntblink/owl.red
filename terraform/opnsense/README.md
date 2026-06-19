# terraform/opnsense — OPNsense config as code (Terraform-primary lane)

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
