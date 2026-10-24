# WAP Buy Order

Research date: 2026-10-23. Status: Grandstream GWN7660E selected as the
replacement. Prior GWN7665 order cancellation/refund is not confirmed. The
GWN7660E order, delivery, local IaC qualification and deployment acceptance are
not confirmed. Other models remain a comparison shortlist.

## Selected Purchase

- **Selected:** Grandstream GWN7660E. The owner showed an Amazon listing at
  C$69.96; that is the shown price, not a confirmed completed purchase, seller
  warranty, or delivery.
- **Previous order:** GWN7665 had been reported ordered at C$156.26. The owner
  subsequently chose the GWN7660E instead. Whether the earlier order was
  cancelled or refunded is unknown; verify it with Amazon.
- **Power path:** connect directly to an 802.3af/at PoE port on the existing MokerLink
  POE-G083GS. Its manufacturer specification advertises active 802.3af/at,
  up to 30 W per port and 120 W shared budget; the GWN7665 advertises 22.5 W
  maximum consumption, and the GWN7660E supports 802.3af/at with advertised
  12.95 W maximum consumption. **No separate injector is needed** in this topology.
- The CSS326 remains the core managed switch; the MokerLink stays downstream
  between the network cabinet and rack. Do not change its DIP to Extend as part
  of AP installation. The exact port/VLAN path remains to be recorded and
  tested.
- Do not cut over or re-enable guest Wi-Fi until the local configuration/IaC
  path, all required VLANs, backup/recovery and real-client acceptance pass.

### Intended SSID/RF Layout After Qualification

This is the selected target, not current live state. The old AP remains under
the recovery hold until the replacement is delivered and accepted.

| Band | Intended SSIDs | VLANs |
|------|----------------|-------|
| 2.4 GHz | `owl.red`, `silence of the lans`, `owl.red-iot-local`, `owl.red-iot-cloud` | 20, 30, 40, 50 respectively |
| 5 GHz | `owl.red`, `silence of the lans` | 20 and 30 respectively |

That is four BSSIDs on 2.4 GHz, two on 5 GHz, six total. The GWN7660E vendor
specification lists 16 SSIDs per radio. Reuse the same SSID name on both bands
only when both BSSes map to that same VLAN/security policy. Keep the two IoT
networks on 2.4 GHz unless separately qualified. Guest remains disabled on the
old AP until the new VLAN 30/openNDS path passes end-to-end acceptance.

## Requirements

- Local management and operation without a cloud service or subscription.
- Repeatable IaC for SSIDs, VLAN mapping, bands, security and radio settings.
  A local GUI or configuration download alone does not satisfy this requirement.
- Preserve private VLAN 20, guest VLAN 30, local IoT VLAN 40 and cloud IoT VLAN
  50; guest remains paused until replacement and acceptance.
- Keep VyOS, Technitium and the separate openNDS gateway as their existing
  owners. The new AP is a wired VLAN-aware bridge, not another router.
- Verify room for eight BSSIDs per required radio if eight-per-band expansion
  is intended; do not mistake an AP-wide total for a per-radio limit.
- Affordable hardware, obtainable firmware, suitable Canadian regulatory SKU,
  working factory reset, mounting hardware and a return/testing window.
- Use vendor-supported firmware. No custom firmware conversion or boot-time
  radio/bridge repair scripts as the operating model.

## What Eight BSSIDs Means

An SSID is the network name/profile; a BSSID identifies a radio's AP interface.
Broadcasting the same four SSIDs on two bands normally consumes four BSSIDs
on each radio, eight across the AP. Eight total is not eight per radio.
Controller profile limits, mesh/uplink features and firmware can reduce the
usable total. Vendor SSID limits below are advertised capacity, not an onsite
test or a promise for every operating mode.

Do not read the shortlist as a blanket guarantee that every model has been
verified for eight simultaneous BSSIDs per radio. **HOLD** means the exact
local firmware/controller capacity still needs confirmation before purchase.
Eight beacons per radio also cost airtime; normally broadcast only needed SSIDs.

