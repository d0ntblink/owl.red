# Decision: Talos Linux + Vanilla Kubernetes (Supersedes ADR 001)

## Status

Selected: Implemented during Phase 3

## Context

ADR 001 proposed K3s as the Kubernetes distribution. K3s bundles a number of opinionated components:
- **Traefik** as the default ingress controller
- **ServiceLB (klipper-lb)** as the default load balancer
- **Flannel** as the CNI
- **SQLite/embedded etcd** for the control plane data store
- **Local-path-provisioner** for storage

While these defaults reduce initial setup time, they introduce hidden coupling. When we pivoted to Talos Linux as the OS (ADR 006), Talos runs **vanilla upstream Kubernetes**, not K3s. The two are architecturally incompatible at the OS layer.

## Decision

Replace K3s with **vanilla Kubernetes** as bootstrapped by Talos Linux.

Talos manages the Kubernetes control plane (kubelet, kube-apiserver, kube-scheduler, kube-controller-manager, etcd) natively as part of its OS abstraction. There is no separate Kubernetes distribution to install.

## Implications: Components That Must Be Explicitly Installed

Because vanilla Kubernetes ships with none of K3s's bundled components, the following must be provisioned deliberately as GitOps-managed Helm releases:

| Component | K3s Bundled | Vanilla K8s via Talos | Chosen Solution |
|---|---|---|---|
| **Ingress Controller** | Traefik (auto) | None | Traefik (Helm) |
| **Load Balancer** | ServiceLB/Klipper | None | MetalLB (ADR 004) |
| **CNI** | Flannel (auto) | Flannel (Talos default) | Flannel (Talos managed) |
| **Storage** | local-path-provisioner | None | TBD Phase 4+ |
| **GitOps** | None | None | Rancher Fleet (Helm via Rancher) |

## Why This Is The Best Fit

- Vanilla Kubernetes has zero opinionated defaults that hide complexity.
- Every component is explicitly chosen, versioned, and GitOps-managed — consistent with the project's core principles.
- Talos manages the Kubernetes lifecycle (upgrades, certs, etcd) automatically.
- No dependency on K3s's release cadence or embedded component versions.

## Consequences

- Traefik must be installed via Helm; it is no longer auto-provisioned.
- MetalLB must be installed before any `LoadBalancer` service type will work.
- All cluster-level services are Helm releases, tracked in Git.
- Break-glass is via `talosctl` and `kubectl`; no K3s-specific tooling.
