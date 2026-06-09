# ---------------------------------------------------------------------------
# DHCP Static Mappings — VLAN 10 (network-devices)
#
# These mirror gitops/technitium/dhcp-reservations.json.
# OPNsense does NOT serve DHCP for these VLANs (Technitium does), so these
# are commented out pending a decision on whether OPNsense takes over DHCP
# from Technitium or not.  Keeping the resource definitions here so they're
# ready to activate if OPNsense DHCP is ever used as fallback.
#
# For now this file manages the items OPNsense does own:
#   - Firewall aliases (IP groups for policy rules)
#   - Firewall rules (inter-VLAN policy)
#   - DNS host overrides (Unbound — split-horizon for local names not in Technitium)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Aliases — host groups used in firewall rules
# ---------------------------------------------------------------------------

resource "opnsense_firewall_alias" "infra_hosts_vlan10" {
  name        = "infra_hosts_vlan10"
  type        = "network"
  description = "VLAN 10 infrastructure subnet — network devices"
  content     = ["10.0.10.0/24"]
  enabled     = true
}

resource "opnsense_firewall_alias" "private_net_vlan20" {
  name        = "private_net_vlan20"
  type        = "network"
  description = "VLAN 20 private net — trusted wired and WiFi clients"
  content     = ["10.0.20.0/24"]
  enabled     = true
}

resource "opnsense_firewall_alias" "guest_net_vlan30" {
  name        = "guest_net_vlan30"
  type        = "network"
  description = "VLAN 30 guest net — captive portal WiFi"
  content     = ["10.0.30.0/24"]
  enabled     = true
}

resource "opnsense_firewall_alias" "iot_no_inter_vlan40" {
  name        = "iot_no_inter_vlan40"
  type        = "network"
  description = "VLAN 40 IoT — local only, no internet"
  content     = ["10.0.40.0/24"]
  enabled     = true
}

resource "opnsense_firewall_alias" "iot_with_inter_vlan50" {
  name        = "iot_with_inter_vlan50"
  type        = "network"
  description = "VLAN 50 IoT — internet permitted, no lateral movement"
  content     = ["10.0.50.0/24"]
  enabled     = true
}

resource "opnsense_firewall_alias" "internal_all_vlans" {
  name        = "internal_all_vlans"
  type        = "network"
  description = "All internal VLANs — used in catch-all deny rules"
  content     = [
    "10.0.10.0/24",
    "10.0.20.0/24",
    "10.0.30.0/24",
    "10.0.40.0/24",
    "10.0.50.0/24",
  ]
  enabled = true
}

resource "opnsense_firewall_alias" "cluster_vip_range" {
  name        = "cluster_vip_range"
  type        = "network"
  description = "MetalLB VIP pool — Kubernetes LoadBalancer IPs"
  content     = ["10.0.10.200/51"] # 10.0.10.200–10.0.10.250
  enabled     = true
}

resource "opnsense_firewall_alias" "dns_server" {
  name        = "dns_server"
  type        = "host"
  description = "Technitium DNS/DHCP LXC"
  content     = ["10.0.10.30"]
  enabled     = true
}
