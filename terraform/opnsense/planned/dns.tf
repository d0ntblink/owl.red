# ---------------------------------------------------------------------------
# Unbound DNS host overrides
#
# Technitium is authoritative for owl.red and serves all internal names.
# These Unbound overrides are a fallback safety net for the OPNsense resolver
# itself (edge.owl.red resolves its own management interface).
#
# Do NOT duplicate Technitium records here — Technitium is the source of truth.
# Only add overrides for names that OPNsense needs to resolve independently.
# ---------------------------------------------------------------------------

resource "opnsense_unbound_host_override" "edge_self" {
  enabled     = true
  hostname    = "edge"
  domain      = "owl.red"
  server      = "10.0.10.1"
  description = "OPNsense VM self-reference — VLAN 10 gateway"
}
