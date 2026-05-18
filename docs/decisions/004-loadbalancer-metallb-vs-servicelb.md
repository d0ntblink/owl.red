# Decision: Adopt MetalLB Immediately

## Status

Selected and implemented during Phase 3.

## Quick Summary

| Area | Decision |
|------|----------|
| Load balancer model | MetalLB |
| Addressing model | Static VIP pool in VLAN 10 |
| Primary ingress VIP | `10.0.10.201` for Traefik |
| Reason | Deterministic LAN service IP ownership from day one |

## Context

This is a homelab. Priority is learning core Kubernetes concepts with the lowest operational complexity that still supports reliable service access.

Current requirement:
- Expose Traefik and selected apps on the LAN.
- Avoid adding hard-to-debug networking layers too early.
- Keep room to evolve into static VIPs later if needed.

## Options Compared

| Option | Complexity | Learning Value | Fits Current Needs | Notes |
|---|---|---|---|---|
| ServiceLB-style node IP exposure (no dedicated LB controller) | Low | Medium | No (selected architecture requires explicit VIP ownership) | Operationally simple but less deterministic for service IP ownership |
| MetalLB (L2/BGP) | Medium | High (advanced LB behavior) | Optional | Better for static VIP pools and clear service IP ownership |
| kube-vip for services | Medium | Medium | Optional | Good for control-plane VIP and can do service VIPs, but more moving parts |

## Decision

Adopt **MetalLB** immediately during the Phase 3 baseline installation on Talos + vanilla Kubernetes.

We will define a static VIP pool in VLAN 10 (e.g., `10.0.10.200-250`) to ensure clear, stable, and explicitly owned service endpoints from day one, avoiding the technical debt of transitioning later.

## Why This Is The Best Fit Now

- You explicitly requested the cleaner architecture of MetalLB.
- It prevents having to migrate DNS and ingress controllers later.
- Dedicated VIPs provide much cleaner integration with Technitium DNS and OPNsense firewalling.

## Risks And Mitigations

- Risk: MetalLB L2 advertisement issues can temporarily blackhole VIP traffic after node/network events.
  Mitigation: keep a single, explicit `L2Advertisement`, test failover after node drain/reboot, and monitor ARP resolution from each VLAN.
- Risk: VIP pool overlap with static/DHCP allocations causes intermittent address conflicts.
  Mitigation: reserve and document `10.0.10.200-250` in DHCP/IPAM as a dedicated MetalLB-only range.

## Validation Gates

- Validate Traefik is reachable on LAN via chosen DNS name.
- Validate at least two sample apps work through ingress with TLS.
- Validate node restart behavior for exposed services.

## Implementation Path

1. Define VIP pool in VLAN 10 (`10.0.10.200-250`).
2. Install MetalLB and announce pool.
3. Expose Traefik as a `LoadBalancer` service with explicit VIP assignment (`10.0.10.201`).
4. Point DNS records (for example `rancher.owl.red`) at the Traefik VIP.

## Consequences

- Initial setup includes one additional controller compared to node-IP exposure, but gives deterministic VIP ownership.
- MetalLB VIP pool `10.0.10.200-250` is active from baseline.
- Documentation and runbooks should treat this pool as production service-address space, not deferred capacity.
