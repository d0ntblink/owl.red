# owl.red Glossary

Plain-language definitions of the tools, protocols, and custom resources used in
this repo, each grounded in how `owl.red` actually uses it. Where a term maps to a
file, ADR, or issue in this repo, it is linked.

Conventions: **CR** = Kubernetes Custom Resource, **CRD** = Custom Resource
Definition, **VIP** = Virtual IP.

---

## GitOps, Fleet & Rancher

### GitOps
An operating model where Git is the single source of truth for infrastructure and
a controller continuously reconciles the cluster to match what's committed. In
`owl.red`, you change a file under `gitops/`, push to `main`, and Fleet applies it —
you do not `kubectl apply` by hand (except documented break-glass). Consequence we
hit repeatedly this project: **a change has no effect until it is pushed to
`origin/main`**, because the reconciler reads the remote, not your working tree.

### Rancher
A Kubernetes management platform (runs in the `cattle-system` namespace, reachable
at `rancher.owl.red` → `10.0.10.201`). Provides the UI/API for cluster management and
ships Fleet as its GitOps engine.

### Fleet
Rancher's GitOps controller. It watches a Git repo and reconciles declared paths
into one or more clusters. Pipeline:

```
GitRepo  →  Bundle (one per path)  →  BundleDeployment (one per target cluster)  →  live objects
```

### GitRepo (`gitrepo.fleet.cattle.io`)
The Fleet CR that is the **GitOps entrypoint**: it points at a repo + branch and
lists which paths to reconcile. In `owl.red` the live object is `owl-red` in the
`fleet-local` namespace, defined by
[`gitops/rancher/fleet/gitrepo-owl-red-fleet-local.yaml`](../gitops/rancher/fleet/gitrepo-owl-red-fleet-local.yaml).
Key fields:
- `spec.repo` + `spec.branch` — the watched remote (`…/owl.red.git`, `main`).
- `spec.paths` — each entry becomes one `owl-red-gitops-<name>` Bundle.
- `spec.clientSecretName` — the Git credential Secret (`owl-red-github-auth`).
- `status.commit` — the SHA Fleet has pulled (compare to `git rev-parse origin/main`).
- `spec.forceSyncGeneration` — bump it to force an immediate re-pull instead of
  waiting for the poll interval:
  `kubectl -n fleet-local patch gitrepo owl-red --type=merge -p '{"spec":{"forceSyncGeneration":'"$(date +%s)"'}}'`

### Bundle (`bundle.fleet.cattle.io`)
The unit Fleet builds from one GitRepo path — effectively a packaged set of
manifests (or a Helm chart). `kubectl get bundle -A` is the first place to check
deployment health; the `owl-red-gitops-*` rows correspond 1:1 to the `spec.paths`
list. Ownership boundaries between bundles are governed by
[ADR 014](decisions/014-fleet-bundle-ownership-boundaries.md).

### BundleDeployment
The per-target-cluster instance of a Bundle (lives in a `cluster-fleet-local-…`
namespace). This is where the *actual* apply happens, so its status is more truthful
than the Bundle summary. Diagnostic we used: when
`status.appliedDeploymentID != spec.deploymentID`, the agent hasn't rolled the
desired revision forward (a wedge — see [issue 006](issues/006-fleet-ssa-field-ownership-conflict.md)).

### fleet.yaml
Per-bundle options file in a path (e.g. [`gitops/traefik/fleet.yaml`](../gitops/traefik/fleet.yaml)).
Sets `defaultNamespace`, Helm chart/version/values, and `helm.takeOwnership: true`
(used in `owl.red` to adopt pre-existing out-of-band resources instead of failing on
ownership metadata — see ADR 014 / issue 006).

### fleet-local vs fleet-default
Fleet namespaces for **where** GitRepos target. `fleet-local` = the local management
cluster itself (what `owl.red` uses, since the cluster manages its own workloads).
`fleet-default` = downstream/managed clusters registered to Rancher.

