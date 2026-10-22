# owl.red

Infrastructure as code for a self-hosted home network, virtualization platform
and Kubernetes cluster.

## Architecture

- **Network:** VyOS routing and firewall policy, MikroTik switching, OpenWrt
  wireless access, and Technitium DNS/DHCP.
- **Compute:** Proxmox infrastructure guests and Talos Kubernetes nodes,
  with Rancher Fleet managing Kubernetes deployments.
- **Storage:** Unraid centralizes application and infrastructure data;
  deployment configuration stays in Git and credentials stay in Bitwarden.
- **Services:** Traefik and cert-manager provide ingress and TLS; Mailgun
  provides automated email delivery.

Guest VLAN 30 is enforced by native openNDS on a separate Debian gateway;
the [Astro portal](https://github.com/d0ntblink/owl.red-guest-captive-portal)
serves consent at `https://guest.owl.red`. The AP is bridge-only. See the
[Wi-Fi architecture](docs/guides/wifi-architecture.md) for the accepted four-SSID
layout, VLAN paths and access rules.

| Network | Purpose |
|---------|---------|
| Native management / VLAN 10 | Infrastructure administration |
| VLAN 20 | Trusted clients |
| VLAN 30 | Guest access |
| VLAN 40 | Local-only IoT |
| VLAN 50 | Internet-connected IoT |

## Configuration

| Location | Responsibility |
|----------|----------------|
| [terraform/](terraform/) | Virtual machines and supported appliance APIs |
| [ansible/](ansible/) | Host and network-appliance configuration |
| [vyos/](vyos/) | Router configuration and image definition |
| [gitops/](gitops/) | Fleet services and DNS/DHCP definitions |
| [nix/](nix/) | NixOS systems and reproducible environments |
| [unraid/](unraid/) | NAS configuration references |
| [scripts/](scripts/) | Controller tools and entry points |

Public Cloudflare DNS is managed in the separate
[cloudflare-iac](https://github.com/d0ntblink/cloudflare-iac) repository.
Use the documented configuration lane for each resource and preserve
production data during infrastructure changes.

## Documentation

- [Documentation index](docs/README.md): current runbooks, reference and historical context.
- [Roadmap](ROADMAP.md): unfinished work and priorities.
- [Device inventory](docs/device-inventory.md): hardware, interfaces and placement.
- [Change guide](docs/guides/changing-owl-red.md): which tool to use for a change.
- [Controller setup](docs/guides/controller-setup.md): tools and prerequisites.
- [Architecture decisions](docs/decisions/): design rationale.
- [Operational guides](docs/guides/): deployment and maintenance procedures.
- [Security policy](SECURITY.md): credentials, access and data protection.