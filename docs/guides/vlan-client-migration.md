# VLAN Client Migration And Physical Checks

The network-owned VLAN milestone is accepted. These onsite tasks remain pending
by owner choice; they are not claimed by the wired, DHCP or dual-stack tests.
Management stays native/untagged, operator switch port 22 stays unchanged, and
guest Wi-Fi stays disabled until the separate captive-portal milestone.

## Accepted Baseline

| Network | Gateway | DHCP/DNS | IPv6 |
|---------|---------|----------|------|
| Native management | `10.0.10.1` | Technitium `10.0.10.30` | Existing WAN/native IPv6 retained |
| Private, VLAN 20 | `10.0.20.1` | Technitium `10.0.20.30` | Delegated global `/64`, ULA `fde4:cabf:d798:20::/64` |
| Guest, VLAN 30 | `10.0.30.1` | DNS `10.0.30.30`; DHCP off | Dual-stack plumbing tested, forwarding quarantined |
| Local IoT, VLAN 40 | `10.0.40.1` | Technitium `10.0.40.30` | Delegated global `/64`, ULA `fde4:cabf:d798:40::/64`; no internet |
| Cloud IoT, VLAN 50 | `10.0.50.1` | Technitium `10.0.50.30` | Delegated global `/64`, ULA `fde4:cabf:d798:50::/64` |

Active IPv4 pools are `.100-.199`, mask `/24`, lease 24 hours. Confirmed
reservations remain outside those pools. Expiring migration holds preserve old
addresses for 48 hours; they do not make dynamic-only devices permanently fixed.
The router's `.1` DNS endpoint remains a compatibility proxy through Technitium.

## Move Devices Individually

Use the existing Bitwarden `owl-red-wifi-*` login-password fields. No password
change is required. Do not repeat the accepted private/cloud key tests or reset
Windows adapters, metrics or DNS overrides as a migration shortcut.

| Device | Target SSID / VLAN | Target address / status |
|--------|--------------------|-------------------------|
| `w1ngz.owl.red` | `owl.red`, 20 | `10.0.20.10`; private wireless acceptance already passed |
| LG phone / `paranoid-android.owl.red` | `owl.red`, 20 | `10.0.20.11`; verify per-SSID MAC when moving |
| Bedside tablet | `owl.red`, 20 | Planned `10.0.20.12`; confirm target-SSID MAC before reservation |
| Work laptop `KAM1WL102916` | `owl.red`, 20 | Dynamic only, no permanent fixed lease |
| Ecobee | `owl.red-iot-cloud`, 50 | Existing canonical reservation; actual move pending |
| Shield | `owl.red-iot-cloud`, 50 | `10.0.50.11`; verify NAS Plex access |
| Canon printer | `owl.red-iot-local`, 40 | Canonical reservation; verify printing locally |
| Bambu printer | `owl.red-iot-local`, 40 | Join/onboard locally; report exact required flows before adding exceptions |
| WUUK foyer camera | `owl.red-iot-local`, 40 | `10.0.40.12`; verify local stream/control without internet |
| WUUK office camera | `owl.red-iot-local`, 40 | `10.0.40.13`; verify local stream/control without internet |

For each move, record the actual SSID MAC, address/mask, gateway, VLAN-local DNS,
IPv6 addresses and required application result. Change only that device's Wi-Fi
profile; do not release another device's lease. Reconcile the
[canonical registry](../../gitops/technitium/dhcp-reservations.json) through the
same Git owner after verifying identity. Remove a legacy reservation only in
the reviewed device batch, not before the new attachment works.

Private has NAS SMB/Plex, shared ingress HTTPS and narrow local-IoT TCP service
access. Cloud IoT has internet plus NAS Plex TCP 32400, not appliance admin.
Local IoT cannot initiate routed internet/inter-VLAN traffic. Cross-VLAN mDNS
or broadcast discovery is not enabled; use explicit names/addresses or review
an application-specific discovery requirement. New direct client DNS/DoT/DoQ
on ports 53/853 is denied in both families; arbitrary DoH over 443 is not blocked.

## Apartment RF Walk

- [ ] Measure the weakest normal-use locations and each camera/printer position.
- [ ] Record exterior spill from an accessible location outside the apartment.
- [ ] Keep accepted effective limits 8 dBm at 2.4 GHz and 12 dBm at 5 GHz unless measurements justify a reviewed change.
- [ ] Record additional client types; one successful client is not a coverage survey.

The 900-sq-ft area and power caps do not guarantee an RF boundary at the walls.

## Future Physical Network Changes

- [ ] Test a spare wired recovery client/port before switch filtering or management tagging. CSS326 has no serial console; reset is last resort.
- [ ] Verify actual patching and any remaining BMC/PDU/static-appliance masks before moving their paths.
- [ ] Assign wired access-port PVIDs only in a reviewed, physically verified batch; never infer them from a port label.
- [ ] Keep the accepted AP LAN4 native recovery port and switch operator port 22 unchanged until a separately approved recovery-backed migration.
- [ ] Plan tagged management VLAN 10 independently; native management is the accepted current design, not a failed migration.
- [ ] Activate guest DHCP/SSID only with the separate off-AP captive portal and its unauthenticated/authenticated IPv4/IPv6 acceptance.

No physical task above is automatically completed by the infrastructure evidence.