### gitjob
The Fleet component (in `cattle-fleet-system`) that clones the repo and renders
Bundles. If `status.commit` on the GitRepo is stale, gitjob is where to look.

### fleet-agent
The per-cluster agent (in `cattle-fleet-local-system`) that applies BundleDeployments
using **server-side apply** under field manager `fleetagent`. Its field-manager
identity is central to [issue 006](issues/006-fleet-ssa-field-ownership-conflict.md).

---

## Kubernetes Core

### Namespace
A virtual cluster partition for grouping/scoping objects (e.g. `metallb-system`,
`cert-manager`, `technitium`, `cattle-system`).

### Deployment / StatefulSet / DaemonSet
Workload controllers. **Deployment** = stateless, interchangeable replicas (Rancher,
cert-manager). **StatefulSet** = stable identity/storage per replica (the *old* k8s
Technitium, retired in [ADR 013](decisions/013-technitium-single-resolver-all-vlans.md)).
**DaemonSet** = one pod per node (e.g. MetalLB speaker).

### Service
A stable virtual endpoint load-balancing to a set of pods. Types used here:
`ClusterIP` (internal), `LoadBalancer` (gets an external VIP from MetalLB).

### Endpoints / EndpointSlice
The actual backend IPs behind a Service. `owl.red` uses a **manual `Endpoints`
object** to point a k8s Service at a non-k8s host — e.g.
[`gitops/technitium-ingress/service.yaml`](../gitops/technitium-ingress/service.yaml)
points `dns.owl.red` traffic at the Technitium **LXC** at `10.0.10.30:5380`, and
[`gitops/pdm/pdm-service.yaml`](../gitops/pdm/pdm-service.yaml) at the PDM LXC.

### Ingress / IngressRoute
Rules for routing external HTTP(S) into Services by hostname/path. `Ingress` is the
standard k8s kind (used for `pdm.owl.red`); **`IngressRoute`** is Traefik's richer CRD
(used for `dns.owl.red` in [`gitops/technitium-ingress/ingressroute.yaml`](../gitops/technitium-ingress/ingressroute.yaml)).

### ConfigMap / Secret
Config and sensitive data injected into pods. In `owl.red`, Secrets are **not**
hand-written into Git — they come from Bitwarden via the operator (ADR 003). A Secret
also has a **type** (`Opaque`, `kubernetes.io/tls`, `fleet.cattle.io/bundle-deployment`)
which matters: see [issue 007](issues/007-bitwarden-secrets-swept-controller-managed.md).

### CRD / CR
**CustomResourceDefinition** extends the Kubernetes API with a new kind; a **Custom
Resource** is an instance of it. Nearly everything novel in this stack is a CR:
`GitRepo`, `Bundle`, `IPAddressPool`, `Certificate`, `ClusterIssuer`, `BitwardenSecret`.

### Controller / Operator / Reconcile
A control loop that drives live state toward declared (`spec`) state and reports
`status`. An **operator** is a controller that manages a CRD (e.g. the Bitwarden
Secrets operator manages `BitwardenSecret`). "Reconcile" = one pass of that loop.

### Server-Side Apply (SSA) & field managers
A Kubernetes apply mode where each writer (a "field manager") owns the fields it
sets, and the API server rejects conflicting writes from a different manager. Root
cause of the metallb wedge in [issue 006](issues/006-fleet-ssa-field-ownership-conflict.md):
a stale `kubectl-client-side-apply` manager co-owned `.spec.ipAddressPools`, so
`fleetagent` couldn't change it. Fix: re-assert with
`kubectl apply --server-side --force-conflicts --field-manager=fleetagent`.

### ownerReference / cascade delete
Metadata linking a child object to its owner; deleting the owner garbage-collects the
child. We audited these before pruning manifests so removing a `BitwardenSecret`
wouldn't cascade-delete a live secret ([issue 007](issues/007-bitwarden-secrets-swept-controller-managed.md)).

