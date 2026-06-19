# Decision 016: OPNsense config managed by Terraform (primary), with a manual floor

## Status

Accepted (2026-06-19).

## Context

OPNsense (`edge.owl.red`, `10.0.10.1`) was the last major host with no configuration IaC.
A read-only survey via a dedicated least-privilege `terraform` API user found the router
**near-default**: WAN `igc0`, LAN `ixl1` on a single **flat `10.0.10.1/16`**, no VLAN
interfaces, and **zero** custom aliases / automation filter rules / NAT / Unbound
overrides (only built-in defaults + 1 auto-generated Unbound forward for the Dnsmasq
integration). There was effectively **nothing to import** — the earlier ROADMAP §0.2
assumption ("import existing aliases/rules/overrides") was wrong.

Two structural facts shaped the decision:

1. OPNsense config splits into **API/MVC-backed** objects (firewall rules, NAT, aliases,
   VLAN/VIP, Unbound, Kea DHCP, VPN, certs, routes) and **legacy `config.xml`-only**
   objects (base interface assignment + IP/WAN, gateways, system general incl. NTP,
   captive portal, shaper, IDS). Only the first is safely manageable as code.
2. Both candidate tools wrap the same API. `browningluke/opnsense` (Terraform, installed
   **v0.24.0**) gives declarative state + a `plan` preview. `ansibleguy.opnsense` is
   broader (adds gateways, IPS, shaper, HAProxy, ACME, CARP-HA, savepoint rollback) but
   has no plan preview. **Neither can manage base interfaces or system/NTP** — there is no
   API for them; the Ansible Interface module is virtual-only and its System module is
   action-only.

## Decision

Manage OPNsense config with **Terraform (`browningluke/opnsense`) as the primary lane**
(decision "R1"):

- **Terraform** (`terraform/opnsense/`) owns every API/MVC-backed object: firewall filter
  rules, NAT, aliases, VLAN/VIP, Unbound DNS, Kea DHCP, VPN, certs, static routes.
- A documented **Manual floor** covers what no tool can safely codify: base interface
  assignment + IP/WAN/DHCP-client, gateways, system general settings incl. **NTP (§16.1)**,
  captive portal, traffic shaper, IDS/IPS. Changed in the WebUI, documented, drift-watched.
  `config.xml`-as-code is **rejected** (lockout risk on the router).
- **Ansible** (`ansibleguy.opnsense`) is **deferred** — added surgically only if a specific
  gap (gateways/IPS/shaper) must become code. **No object is managed by both tools.**

Supporting choices:

- **Dedicated least-privilege API user** `terraform` (not the root key). Key+secret live in
  the Bitwarden `OPNsense — terraform` item NOTES; the prior root API key was removed from
  bw (WebUI revocation pending — ROADMAP §0).
- **Secrets via env injection** — `scripts/opnsense-terraform-run.sh` parses the bw notes
  into `TF_VAR_opnsense_api_*` at runtime (no secrets in code), matching [ADR 003](003-secrets-bitwarden.md).
- **`allow_insecure = true`** for the self-signed LAN cert (no CA bundle, unlike the NAS).
- **Plan-before-apply discipline** on the router. Terraform filter rules live in the
  **Automation** ruleset (separate from classic per-interface rules) — never delete classic
  rules before the automation equivalents are applied + verified, anti-lockout left on.

## Alternatives rejected

- **Ansible primary (R2, `ansibleguy.opnsense`)** — broader coverage + savepoint rollback,
  and fits [ADR 007](007-terraform-vs-ansible-boundaries.md)'s "Ansible configures hosts"
  framing, but no `plan` preview and it would discard the already-wired Terraform lane.
  Reconsider only if maximum coverage outweighs plan-safety.
- **`config.xml`-as-code (Ansible templating)** — the only way to codify base
  interfaces/system/NTP, but a malformed config + reload can lock out or break the router:
  violates the "router must not go down" constraint.
- **Pure-manual** — abandons the IaC-everything principle for the firewall.
- **"Interfaces via Ansible, everything else via Terraform"** — infeasible: Ansible cannot
  manage base interfaces either (same underlying API limit).

## Consequences

- The firewall is **split-brain by design**: classic per-interface rules (currently
  near-default, manual) + Terraform automation rules. Document which is which.
- The manual floor is small and low-churn today (near-default) but genuinely outside IaC;
  it's tracked in the module README + ROADMAP §0.
- VLAN aliases/rules are **created during the VLAN transition (§1)**, authored as Terraform,
  not imported. Forward-looking drafts are parked in `terraform/opnsense/planned/`.
- Adding a setting follows a fixed rule: API/MVC object → Terraform; legacy/`config.xml` →
  Manual (or, if API-backed and Terraform lacks it, a surgical Ansible module).

See: [`terraform/opnsense/README.md`](../../terraform/opnsense/README.md), ROADMAP
§0/§1/§16.1, [ADR 003](003-secrets-bitwarden.md), [ADR 007](007-terraform-vs-ansible-boundaries.md),
[ADR 012](012-cloudflare-tunnel-no-inbound-port-forwarding.md).