Explicitly verified in vendor specifications: U6 Pro, U6 Enterprise and U7 Pro
advertise 8 BSSIDs per radio; EAP610 and EAP773 advertise 8 SSIDs per band;
GWN7660, GWN7660E and GWN7665 advertise 16 SSIDs per radio. These are the strongest
capacity-evidence candidates here. MLO/mesh/security and controller-mode limits
still need checking for the actual configuration.

## Buying Priority

1. Omada EAP610 around C$60-90 used, or UniFi U6 Pro around C$100-150 used:
   first candidates when local-controller IaC can be qualified without bespoke
   automation. Compare total cost, including controller operation and power.
2. EAP670 around C$100-140 used if its better 5 GHz radio is worth the premium.
3. Aruba AP-505/AP-515 or Ruckus R550/R650 only with the correct local firmware
   demonstrated and an acceptable native-CLI automation plan.
4. Grandstream or Zyxel if hardware value is compelling, but do not waive the
   IaC gate merely because standalone management is available.
5. Buy tri-band only at a reasonable premium; current documented clients are
   not confirmed to need 6 GHz.

## Dual-Band Candidates

All entries in this table are 2.4 + 5 GHz Wi-Fi 6, not tri-band.

| Model | CAD buying target | Advertised SSID/BSSID capacity evidence | Local management and IaC assessment |
|-------|-------------------|-----------------------------------------|-------------------------------------|
| UniFi U6 Pro | C$100-150 used | 8 BSSIDs per radio in official tech specs | Local self-hosted UniFi; community Terraform provider; qualify/pin versions |
| Omada EAP610 | C$60-90 used | 16 SSIDs total, explicitly 8 per band in official specifications | Local Omada software controller; community Terraform; qualify required resource coverage |
| Omada EAP670 | C$100-140 used | 16 SSIDs advertised; HOLD exact per-radio split against hardware revision/datasheet | Same controller lane as EAP610; 2.5 GbE uplink |
| Aruba AP-505 with Instant firmware | C$50-100 used | HOLD exact per-radio and virtual-controller limits for the selected Instant release | Embedded local virtual controller; native CLI automation needs qualification |
| Aruba AP-515 with Instant firmware | C$50-100 used | HOLD exact per-radio and virtual-controller limits for the selected Instant release | Same Instant caveat; do not assume every campus/AOS-10 listing is ready |
| Ruckus R550 with Unleashed | C$90-160 used | Hardware datasheet: up to 31 SSIDs per AP; HOLD per-radio Unleashed limit | Embedded local controller; native CLI automation, less turnkey Terraform |
| Ruckus R650 with Unleashed | C$90-160 used if obtainable | Hardware datasheet: up to 31 SSIDs per AP; HOLD per-radio Unleashed limit | Same caveat; stronger 5 GHz radio and 2.5 GbE; PoE+ needed for full functionality |
| Grandstream GWN7660 | C$60-100 used | Official product comparison: 32 SSIDs total, 16 per radio | Embedded controller or local GWN Manager; full local IaC workflow not yet qualified |
| Grandstream GWN7660E | C$69.96 shown new on Amazon; listing not independently verified | Official product comparison: 32 SSIDs total, 16 per radio | Dual-band Wi-Fi 6; 1GbE; local embedded controller; IaC qualification remains a hold |
| Zyxel NWA50AX | C$40-80 used | HOLD standalone per-radio profile limit; retrieved specifications do not state it | Standalone/NebulaFlex; cloud optional, complete IaC coverage unqualified |
| Zyxel NWA50AX Pro | C$40-80 used if obtainable | HOLD standalone per-radio profile limit; retrieved specifications do not state it | Standalone/NebulaFlex, 2.5 GbE; verify CLI coverage rather than assuming a local GUI is IaC |

## Tri-Band Candidates

True tri-band here means simultaneous 2.4 + 5 + 6 GHz. These are alternatives,
not instructions to buy the highest model number.