### Taint / Toleration / Affinity
Scheduling controls. A **taint** repels pods from a node (control-plane nodes
`cp1–cp3` are tainted); a **toleration** lets a pod ignore a taint;
**(anti-)affinity / topologySpreadConstraints** steer pods toward/away from nodes for
HA. See [`gitops/platform-resilience/`](../gitops/platform-resilience/).

### PodDisruptionBudget (PDB)
A floor on how many replicas must stay up during *voluntary* disruptions (node drain,
upgrade). `owl.red` keeps PDBs for rancher, fleet-agent, and metallb-controller.

### kubeconfig
The client credential/context file for reaching the cluster API. Sensitive — never
committed (SECURITY.md); the Talos-generated ones are git-ignored.

---

## Networking

### VLAN (802.1Q)
Layer-2 network segmentation over one physical link using tagged frames. `owl.red`
runs five: 10 infra, 20 private, 30 guest, 40 IoT-local, 50 IoT-internet (see
[`README.md`](../README.md)). A **trunk** port carries multiple tagged VLANs; an
**access** port carries one untagged VLAN.

### Subnet / CIDR / gateway
An IP range (e.g. `10.0.10.0/24`) and its router address (`10.0.10.1`). The project
is mid-migration from a flat `/16` to per-VLAN `/24` (ROADMAP 1.5); `/16` references
in `talos/` and inventory are expected until then.

### DHCP
Hands out IP leases. In `owl.red`, **Technitium** is the sole DHCP authority for all
VLANs (ADR 013); ranges are `10.0.x.100–199`, with MAC **reservations** for known
hosts in [`gitops/technitium/dhcp-reservations.json`](../gitops/technitium/dhcp-reservations.json).

### DNS / authoritative / recursive / forwarder
Name resolution. **Authoritative** = owns a zone's records (Technitium owns
`owl.red`); **recursive** = resolves on a client's behalf; **forwarder** = upstream a
resolver defers to (Technitium → `1.1.1.1`). Zone file:
[`gitops/technitium/zones/owl.red.zone`](../gitops/technitium/zones/owl.red.zone).

### Zone file / SOA / record types
A zone file lists DNS records. **SOA** (Start of Authority) carries the serial —
**bump it on every change** or secondaries won't refresh. **A** = name→IPv4,
**NS** = nameserver, **CNAME** = alias, **MX/TXT** = mail/verification.

### VIP (Virtual IP)
An IP not bound to one physical NIC, used as a stable service front. `owl.red` ingress
VIP is `10.0.10.201` (Traefik via MetalLB); the MetalLB pool is `10.0.10.200–250`.

### MetalLB / IPAddressPool / L2Advertisement
Bare-metal LoadBalancer implementation (no cloud LB available). It assigns external
IPs from an **`IPAddressPool`** ([`gitops/metallb/ippool.yaml`](../gitops/metallb/ippool.yaml),
`owl-vip-pool`) and announces them via **`L2Advertisement`** (ARP/L2). The orphaned
`technitium-vip-pool` cleanup is documented in [issue 006](issues/006-fleet-ssa-field-ownership-conflict.md).

### Captive portal (RFC 8910/8908)
The guest-WiFi splash/auth flow on VLAN 30 at `captive.owl.red`, signaled to clients
via DHCP Option 114. Enforced by OPNsense.

### Break-glass path
A reserved, always-reachable management route (a VLAN 10 recovery port) used to
recover from a lockout during switch/firewall changes. A hard rule throughout
[`setup.md`](../setup.md).

### WAN / LAN / NAT
**WAN** = internet-facing uplink (OPNsense `igb0`); **LAN** = internal networks;
**NAT** = address translation between them. Note: the operator works from **WSL**,
which is itself NAT'd behind Windows — hence the ProxyJump patterns in Ansible.

---

## Virtualization & Hosts

