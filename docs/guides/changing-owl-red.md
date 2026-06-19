# Changing owl.red — which tool owns what

Pick the right place to make a change. Ownership follows [ADR 007](../decisions/007-terraform-vs-ansible-boundaries.md):
**Terraform** provisions (create/destroy infra), **Ansible** configures existing hosts, **GitOps/Fleet** owns
in-cluster + DNS/DHCP desired-state, **scripts/** are one-off bootstraps, and a few things stay **Manual**.
Workflow everywhere: edit the source of truth → run the apply for that lane → done.

| I want to… | Tool / lane | Where |
|------------|-------------|-------|
| Provision / resize / destroy a **VM or LXC** | **Terraform** | `terraform/proxmox/<host>/` (+ `qm set` passthrough post-apply) — see [proxmox-terraform.md](proxmox-terraform.md) |
| Add a **new Talos k8s node** | **Terraform** | node map in `terraform/proxmox/technitium/main.tf` — see [proxmox-terraform.md](proxmox-terraform.md) |
| Change **Unraid settings** | see [unraid-making-changes.md](unraid-making-changes.md) | Terraform-GraphQL / Ansible / Manual |
| Configure a **Proxmox host OS** (repos, NIC hardening, baseline, upgrades) | **Ansible** | `ansible/playbooks/*` + `ansible/roles/*` |
| Configure the **MikroTik switch** (ports, VLANs, names) | **Ansible** (SwOS modules) | `ansible/playbooks/swos-*.yml` + `ansible/switch_configs/css326.yml` |
| Add/change a **DNS record** | **GitOps** (Technitium, Fleet-synced) | `gitops/technitium/zones/owl.red.zone` — **bump the SOA serial** |
| Add/change a **DHCP scope** or a **host's reserved IP** | **GitOps** (Technitium) | `gitops/technitium/dhcp/scopes.json` / `dhcp-reservations.json` |
| Deploy/change a **k8s app** | **GitOps** (Fleet) | `gitops/<app>/` + add the path to the GitRepo in `gitops/rancher/fleet/` |
| Add a **k8s secret** | **Bitwarden + operator** | `scripts/bitwarden-k8s-secrets-sync.sh` → `gitops/bitwarden-secrets/` (never a placeholder `bwSecretId`) |
| Change **OPNsense** (firewall, aliases, DNS overrides) | **Terraform** | `terraform/opnsense/` |
| Add a **new bootstrap script** (one-off host/LXC provisioning) | **scripts/** + Terraform for the resource | write `scripts/<name>.sh`; then codify the created resource in `terraform/proxmox/<x>/` (don't leave it script-only) |
| Change **NTP** for a host | per host | **Unraid** → Terraform (`terraform/unraid`); **Proxmox** → Ansible (chrony); **Talos** → machine config; the LAN NTP authority is OPNsense `10.0.10.1` (ROADMAP 16.1) |
| Change a **host's IP** | depends | reserved IP → Technitium DHCP (above); static-in-OS → that host's lane (Talos config / Ansible / Unraid manual `network.cfg`) |

**Stay Manual (never IaC):** array/disk/pool layout & parity, local users, license, secret material (keys/certs/WG).
**Always push:** a change has no effect until it's committed and pushed to `origin/main` (Fleet/Technitium reconcile from git).
