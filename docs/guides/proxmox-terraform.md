# Proxmox cluster IaC — coverage, passthrough, and how to add a node

Audit of every guest on the Proxmox cluster vs. Terraform, the exact passthrough
commands, how to add a VM/LXC (incl. **adding a Talos node**), and inconsistencies to know.

The coverage baseline below was recorded 2026-06-18. The
[2026-10-14 audit](../issues/008-live-state-vs-repository.md) confirms eight
running guests, but not a safe whole-root apply: Technitium has one untagged NIC
versus five tagged target NICs, and live Talos is 1.8.1 versus the 1.7.5 source/
ISO pins. Follow [G4](../../ROADMAP.md#stabilization-gates) for the touched root.
Network work does not authorize NAS VM/passthrough/disk/boot/power changes.
Current router update (2026-10-17): VyOS production VM 103 and permanent lab VM
102 are declared in their own root. The old VM 100, its disk, installer ISO and
scaffold have been explicitly retired.

## How Terraform is run here

Use **independent** root modules with separate state; the examples below are not
an exhaustive module inventory. The wrapper injects
`root@pam` from Bitwarden (password auth — API tokens can't set privileged/passthrough config, see
[issue 003](../issues/003-proxmox-api-token-passthrough-restriction.md)):

```bash
scripts/terraform-run.sh -chdir=terraform/proxmox/technitium  plan   # Talos cluster + Technitium LXC
scripts/terraform-run.sh -chdir=terraform/proxmox/nas         plan   # Unraid NAS VM
scripts/terraform-run.sh -chdir=terraform/proxmox/vyos-vm     plan   # VyOS production and permanent lab VM lifecycle
```
Endpoint defaults to `https://10.0.10.3:8006/` (edge.pve). State is local/git-ignored ([ADR 015](../decisions/015-terraform-remote-state-deferred.md)).

## Coverage matrix (live guest → Terraform)

| VMID | Name | Node | Type | Terraform | Passthrough |
|------|------|------|------|-----------|-------------|
| 102 | `edge-lab.owl.red` | edge | VM | `terraform/proxmox/vyos-vm/` (managed) | none; private virtual networking |
| 103 | `edge.owl.red` (VyOS) | edge | VM | `terraform/proxmox/vyos-vm/` (managed) | `hostpci0=01:00`, `hostpci1=04:00`, declared in Terraform |
| 101 | `nas.owl.red` (Unraid) | storage | VM | ✅ `terraform/proxmox/nas/nas.tf` (`started=false`, `protection=true`) | 4× `hostpci` + `usb0` |
| 200 | `technitium` | edge | LXC | ✅ `terraform/proxmox/technitium/technitium-lxc.tf` | none |
| 231 | `pdm` | cp1 | LXC | **scaffold** `terraform/proxmox/pdm/` (import pending) | none |
| 601 | `cp1-talos` | cp1 | VM | ✅ `terraform/proxmox/technitium/main.tf` (`control_planes`) | none |
| 602 | `cp2-talos` | cp2 | VM | ✅ `main.tf` | none |
| 603 | `cp3-talos` | cp3 | VM | ✅ `main.tf` | none |
| 604 | `worker1-talos` | worker1 | VM | ✅ `main.tf` (`workers`) | none |

Every current guest is represented in code. `231` remains a **scaffold** and must be
`terraform import`-ed and shown to produce **no plan diff** before any `apply` (see each file's header).

## Hardware / USB Passthrough Reference

The following commands record existing hardware assignments. They are not
routine post-apply steps and must not be rerun for network work. Any proposed
passthrough change requires separate approval, live hardware verification and a
guest-specific recovery plan. Existing assignments are not being changed here.

**NAS (101), on `storage`:**
```bash
qm set 101 -hostpci0 '0000:01:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #1
qm set 101 -hostpci1 '0000:03:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #2
qm set 101 -hostpci2 '0000:02:00,pcie=1,rombar=0'   # NVIDIA GTX 1060 6GB (Plex)
qm set 101 -hostpci3 '0000:06:00,pcie=1,rombar=0'   # Intel 82599ES 10G SFP+
qm set 101 -usb0     'host=24a9:205a,usb3=1'         # virtual USB license gadget (issue 004)
```
**VyOS (103), on `edge`:** its two exclusive PCI assignments are owned by
[the VM root](../../terraform/proxmox/vyos-vm/main.tf). They are not a manual
post-apply step. VM 100 no longer exists; never replay its old `qm set` commands.
> `edge.owl.red` is **pinned** to `edge` (PCIe NIC passthrough); do not migrate it.
> `started=false` and `protection=true` are configuration values, not a guarantee
> that Terraform cannot stop or recreate a guest. Verify installed-provider
> semantics, lifecycle rules and the exact plan before any apply. Reject
> unintended power, replacement or hardware actions instead of relying on flags.

## Add a new Talos node (the easy path)

The cluster uses `for_each` maps in `terraform/proxmox/technitium/main.tf`.
The example below uses the accepted native-LAN `/24`, not VLAN activation approval.
Match the currently approved subnet/version plan and first prove that a reviewed
plan adds only the new node; existing cluster/LXC drift must not be applied with it.

1. **Hardware/PVE:** install Proxmox on the new mini-PC, join it to the cluster (e.g. node `worker2`),
   and put the Talos ISO on its `local:iso/` (`ansible/playbooks/04-prep-talos-iso.yml` or `pveam`/`wget`).
2. **Code** — add to `local.workers` (or `local.control_planes`) in `main.tf`:
   ```hcl
   "worker2-talos" = { node = "worker2", vmid = 605, ip = "10.0.10.25/24", mac = "02:00:00:00:00:25", cores = 4, memory = 12288 }
   ```
   The VM, the `talos_machine_configuration_apply`, and (for control planes) the VIP/etcd join all flow
   from that single entry.
3. **Repo bookkeeping** (keep these in sync — they are not auto-derived):
   - `ansible/inventory/hosts.yml` — add `worker2_pve` and `worker2_k8s`
   - [Device inventory](../device-inventory.md) — physical host and guest records
   - `gitops/technitium/zones/owl.red.zone` — `worker2.k8s A 10.0.10.25` + **bump SOA serial**
   - `gitops/technitium/dhcp-reservations.json` — MAC reservation
   - `talos/patches/worker2.yaml` — standalone patch (mirror of the `main.tf` inline patch)
4. **Review, then apply the approved plan only:** reject changes to existing guests, NICs, versions, passthrough or power which are not part of adding this node
5. **Verify:** `kubectl get nodes` (and `talosctl health`) shows the new node Ready.

For a new **non-Talos** VM/LXC use a suitable existing root as a reference, then
review resource identity, state, storage, network and power behavior. Do not copy
NAS/router hardware assignments or execute their passthrough reference commands
as boilerplate.

## Inconsistencies / take note

1. **ROADMAP §13.2 table was stale** — it listed the Talos VMs and the NAS as "needs `.tf`", but `601–604`
   are in `main.tf` and `101` is `nas.tf`. VM 100 has since been retired; only `231` (PDM) still has the noted scaffold/import gap.
2. **Misleading module name:** `terraform/proxmox/technitium/` provisions the **entire Talos cluster** *and*
   the Technitium LXC — not just Technitium. Consider renaming to `…/cluster` (or splitting the LXC out).
3. **NAS VM description drift (live):** the on-Proxmox description for VM 101 is stale/contradictory — it
   claims `hostpci0=0000:02:00` and that `hostpci2/3` were "REMOVED (I350 reclaimed)", and calls the 10G NIC an
   "I350". Reality + `nas.tf` say `hostpci0=01:00` with all four present and the 10G NIC is the **82599ES**
   (the I350 is onboard host-mgmt, not passed). `nas.tf` is correct; the live description should be corrected.
4. **Power flags are not lifecycle guarantees:** the source uses different `started`
   values for Talos and NAS/router guests. Reconcile actual provider/state behavior
   and review the plan; do not infer "never starts/stops/recreates" from those flags.
5. **Passthrough ownership is guest-specific:** VyOS hardware is declared in Terraform. NAS assignments above remain a protected historical/manual floor; do not move them or add a second writer during network work.
6. **Talos management uses `/24` IPs** after the completed prefix migration. That does not activate tagged VLANs or authorize an unrelated root apply.
7. **Talos source/ISO pin is not the live version:** 1.7.5 is recorded in `main.tf`
   and `04-prep-talos-iso.yml`, while the October audit found 1.8.1 running. Reconcile
   boot media, machine configuration, state and live versions before an explicit
   upgrade plan; do not silently upgrade or downgrade during network work.
8. **K8s control-plane VIP `10.0.10.20`** (`cluster_endpoint`) is real and now documented in the README service-VIP table.
