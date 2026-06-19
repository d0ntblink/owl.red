# Proxmox cluster IaC — coverage, passthrough, and how to add a node

Audit of every guest on the Proxmox cluster vs. Terraform, the exact passthrough
commands, how to add a VM/LXC (incl. **adding a Talos node**), and inconsistencies to know.

Live inventory verified 2026-06-18 via the PVE API (`/cluster/resources`).

## How Terraform is run here

Three **independent** root modules (separate state each); run via the wrapper that injects
`root@pam` from Bitwarden (password auth — API tokens can't set privileged/passthrough config, see
[issue 003](../issues/003-proxmox-api-token-passthrough-restriction.md)):

```bash
scripts/terraform-run.sh -chdir=terraform/proxmox/technitium  plan   # Talos cluster + Technitium LXC
scripts/terraform-run.sh -chdir=terraform/proxmox/nas         plan   # Unraid NAS VM
scripts/terraform-run.sh -chdir=terraform/opnsense            plan   # OPNsense config (not yet init-ed)
```
Endpoint defaults to `https://10.0.10.3:8006/` (edge.pve). State is local/git-ignored ([ADR 015](../decisions/015-terraform-remote-state-deferred.md)).

## Coverage matrix (live guest → Terraform)

| VMID | Name | Node | Type | Terraform | Passthrough |
|------|------|------|------|-----------|-------------|
| 100 | `edge.owl.red` (OPNsense) | edge | VM | **scaffold** `terraform/proxmox/opnsense-vm/` (import pending) | `hostpci0=01:00`, `hostpci1=04:00` (NICs) |
| 101 | `nas.owl.red` (Unraid) | storage | VM | ✅ `terraform/proxmox/nas/nas.tf` (`started=false`, `protection=true`) | 4× `hostpci` + `usb0` |
| 200 | `technitium` | edge | LXC | ✅ `terraform/proxmox/technitium/technitium-lxc.tf` | none |
| 231 | `pdm` | cp1 | LXC | **scaffold** `terraform/proxmox/pdm/` (import pending) | none |
| 601 | `cp1-talos` | cp1 | VM | ✅ `terraform/proxmox/technitium/main.tf` (`control_planes`) | none |
| 602 | `cp2-talos` | cp2 | VM | ✅ `main.tf` | none |
| 603 | `cp3-talos` | cp3 | VM | ✅ `main.tf` | none |
| 604 | `worker1-talos` | worker1 | VM | ✅ `main.tf` (`workers`) | none |

