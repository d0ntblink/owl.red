# PDM Integration (GitOps)

This bundle exposes the Proxmox Datacenter Manager LXC endpoint through Traefik at `https://pdm.owl.red`.

## Scope

- PDM runtime is an LXC container managed by Proxmox HA (active-passive failover).
- Kubernetes only provides ingress integration to the LXC endpoint.
- PBS remains intentionally deferred until NAS/storage readiness.

## Objects

- Namespace: `infra-services`
- Service + Endpoints: `pdm-external` -> `10.0.10.31:8443`
- Ingress host: `pdm.owl.red`

## Notes

- No VPN sidecars are required for LAN-only management access.
- Proxmox HA for containers requires shared storage for true automatic failover.
- Bootstrap automation lives at `scripts/pdm-lxc-ha-bootstrap.sh` and should be run from a Proxmox cluster node.
- Temporary deployment (2026-05-12): `ct:231` is running on `cp1` with non-shared `local-lvm` storage and node-affinity rule `pdm-temp-node-affinity`.
- TODO: After NAS/shared storage is ready, rebuild PDM on shared storage and replace temporary cp1-pinned rule with true multi-node HA policy.
