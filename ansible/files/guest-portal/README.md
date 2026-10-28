# Guest Portal Presentation

Gateway deployment and network configuration are part of `owl.red`. The custom
Astro/TypeScript app and its artwork now live in the public
[owl.red-guest-captive-portal repository](https://github.com/d0ntblink/owl.red-guest-captive-portal).

- The app contains no PHP. Its FAS integration submits consent through native
  openNDS Authmon; openNDS owns sessions and firewall enforcement.
- App Actions publish `d0ntblink/owl.red-guest-captive-portal` to Docker Hub.
  Infrastructure must pin a qualified image digest, not deploy `latest`.
- The five original images moved into the app repository's `public` directory.
- [Original theme reference](../../../docs/reference/guest-portal-original-theme.txt)
  preserves the original copy and concept. It is reference material only, not
  a deployment script or active gateway configuration.
- [Gateway staging](../../../terraform/proxmox/guest-portal/README.md) documents
  the VM lifecycle and qualification commands.

The Grandstream is a VLAN-aware bridge, not the portal/session enforcer.
Technitium retains DHCP authority on every VLAN; the gateway only reads lease
facts.

HTTPS deployment and the production DHCP/consent/native Authmon enforcement path
are accepted on the retained gateway path. Grandstream guest Wi-Fi is active
on both bands and a phone consent flow passed. A broader handset/RF walk remains an
onsite follow-up. Publishing an app image alone never activates networking.

The migration preserved a private recovery archive outside this Git repository,
including the retired checkout's uncommitted changes. No secret, old environment
file or Git metadata was imported here.