| Model | Budget position | Advertised SSID/BSSID capacity evidence | Main caveat |
|-------|-----------------|-----------------------------------------|-------------|
| UniFi U6 Enterprise | Around C$200 used target | 8 BSSIDs per radio in official tech specs | Wi-Fi 6E, 2.5 GbE, PoE+; compare used cost with a new U7 Pro |
| UniFi U7 Pro | Canadian store previously showed approximately C$263 including displayed surcharge; recheck tax/shipping | 8 BSSIDs per radio in official tech specs | Wi-Fi 7, 2.5 GbE, PoE+; verify provider support for the selected controller/6 GHz settings |
| Grandstream GWN7665 | Obtain Canadian quote; used supply not verified | Official comparison: 48 SSIDs total, 16 per radio | Wi-Fi 6E with embedded controller; complete local IaC remains a buying hold |
| Zyxel NWA130BE | Investigate the owner's approximately C$250 Amazon listing; not identified or price-verified | True 2.4/5/6 GHz Wi-Fi 7 verified; HOLD standalone SSID limit | Standalone management and two 2.5 GbE ports verified; PoE+ 24 W; complete IaC unqualified |
| Zyxel NWA50BE MAX | Obtain exact Canadian listing | True 2.4/5/6 GHz Wi-Fi 7 verified; HOLD per-radio SSID limit | Standalone verified; 2.5 GbE, PoE+ 15 W; complete IaC unqualified |
| Zyxel NWA90BE MAX | Obtain exact Canadian listing | True 2.4/5/6 GHz Wi-Fi 7 verified; HOLD per-radio SSID limit | Standalone verified; 2.5 GbE, PoE+ 15 W; complete IaC unqualified |
| Omada EAP773 | Obtain Canadian quote; compare against U7 Pro and the C$250 Zyxel listing | 24 SSIDs total, explicitly 8 per band | True tri-band Wi-Fi 7, 10 GbE; current specs say PoE+ after software update; check shipped firmware/revision |
| Omada EAP690E HD | Comparison only; quote needed | HOLD exact radio/profile limits and hardware revision | Vendor calls it quad-band Wi-Fi 6E; PoE++/802.3bt requirement makes it a poor budget fit |

## The Approximately C$250 Zyxel

The Amazon model is not known. Check the exact model string and seller URL;
price and the word "6E" alone cannot identify it. NWA130BE and the MAX models
are candidates to investigate, not proof of which unit the owner saw. Do not
confuse simultaneous triple-radio operation with a switchable 5/6 GHz radio.
Record the ASIN, hardware revision, included power supply, seller and return
terms before promoting a candidate to the buy list.

The NWA130BE is confirmed BE11000 triple-radio Wi-Fi 7 with standalone local
management. Its specifications say **802.3af supplies no wireless service**;
use 802.3at PoE+ or the supported DC supply. Later hardware adds USB-C power,
so check the actual revision and included adapter. At C$250 it is a candidate,
not automatically a better purchase than models with qualified IaC.

## IaC And Cloud Gates

