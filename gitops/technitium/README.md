# Technitium DNS (Fleet + Git-Managed Records)

This folder deploys Technitium DNS on Kubernetes with a static MetalLB VIP and enforces the `owl.red` zone records from Git.

## What This Deploys

- Namespace: `technitium-namespace`
- StatefulSet: `technitium` (single replica)
- DNS service type `LoadBalancer` at `10.0.10.30` on ports:
  - `53/udp` (DNS)
  - `53/tcp` (DNS)
- Internal web service: `technitium-web` (`ClusterIP`)
- Web UI ingress host: `https://dns.owl.red` (Traefik)
- Static temporary node-local storage via:
  - Active PV: `technitium-pv-ha`
  - Active PVC: `technitium-data-ha`
  - Legacy PV/PVC retained for rollback: `technitium-pv`, `technitium-data`
- Fleet bundle metadata: `fleet.yaml`
- Git-owned DNS zone source: `dns-zone-configmap.yaml`
- In-cluster drift correction:
  - `dns-sync-script-configmap.yaml`
  - `dns-zone-sync-cronjob.yaml`

Temporary storage mode details:
- This deployment intentionally avoids NAS/NFS dependencies.
- Active storage is node-local (`hostPath`) and no longer explicitly pinned to `worker1-talos`.
- Because this is still local `hostPath` storage, true stateful failover is limited until shared storage is adopted.
- This is an interim mode until Unraid is migrated and cluster storage is finalized.

## Security Model

Secrets are not stored in Git.

1. Create the Technitium admin password secret:

```bash
kubectl -n technitium-namespace create secret generic technitium-admin \
  --from-literal=admin-password='<strong-password>'
```

2. Create an API token in Technitium (recommended: dedicated automation user with least privilege), then create the Kubernetes secret used by the sync CronJob:

```bash
kubectl -n technitium-namespace create secret generic technitium-api-token \
  --from-literal=token='<technitium-api-token>'
```

## Deployment

Fleet is the preferred path. If you need break-glass/manual apply, use:

```bash
kubectl apply -f gitops/technitium/namespace.yaml
kubectl apply -f gitops/technitium/persistent-volume-ha.yaml
kubectl apply -f gitops/technitium/persistent-volume-claim-ha.yaml
kubectl apply -f gitops/technitium/persistent-volume.yaml
kubectl apply -f gitops/technitium/persistent-volume-claim.yaml
kubectl apply -f gitops/technitium/service-headless.yaml
kubectl apply -f gitops/technitium/service-dns-lb.yaml
kubectl apply -f gitops/technitium/service-web.yaml
kubectl apply -f gitops/technitium/ingress-web.yaml
kubectl apply -f gitops/technitium/statefulset.yaml
kubectl apply -f gitops/technitium/dns-zone-configmap.yaml
kubectl apply -f gitops/technitium/dns-sync-script-configmap.yaml
kubectl apply -f gitops/technitium/dns-zone-sync-cronjob.yaml
```

## Readiness Check (Bounded Timeout)

Use a pessimistic timeout so rollout checks fail fast and return diagnostics instead of hanging indefinitely:

```bash
kubectl rollout status statefulset/technitium -n technitium-namespace --timeout=180s || {
  echo "Technitium rollout timed out. Collecting diagnostics..."
  kubectl -n technitium-namespace get pod,svc,pvc,events
  kubectl -n technitium-namespace describe pod technitium-0
  kubectl -n technitium-namespace logs technitium-0 --tail=200 || true
  exit 1
}
```

## DNS Drift Protection Check

Run one manual sync job to validate API token + import path immediately:

```bash
kubectl -n technitium-namespace create job --from=cronjob/technitium-zone-sync technitium-zone-sync-manual
kubectl -n technitium-namespace logs job/technitium-zone-sync-manual --tail=200
```

Then verify a known record:

```bash
dig @10.0.10.30 rancher.owl.red +short
```

## Notes

- This is DNS-first. DHCP remains on OPNsense during stabilization.
- Technitium web UI is reachable at `https://dns.owl.red`.
- Do not expose admin UI publicly; keep it LAN-only.
- Update the SOA serial in `dns-zone-configmap.yaml` whenever records are changed.
- Manual web UI record edits are temporary and will be overwritten by the scheduled sync.
- When stable storage is available again, migrate this PV/PVC back to the final storage backend.
