# `terraform/opnsense/planned/` — staged drafts (NOT loaded by Terraform)

These `.tf` files are **forward-looking drafts** for the VLAN transition (ROADMAP §1).
Terraform does **not** load subdirectories, so nothing here is part of the active
`terraform/opnsense` module — `plan`/`apply` will never create these objects. They live
here so the work isn't lost, not because they reflect the live router.

## Why they're parked

A read-only survey of the live router (2026-06-19, via the dedicated `terraform` API
user) found OPNsense is **near-default**:

- LAN is a single **flat `10.0.10.1/16`** — there are **no VLAN interfaces on the
  firewall yet** (`vlan_settings` is empty).
- **0** custom aliases, **0** automation filter rules, **0** NAT, **0** Unbound
  overrides. Only OPNsense's built-in default aliases (`bogons`, `__lan_network`, …)
  plus **1 auto-generated** Unbound forward (`owl.red → 127.0.0.1:53053`, the Dnsmasq
  integration) exist. Nothing custom to import.

`aliases.tf` / `dns.tf` describe **post-VLAN-transition** state, which is why they
don't match reality:

- aliases use **`/24`-per-VLAN** content (`10.0.20.0/24`, `10.0.30.0/24`, …) — that is
  the ROADMAP §1.5 **target**, not today's `/16`.
- they reference VLANs **20/30/40/50**, which don't exist on OPNsense yet.
- `edge_self` (`edge.owl.red → 10.0.10.1`) is the only entry true today, but no rule
  needs it yet, so it's staged with the rest.

## Activating one during the VLAN transition (§1)

1. Decide the VLAN's real subnet/mask as part of the `/16` → `/24` cutover (§1.5).
2. Move the resource block up into `terraform/opnsense/` (a real, loaded `.tf` file),
   adjusting the mask to the chosen value.
3. `scripts/opnsense-terraform-run.sh plan` — review, then `apply`.
4. Author the matching inter-VLAN policy as `opnsense_firewall_filter` resources
   (these land under **Firewall → Automation → Filter**, not the per-interface Rules
   pages — see the module README).

See `../README.md` and [ADR 016](../../../docs/decisions/016-opnsense-terraform.md).