- UniFi: [community provider](https://registry.terraform.io/providers/filipowm/unifi/latest/docs)
  against a local controller. This is not vendor-supported Terraform; pin and
  test a compatible release, including 6 GHz if required.
- Omada: [community provider](https://registry.terraform.io/providers/wncservices/omada/latest/docs)
  supports a local controller. Prove the required WLAN/VLAN/radio operations;
  provider existence is not proof every UI setting is covered.
  Verify local automatic channel/power features separately: some product-page
  optimization footnotes require a cloud controller. Do not promise feature
  parity between standalone, local-controller and cloud modes.
- Aruba: enterprise Instant and Instant On are different products. Require a
  demonstrated local Instant deployment and available matching firmware; do
  not assume a campus/AOS-10 or Instant On AP meets the same requirements.
- Ruckus: require Unleashed installed or an explicitly supported, obtainable
  conversion path. Verify region, firmware access and any feature licensing;
  do not buy a controller-dependent listing on an assumption.
- Grandstream/Zyxel: embedded/standalone management is useful, but the full
  repeatable configuration workflow has not been qualified. No reverse-
  engineered web automation project should be hidden in the purchase price.

## Power And Compatibility

The existing CSS326 is non-PoE. Include a suitable standards-compliant injector
or the correct vendor DC adapter in total cost. A 30 W 802.3at injector covers
many candidates, but not an AP requiring 802.3bt for full operation. Check the
exact hardware revision; do not assume an injector or bracket is included used.
Multi-gig APs can still be used with the existing 1 GbE switch when supported,
but the uplink will not become multi-gig without changing the switch path.

6 GHz requires compatible clients and appropriate WPA3/PMF security for personal
networks. Keep legacy WPA2 IoT on 2.4 GHz. Do not force WPA3/fast roaming/band
steering onto old clients merely to advertise newer standards. Wi-Fi 7 branding
does not itself establish 6 GHz support or better coverage through walls.

## Acceptance Before Cutover

- Verify local login and management with cloud access disabled; keep physical
  wired recovery available.
- Demonstrate the required eight-per-radio capacity if buying for that goal,
  and independent VLAN mapping in the exact intended firmware/controller mode.
- Test one private VLAN 20 client through real DHCP, DNS and public HTTPS before
  moving the remaining networks. Visible SSIDs or a ready controller are not
  end-to-end acceptance.
- Test IoT reconnection and isolation with actual devices; qualify guest through
  the existing openNDS path before re-enabling its SSID.
- Verify native backup/restore and sustained uptime, then pin accepted versions.
  Stop and return an unsuitable unit rather than start another firmware project.

## Evidence And References

- [UniFi U6 Pro](https://techspecs.ui.com/unifi/wifi/u6-pro),
  [U6 Enterprise](https://techspecs.ui.com/unifi/wifi/u6-enterprise),
  [U7 Pro](https://techspecs.ui.com/unifi/wifi/u7-pro): explicit BSSIDs per radio.
- [Omada EAP610 specifications](https://www.omadanetworks.com/ca/business-networking/omada-wifi-ceiling-mount/eap610/#specifications)
  and [EAP670](https://www.omadanetworks.com/ca/business-networking/omada-wifi-ceiling-mount/eap670/);
  [EAP773 specifications](https://www.omadanetworks.com/ca/business-networking/omada-wifi-ceiling-mount/eap773/#specifications)
  explicitly state eight SSIDs per band.
- [Grandstream GWN7660](https://www.grandstream.com/products/networking-solutions/indoor-wifi-access-points/product/gwn7660)
  and [GWN7665](https://www.grandstream.com/products/networking-solutions/indoor-wifi-access-points/product/gwn7665): product comparison tables.
- [Zyxel NWA50AX specifications](https://www.zyxel.com/global/en/products/wireless/nwa50ax/specifications),
  [NWA50AX Pro specifications](https://www.zyxel.com/global/en/products/wireless/nwa50ax-pro/specifications)
  and [current wireless catalogue](https://www.zyxel.com/global/en/products/wireless).
- [Zyxel NWA130BE specifications](https://www.zyxel.com/global/en/products/wireless/nwa130be/specifications),
  [NWA50BE MAX specifications](https://www.zyxel.com/global/en/products/wireless/nwa50be-max/specifications)
  and [NWA90BE MAX specifications](https://www.zyxel.com/global/en/products/wireless/nwa90be-max/specifications):
  bands, standalone management and power verified; retrieved pages do not state
  the per-radio SSID limit.
- [Ruckus Unleashed](https://support.ruckuswireless.com/products/82-ruckus-unleashed)
  and [Aruba 510 series documentation](https://www.hpe.com/psnow/doc/a00058595enw).
- [R550 datasheet](https://webresources.ruckuswireless.com/datasheets/r550/ds-commscope-r550.html)
  and [R650 datasheet](https://webresources.ruckuswireless.com/datasheets/r650/ds-commscope-r650.html):
  31 SSIDs per AP is not an eight-per-radio Unleashed-mode guarantee.
- [Existing Wi-Fi requirements and incident](guides/wifi-architecture.md).

Unverified capacities, prices and automation paths remain explicit purchase
holds. This document does not authorize changes to the running network.