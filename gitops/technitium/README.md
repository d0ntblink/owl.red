# Technitium DNS (DNS-first Baseline)

This folder deploys Technitium DNS on Kubernetes with a static MetalLB VIP.

## What This Deploys

- Namespace: `technitium-namespace`
- StatefulSet: `technitium` (single replica)
- Service type `LoadBalancer` at `10.0.10.30` on ports:
  - `53/udp` (DNS)
  - `53/tcp` (DNS)
  - `5380/tcp` (Technitium web UI)
- Static temporary node-local storage via:
  - PV: `technitium-pv`
  - PVC: `technitium-data`

Temporary storage mode details:
- This deployment intentionally avoids NAS/NFS dependencies.
- Data is stored on the `worker1-talos` node local filesystem (`hostPath`).
- This is an interim mode until Unraid is migrated and cluster storage is finalized.

## Security Model

- Admin password is not stored in git.
- Create secret before deploy:

```bash
kubectl -n technitium-namespace create secret generic technitium-admin \
  --from-literal=admin-password='<strong-password>'
```

## Deployment

```bash
kubectl apply -f gitops/technitium/namespace.yaml
kubectl apply -f gitops/technitium/persistent-volume.yaml
kubectl apply -f gitops/technitium/persistent-volume-claim.yaml
kubectl apply -f gitops/technitium/service-headless.yaml
kubectl apply -f gitops/technitium/service-dns-lb.yaml
kubectl apply -f gitops/technitium/statefulset.yaml
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

## Notes

- This is DNS-first. DHCP remains on OPNsense during stabilization.
- Do not expose admin UI publicly; keep it LAN-only.
- When stable storage is available again, migrate this PV/PVC back to the final storage backend.
