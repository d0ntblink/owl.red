# Guest Portal Presentation

The captive portal is part of `owl.red`. This directory owns its presentation
and reusable artwork. The separate OpenWrt portal project is retired and its
local checkout has been removed.

- `theme.php` customizes native openNDS FAS presentation; authentication remains
  owned by openNDS. HTTPS deployment is still in progress.
- The five image files were imported unchanged from the retired project.
- [Original theme reference](../../../docs/reference/guest-portal-original-theme.txt)
  preserves the original copy and concept. It is reference material only, not
  a deployment script or active gateway configuration.
- [Gateway staging](../../../terraform/proxmox/guest-portal/README.md) documents
  the VM lifecycle and qualification commands.

Do not restore the retired project's OpenWrt deployment script, routing, NAT,
DHCP configuration or AP-hosted portal. OpenWrt remains bridge-only. Technitium
retains DHCP authority on every VLAN; the gateway only reads lease facts.

The migration preserved a private recovery archive outside this Git repository,
including the retired checkout's uncommitted changes. No secret, old environment
file or Git metadata was imported here.