Every guest is now represented in code. `100`/`231` are **scaffolds** — they must be
`terraform import`-ed and shown to produce **no plan diff** before any `apply` (see each file's header).

## Hardware / USB passthrough (run as root on the owning node after apply)

bpg can't manage `hostpci`/`usb` cleanly, so passthrough is applied out-of-band and documented in code.

**NAS (101), on `storage`:**
```bash
qm set 101 -hostpci0 '0000:01:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #1
qm set 101 -hostpci1 '0000:03:00,pcie=1,rombar=0'   # LSI SAS3008 HBA #2
qm set 101 -hostpci2 '0000:02:00,pcie=1,rombar=0'   # NVIDIA GTX 1060 6GB (Plex)
qm set 101 -hostpci3 '0000:06:00,pcie=1,rombar=0'   # Intel 82599ES 10G SFP+
qm set 101 -usb0     'host=24a9:205a,usb3=1'         # virtual USB license gadget (issue 004)
```
**OPNsense (100), on `edge`:**
```bash
qm set 100 -hostpci0 '0000:01:00,pcie=1'             # passthrough NIC (WAN/LAN)
qm set 100 -hostpci1 '0000:04:00,pcie=1'             # passthrough NIC
```
> `edge.owl.red` is **pinned** to `edge` (PCIe NIC passthrough) — do not migrate. Any OPNsense `.tf`
> must use `started=false` + `protection=true` so Terraform can never bounce or recreate the router.

## Add a new Talos node (the easy path)

The cluster is a `for_each` over maps in `terraform/proxmox/technitium/main.tf`, so adding a node is
one map entry + apply. Convention: VMID `60X`, IP `10.0.10.2X/16`, MAC `02:00:00:00:00:2X`.

1. **Hardware/PVE:** install Proxmox on the new mini-PC, join it to the cluster (e.g. node `worker2`),
   and put the Talos ISO on its `local:iso/` (`ansible/playbooks/04-prep-talos-iso.yml` or `pveam`/`wget`).
2. **Code** — add to `local.workers` (or `local.control_planes`) in `main.tf`:
   ```hcl
   "worker2-talos" = { node = "worker2", vmid = 605, ip = "10.0.10.25/16", mac = "02:00:00:00:00:25", cores = 4, memory = 12288 }
   ```
   The VM, the `talos_machine_configuration_apply`, and (for control planes) the VIP/etcd join all flow
   from that single entry.
3. **Repo bookkeeping** (keep these in sync — they are not auto-derived):
   - `ansible/inventory/hosts.yml` — add `worker2_pve` and `worker2_k8s`
   - `README.md` node tables, `docs/mac-inventory.md`
   - `gitops/technitium/zones/owl.red.zone` — `worker2.k8s A 10.0.10.25` + **bump SOA serial**
   - `gitops/technitium/dhcp-reservations.json` — MAC reservation
   - `talos/patches/worker2.yaml` — standalone patch (mirror of the `main.tf` inline patch)
4. **Apply:** `scripts/terraform-run.sh -chdir=terraform/proxmox/technitium apply`
5. **Verify:** `kubectl get nodes` (and `talosctl health`) shows the new node Ready.

Adding a new **non-Talos** VM/LXC: create `terraform/proxmox/<name>/` (copy `nas/` for a VM with
passthrough, or `pdm/` for an LXC), `init`, `plan`, `apply`; add passthrough via `qm set` post-apply.

## Inconsistencies / take note

1. **ROADMAP §13.2 table was stale** — it listed the Talos VMs and the NAS as "needs `.tf`", but `601–604`
   are in `main.tf` and `101` is `nas.tf`. The only true gaps were `100` (OPNsense) and `231` (PDM), now scaffolded. (ROADMAP updated.)
2. **Misleading module name:** `terraform/proxmox/technitium/` provisions the **entire Talos cluster** *and*
   the Technitium LXC — not just Technitium. Consider renaming to `…/cluster` (or splitting the LXC out).
3. **NAS VM description drift (live):** the on-Proxmox description for VM 101 is stale/contradictory — it
   claims `hostpci0=0000:02:00` and that `hostpci2/3` were "REMOVED (I350 reclaimed)", and calls the 10G NIC an
   "I350". Reality + `nas.tf` say `hostpci0=01:00` with all four present and the 10G NIC is the **82599ES**
   (the I350 is onboard host-mgmt, not passed). `nas.tf` is correct; the live description should be corrected.
4. **`started` policy differs by design:** Talos VMs `started=true` (Terraform manages power); the NAS and the
   OPNsense scaffold use `started=false` (+`protection=true`) so Terraform never starts/stops/recreates a
   stateful or pinned guest. Keep this for any router/storage guest.
5. **Passthrough is intentionally manual:** even though `terraform-run.sh` uses `root@pam` (which *can* set
   `hostpci`), passthrough stays as post-apply `qm set` (hardware-specific, set once). Don't add `hostpci` to a `.tf`.
6. **Talos uses `/16` IPs** (`10.0.10.21/16`) pending the flat-`/16` → per-VLAN-`/24` migration (ROADMAP 1.5).
7. **Talos ISO `v1.7.5` is pinned in two places** — `main.tf` (`cdrom.file_id`) and `04-prep-talos-iso.yml`.
   Bump both together when upgrading Talos.
8. **K8s control-plane VIP `10.0.10.20`** (`cluster_endpoint`) is real and now documented in the README service-VIP table.
