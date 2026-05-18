# Technitium DNS and VLAN 10 DHCP

This bundle runs Technitium on Kubernetes, serves authoritative DNS for `owl.red`, and owns the VLAN 10 DHCP scope and reservations.

## Quick Reference

| Item | Value |
|------|-------|
| Namespace | `technitium-namespace` |
| DNS VIP | `10.0.10.30` |
| Web UI | `https://dns.owl.red` |
| DNS zone source | `dns-zone-configmap.yaml` |
| VLAN 10 DHCP source | `dhcp-reservations.json` |
| VLAN 10 scope | `vlan10-network-devices` |
| VLAN 10 range | `10.0.10.100-199` |
| DHCP split | Technitium for VLAN 10, OPNsense for VLANs 20/30/40/50 |
| Active storage mode | Node-local `hostPath` via `technitium-pv-ha` / `technitium-data-ha` |
| Drift correction | `dns-zone-sync-cronjob.yaml` + `dns-sync-script-configmap.yaml` |

## Bundle Contents

| Area | Files |
|------|-------|
| Core runtime | `namespace.yaml`, `statefulset.yaml`, `service-headless.yaml`, `service-dns-lb.yaml`, `service-web.yaml`, `ingress-web.yaml` |
| Active storage | `persistent-volume-ha.yaml`, `persistent-volume-claim-ha.yaml` |
| Rollback storage | `persistent-volume.yaml`, `persistent-volume-claim.yaml` |
| DNS desired state | `dns-zone-configmap.yaml` |
| DNS drift correction | `dns-sync-script-configmap.yaml`, `dns-zone-sync-cronjob.yaml` |
| Fleet metadata | `fleet.yaml` |

## Bootstrap Secrets

Secrets stay out of Git.

```bash
kubectl -n technitium-namespace create secret generic technitium-admin \
  --from-literal=admin-password='<strong-password>'

kubectl -n technitium-namespace create secret generic technitium-api-token \
  --from-literal=token='<technitium-api-token>'
```

Use a dedicated Technitium automation token with least privilege for the sync CronJob.

## Deployment

Fleet is the preferred path. For break-glass manual apply:

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

## Validation

| Check | Command | Expected result |
|------|---------|-----------------|
| Rollout | `kubectl rollout status statefulset/technitium -n technitium-namespace --timeout=180s` | StatefulSet becomes ready |
| Pod diagnostics | `kubectl -n technitium-namespace get pod,svc,pvc,events` | Pod running, PVC bound |
| Manual DNS sync | `kubectl -n technitium-namespace create job --from=cronjob/technitium-zone-sync technitium-zone-sync-manual` | Manual job starts and completes |
| Sync logs | `kubectl -n technitium-namespace logs job/technitium-zone-sync-manual --tail=200` | No import or auth failure |
| Record lookup | `dig @10.0.10.30 rancher.owl.red +short` | Git-defined value returns |

## Operating Notes

- Manual DNS record edits in the web UI are drift and will be overwritten by the scheduled sync.
- Update the SOA serial in `dns-zone-configmap.yaml` whenever the zone file changes.
- VLAN 10 reservations should be kept aligned with `dhcp-reservations.json`.
- This deployment intentionally avoids NAS or NFS dependencies for now.
- Because storage is still local `hostPath`, stateful failover remains limited until shared storage is introduced.
