# Decision 011: PDM on Proxmox LXC HA (No VPN)

## Status

Accepted

## Context

PDM should not run in-cluster in this environment. We want lower operational complexity, no VPN dependency for LAN management, and predictable failover behavior.

## Decision

Deploy Proxmox Datacenter Manager as a Proxmox LXC service and manage it with Proxmox HA in active-passive mode.

- Endpoint: `pdm.owl.red` -> `10.0.10.31:8443`
- VPN sidecars (`WireGuard`, `Tailscale`) are disabled.
- Kubernetes only routes ingress traffic to this endpoint.

## Why this option

- Aligns with Proxmox-native lifecycle and HA controls.
- Removes stateful Docker-in-Kubernetes coupling for this control-plane app.
- Keeps management path LAN-local and simple.

## Requirements

- Minimum 3-node Proxmox cluster with quorum.
- Shared storage for true CT failover (Proxmox HA requirement).
- HA resource configured for `ct:<vmid>` with node affinity rule.

## Risks

- Without shared storage, failover is not reliable.
- Active-passive still has brief restart downtime on node failure.
- HA groups are deprecated in Proxmox VE 9; prefer HA node-affinity rules.

## Operational notes

- Configure PDM TLS directly in the LXC, or keep Traefik upstream TLS handling as currently used.
- Keep PBS integration deferred until NAS/storage readiness is complete.