### Proxmox VE (PVE)
The open-source hypervisor running on every physical node (`*.pve.owl.red`). Hosts
both VMs and LXC containers. VM/LXC lifecycle is owned by Terraform (ADR 005/007).

### LXC (Linux container, Proxmox)
A lightweight OS-level container managed by Proxmox (not Docker/k8s). `owl.red` runs
Technitium (VMID 200) and PDM (VMID 231) as LXCs because they must start before — and
not depend on — Kubernetes (ADR 011, ADR 013).

### VM / VMID / passthrough
A full virtual machine; **VMID** is its Proxmox numeric id (OPNsense 100, Unraid 101,
Talos 601–604). **PCIe/HBA/GPU passthrough** gives a VM direct hardware access (e.g.
OPNsense's NIC, Unraid's HBAs + GPU) — which pins that VM to its host (no live
migration) and limits API-token automation ([issue 003](issues/003-proxmox-api-token-passthrough-restriction.md)).

### Talos Linux
A minimal, **immutable, API-driven** Kubernetes OS — no SSH, no shell (ADR 006/008).
Configured by machine-config YAML + per-node patches ([`talos/patches/`](../talos/patches/)),
applied with `talosctl`. The four k8s nodes (`cp1–cp3`, `worker1`) are Talos VMs.

### Cluster / control-plane / worker / etcd / quorum
A **control-plane** node runs the API server and **etcd** (the cluster's key-value
store of record); **worker** nodes run general workloads. **Quorum** = the majority of
etcd members needed to stay writable — with 3 control-plane nodes, one can fail.

### Proxmox HA / PDM / PBS
**HA** = Proxmox high-availability restart of a VM/LXC on another node (needs shared
storage). **PDM** = Proxmox Datacenter Manager (`pdm.owl.red`, multi-cluster mgmt).
**PBS** = Proxmox Backup Server (`pbs.owl.red`, planned).

### Unraid / NAS
The storage server (`nas.owl.red`), currently bare-metal, serving NFS/SMB and Plex;
planned migration to a PVE VM (ROADMAP/Phase 9). Target shared storage for cluster
PVCs.

### IPMI / BMC
Out-of-band server management (power/console) independent of the OS — the
Supermicro X10SRi-F's BMC at `ipmi.storage.owl.red` (`10.0.10.6`).

### PDU / UPS / WoL / NUT
**PDU** = switched rack power (`pdu.owl.red`). **UPS** = battery backup.
**WoL** = Wake-on-LAN. **NUT** = the daemon that triggers staged shutdown/recovery on
power events (see README "Power and Recovery").

---

## Secrets, Certificates & Storage

### Bitwarden PM vs Secrets Manager (SM/BWS)
Two products (ADR 003). **Password Manager (`bw`)** — Ansible/infra secrets at
runtime. **Secrets Manager (`bws`)** — machine-account-driven secrets for Kubernetes,
synced by the operator. The `BWS_ACCESS_TOKEN` lives only in the git-ignored
`env.secret`.

### BitwardenSecret (CR) / sm-operator / bw-auth-token
The CR (`k8s.bitwarden.com/v1`) that tells the **sm-operator** to pull values from
BWS into a native k8s Secret. Each target namespace needs a `bw-auth-token` (the
machine-account token). Manifests live in
[`gitops/bitwarden-secrets/generated/`](../gitops/bitwarden-secrets/generated/).
**Caution** ([issue 007](issues/007-bitwarden-secrets-swept-controller-managed.md)):
only *human-provided* credentials belong here — never controller-rotated secrets, or
the operator overwrites live values.

### cert-manager / Certificate / ClusterIssuer
Automates TLS. A **`Certificate`** CR requests a cert; a **`ClusterIssuer`**
(`letsencrypt-prod`) defines the CA/ACME account. `owl.red` issues for `dns.owl.red`
via [`gitops/technitium-ingress/certificate.yaml`](../gitops/technitium-ingress/certificate.yaml).

