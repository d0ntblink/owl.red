# Decision 024: Single-SSID IoT With MAC-Bound PPSK VLANs

## Status

Accepted on 2026-11-17. The observed mixed-VLAN DHCP failure was resolved after
upgrading the GWN7660E to 1.0.27.20. Cross-band isolation and the two appliances
absent from the post-upgrade client list still require verification.

## Context

Local-only and internet-dependent IoT devices previously used separate SSIDs.
The selected interface is one SSID with explicit per-device VLAN assignment,
wireless peer isolation and a short shared passphrase for manual entry.

## Decision

- Use `owl-red-iot`, PPSK without RADIUS, WPA2/AES and both radio bands.
- Keep VLAN 40 local-only and VLAN 50 internet-enabled. Bind every PPSK account
  to its device MAC, one-client limit and explicit VLAN. Merkury's current
  user-managed assignment is VLAN 50, alongside ecobee and Typhur.
- Use one shared two-word passphrase separated by one space, stored in both
  Bitwarden products as `owl-red-wifi-iot`. MAC binding is not strong identity;
  sharing a phrase loses independent per-device credential rotation.
- Version the complete import CSV with Ansible Vault encryption and a separate
  random key in Bitwarden. Never commit the usable plaintext import.
- Keep PPSK accounts UI-owned. The API runner skips ordinary reconciliation
  of the IoT profile; bounded migration operations verify exact readback.
- Retire `owl.red-iot-local` and `owl.red-iot-cloud`. Keep `owl.red` and
  `silence of the lans` unchanged. The two obsolete profiles were removed with
  private restore preimages retained.
- Preserve Technitium DHCP/DNS ownership, VyOS routing/firewall policy and
  native management access. Do not enable AP DHCP or a second enforcement lane.

## Acceptance And Recovery

Both cameras moved to the new SSID while retaining `10.0.40.12` and `.13`.
They passed gateway access, same-band peer HTTP/ICMP denial and WAN HTTP denial.
The user subsequently moved the remaining devices.

On firmware 1.0.25.34, the AP failed fresh DHCP on the non-common PPSK VLAN.
With common VLAN 40, VLAN 50 clients transmit correctly tagged Discover packets
and Technitium sends matching Offers, without subsequent Request/ACK. With
common VLAN 50, ecobee gets a fresh lease and an established public-service
session, but fresh DHCP then fails for a VLAN 40 camera. This discriminates
the AP's mixed-VLAN forwarding behaviour from a WAN firewall or DNS problem.

The common VLAN remains 40. Trials of tagging disabled, broadcast/Proxy
ARP, multicast-to-unicast, named isolation mode and equivalent WPA-key
representation did not pass acceptance and were reverted. No failed trial
remains active. DNS and Traefik targets are unchanged and verified.

After establishing Ethernet management, the AP was upgraded through GWN
Manager to the model's stable 1.0.27.20 release using the versioned vendor HTTPS
image. Its vendor-published MD5 matched and SHA-256 is recorded in the
[AP manifest](../../ansible/vars/gwn-manager.json). Native AP Status verified
the running version; a Manager schedule's Successful label alone is insufficient.
The security-version update means firmware downgrade is not assumed to be a
safe rollback. Configuration preimages remain private.

Post-upgrade acceptance observed fresh VLAN 40 leases for Canon/Bambu and a
fresh VLAN 50 lease plus an established public-service session for ecobee, with
common VLAN 40 and unchanged PPSK bindings. Both cameras retained gateway
access, peer HTTP/ICMP denial and WAN HTTP denial. Typhur and Merkury were absent
from the native current-client list, so their post-upgrade connectivity is not
claimed. No router, switch, DHCP authority, DNS or Traefik change was required.

## References

- [IoT operation and encrypted CSV](../guides/iot-wifi-ui.md)
- [Wi-Fi architecture](../guides/wifi-architecture.md)
- [Camera configuration](../guides/thingino-cameras.md)
- [Network policy](../../ansible/vars/wifi-networks.yml)