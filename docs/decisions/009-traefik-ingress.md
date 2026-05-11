# Decision: Traefik as Ingress Controller

## Status

Selected: Phase 3 baseline

## Context

Vanilla Kubernetes (as bootstrapped by Talos) does not include an ingress controller. K3s previously bundled Traefik automatically. Since we are now on vanilla Kubernetes (ADR 008), an ingress controller must be explicitly chosen and deployed.

## Options Compared

| Option | Pros | Cons |
|---|---|---|
| **Traefik v3** | Already familiar from K3s baseline. Native Let's Encrypt. Dashboard. Middleware ecosystem. Good Rancher compatibility. | Slightly more config than nginx for simple cases. |
| **ingress-nginx** | Simplest battle-tested option. Widest community examples. | No built-in cert management. Requires cert-manager for TLS. Separate dashboard tooling. |
| **Cilium Gateway API** | Modern, eBPF-native. Eliminates separate CNI and LB. | Requires replacing Flannel CNI. Significant added complexity at this stage. |

## Decision

Deploy **Traefik v3** via Helm as the ingress controller for the cluster.

Install into `traefik` namespace. Expose via MetalLB `LoadBalancer` service.

```bash
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik \
  -n traefik --create-namespace \
  --set service.type=LoadBalancer
```

## Consequences

- All ingress resources use `ingressClassName: traefik`.
- TLS termination is handled by Traefik + cert-manager (installed separately).
- Traefik dashboard will be available internally for debugging ingress routing.
- MetalLB must be installed before Traefik to assign its LoadBalancer IP.