### ACME / DNS-01 / HTTP-01
ACME is the Let's Encrypt protocol. **DNS-01** proves domain control by creating a
TXT record (used here, via the **Cloudflare API token** — its empty-token outage is
[issue 007](issues/007-bitwarden-secrets-swept-controller-managed.md)). **HTTP-01**
proves it over HTTP — unusable for internal-only names, which is *why* DNS-01 is used.

### Traefik
The ingress controller / reverse proxy (ADR 009). Terminates TLS and routes by
hostname to backends; exposed on VIP `10.0.10.201`. Config in
[`gitops/traefik/`](../gitops/traefik/).

### Wildcard / SNI
A **wildcard** cert (`*.owl.red`) covers all subdomains. **SNI** = the TLS extension
where the client states the hostname so the server picks the right cert.

### PV / PVC / StorageClass / CSI / NFS
Kubernetes storage: a **PVC** (claim) binds to a **PV** (volume), provisioned per a
**StorageClass** by a **CSI** driver. `owl.red` has no shared storage yet (ROADMAP 4);
planned **NFS** export from Unraid, then possibly Longhorn.

---

## Automation & Tooling

### Terraform / OpenTofu / provider
Declarative infrastructure provisioning. Owns VM/LXC lifecycle and infra primitives
(ADR 005/007) via the `bpg/proxmox` and `browningluke/opnsense` providers. State files
are sensitive and git-ignored (SECURITY.md).

### Ansible / playbook / role / inventory / module
Imperative host configuration (ADR 007): Proxmox prep/upgrade, NIC hardening, SwOS,
the Technitium LXC. **Inventory** = hosts/groups ([`ansible/inventory/hosts.yml`](../ansible/inventory/hosts.yml));
**role** = reusable task bundle; **module** = a unit of work (incl. the custom
`swos` module).

### Idempotent / check mode / drift
**Idempotent** = re-running yields the same state (safe to repeat). **Check mode**
(`--check`) = dry-run. **Drift** = live state diverging from declared state (e.g. a
manual UI edit Fleet/Technitium then overwrites).

### OPNsense / SwOS / OpenWrt
Appliance OSes: **OPNsense** = the router/firewall/captive-portal (`edge.owl.red`);
**SwOS** = the MikroTik CSS326 switch OS, configured from
[`ansible/switch_configs/css326.yml`](../ansible/switch_configs/css326.yml);
**OpenWrt** = the D-Link WAP (`ap.owl.red`).

### NixOS
The declarative Linux distro running the Technitium LXC — its whole config (Technitium
service, sync timer, SSH) is one file:
[`nix/hosts/technitium/configuration.nix`](../nix/hosts/technitium/configuration.nix).

### ADR (Architecture Decision Record)
A short doc capturing a decision, its context, and trade-offs. All in
[`docs/decisions/`](decisions/). Supersession is tracked (e.g. ADR 008 supersedes 001).

---

## owl.red Hostname Quick Map

| Name | Resolves to | What |
|------|-------------|------|
| `edge.owl.red` | `10.0.10.1` | OPNsense router/firewall |
| `edge.pve.owl.red` | `10.0.10.3` | Proxmox host for OPNsense + Technitium |
| `ns1.owl.red` | `10.0.10.30` | Technitium DNS/DHCP LXC (authoritative) |
| `dns.owl.red`, `rancher.owl.red`, `home.owl.red`, `traefik.owl.red` | `10.0.10.201` | Traefik ingress VIP |
| `pdm.owl.red` | `10.0.10.201` (ingress) → LXC `10.0.10.31` | Proxmox Datacenter Manager |
| `nas.owl.red` | `10.0.10.5` | Unraid storage / Plex |
| `switch.owl.red` | `10.0.10.2` | MikroTik CSS326 |
| `ap.owl.red` | `10.0.10.40` | OpenWrt WAP |

See [`README.md`](../README.md) for the full inventory.
