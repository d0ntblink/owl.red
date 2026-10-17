# Changing owl.red — which tool owns what

Install and verify the owning lane's prerequisites from
[Controller Setup And Tool Requirements](controller-setup.md) before running
the commands below. Document new tool/script dependencies there when adding them.

Pick the right place to make a change. Ownership follows [ADR 007](../decisions/007-terraform-vs-ansible-boundaries.md):
**Terraform** provisions infrastructure, **Ansible** configures mutable hosts,
**Fleet** owns Kubernetes resources, and the **Technitium LXC systemd sync**
applies Git-managed DNS/DHCP data. Some appliance settings have an explicit
**Manual** floor. Edit the owning source, check the affected diff/state, use the
approved execution lane, and verify runtime results plus rollback access.

For networking follow the [roadmap execution order](../../ROADMAP.md#execution-order).
VyOS retains client DNS/DHCP during preparation; the final handoff waits for
supporting VLAN paths/interfaces. Existing reservations are a target plan, not
proof of VLAN membership. This work does not authorize NAS VM/passthrough/disk/
array/boot/power or unrelated service changes.

| I want to… | Tool / lane | Where |
|------------|-------------|-------|
| Provision / resize / destroy a **VM or LXC** | **Terraform** | `terraform/proxmox/<host>/` after state/plan review; passthrough is a separate explicitly approved operation, not a routine post-apply — see [proxmox-terraform.md](proxmox-terraform.md) |
| Add a **new Talos k8s node** | **Terraform** | node map in `terraform/proxmox/technitium/main.tf` — see [proxmox-terraform.md](proxmox-terraform.md) |
| Change **Unraid settings** | see [unraid-making-changes.md](unraid-making-changes.md) | Terraform-GraphQL / Ansible / Manual |
| Configure a **Proxmox host OS** (repos, NIC hardening, baseline, upgrades) | **Ansible** | `ansible/playbooks/*` + `ansible/roles/*` |
| Configure the **MikroTik switch** (ports, VLANs, names) | **Ansible** (SwOS modules) | `ansible/playbooks/swos-*.yml` + `ansible/switch_configs/css326.yml` |
| Add/change a **DNS record** | **Git-managed Technitium data, LXC systemd sync** | `gitops/technitium/zones/owl.red.zone` (bump SOA); publishing triggers reconciliation, not Fleet |
| Add/change a **DHCP scope** or a **host's reserved IP** | **Git-managed Technitium target; actual serving authority is migration-dependent** | `gitops/technitium/dhcp/scopes.json` / `dhcp-reservations.json`; coordinate scope lifecycle and lease authority before applying/publishing |
| Deploy/change a **k8s app** | **GitOps** (Fleet) | `gitops/<app>/` + add the path to the GitRepo in `gitops/rancher/fleet/` |
| Add a **k8s secret** | **Bitwarden + operator** | `scripts/bitwarden-k8s-secrets-sync.sh` → `gitops/bitwarden-secrets/` (never a placeholder `bwSecretId`) |
| Change **VyOS** interfaces, routes, firewall/NAT, DNS/DHCP, NTP or IDS configuration | **Native config through Ansible** | [Native template](../../vyos/config.boot.j2), [profiles](../../vyos/baseline.yml), private inputs and the reviewed candidate/confirmed-commit/save lane; [ADR 022](../decisions/022-vyos-router-replacement.md). No parallel Terraform router-config writer. |
| Change **VyOS VM hardware/lifecycle** | **Terraform** | [Production/lab root](../../terraform/proxmox/vyos-vm/main.tf); declared direct PCI ownership for VM 103, isolated virtual networking for VM 102. |
| Bootstrap a **new host/LXC** | **Terraform lifecycle, then Ansible/NixOS configuration** | Extend the owning root and reusable configuration path; do not add an imperative guest-creation script or keep a completed migration runner. |
| Change **NTP** for a host | per host | **Unraid** → Terraform (`terraform/unraid`); **Proxmox** → Ansible (chrony); **Talos** → machine config; LAN NTP authority is VyOS `10.0.10.1` (ROADMAP 16.1). |
| Change a **host's IP** | depends on current authority and address method | Leased address: active DHCP owner's lane plus the target registry; static: that host's Talos/Ansible/appliance lane. Update masks, gateway, routes and VLAN attachment as a reviewed transition, not by reservation alone. |
| Mount / change **shared storage** (NFS PVCs, Proxmox shared disks) | per consumer | NAS is the store ([ADR 018](../decisions/018-storage-backend.md)). Export config → Ansible file-lane; k8s CSI → Fleet; Proxmox `pvesm` → Ansible. Full plan: [shared-storage.md](shared-storage.md) |

**Stay Manual (never IaC):** array/disk/pool layout & parity, local users, license, secret material (keys/certs/WG).
**Publishing requires review:** Fleet and Technitium read `origin/main`, not
working-tree edits. Terraform/Ansible follow their own execution lanes. Any new
SHA, including docs-only, can trigger Technitium's full settings/zone/scope sync;
coordinate transition guards before pushing. A successful sync or source edit
does not prove runtime convergence.
