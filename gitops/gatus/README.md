# Gatus

Fleet deployment for `https://gatus.owl.red`, accepted on 2026-10-31.
The owner selected Kubernetes placement and dashboard/history only.

## Deployment

- Maintained upstream chart `1.5.0`, Gatus `v5.34.0`.
- One replica, `Recreate`, native `/health` readiness and liveness probes.
- Restricted pod security, non-root, read-only root filesystem, no capabilities
  or Kubernetes service-account token.
- SQLite history at `/data/gatus.db` on a 2 GiB `longhorn-appdata` claim.
  This uses retained ext4 V1 storage with three replicas, not NAS SMB or PostgreSQL.
- Bounded history: 1,000 results and 100 events per endpoint. This is a count
  limit, not a time-retention guarantee or backup.
- Notifications are intentionally disabled. No new alert secret is needed.

The separate `gatus-ingress` bundle owns the certificate and Traefik route.
It permits only native management `10.0.10.0/24` and owner `10.0.20.10/32`.
This is a network allowlist, not user authentication. Flannel does not provide
enforced application NetworkPolicy isolation in this cluster.

## Check Semantics

Two HTTPS checks cover Homepage and the guest portal through DNS, certificate
verification and Traefik. Three native backend HTTP checks cover LibreSpeed,
Speedtest Tracker and Seerr: their administration-restricted HTTPS routes
correctly return 403 to an in-cluster source, so those allowlists stay intact.
In-cluster
source access may differ from a phone's access policy: these are not physical
guest-Wi-Fi acceptance tests. Three infrastructure checks cover the internal DNS
answer and NAS SMB/PostgreSQL TCP listeners. An open listener does not prove
that filesystem operations or database queries work.

This initial set does not replace all Homepage indicators or certify every
application. TLS verification stays enabled; Unraid certificate repair remains
deferred. Each check runs every 60 seconds with a five-second timeout.

Gatus can record NAS service outages while Kubernetes and Longhorn are working.
It cannot observe or send an alert during a total Kubernetes/Longhorn outage.
Three storage replicas are neither an independent monitor nor a backup.

## Operations And Acceptance

Publish only reviewed Gatus, ingress, Fleet-path, DNS and Homepage changes.
Do not install a competing Helm release or overwrite the live GitRepo's paths
with an unchecked template. Source publication also triggers Technitium's
existing full synchronization and DHCP quiescence behavior.

Acceptance requires Fleet ownership and a ready single replica, a bound retained
claim, native health HTTP 200, persisted SQLite history, trusted HTTPS through
the administration allowlist and a rendered Homepage entry. These passed for
the deployed monitor: all eight initial checks were healthy, historical result
timestamps survived a controlled `Recreate`, and an unapproved in-cluster HTTPS
source received 403. The volume is healthy with three replicas and both Gatus
Fleet bundles have matching desired/applied deployment IDs. No API token is
mounted, and the restricted security settings were checked live.

Homepage's earlier imperative service-list update blocked Fleet with an SSA
ownership conflict. The complete guarded ConfigMap was transferred back to the
actual `fleetagent` manager, preserving all unrelated data. A controlled mount
refresh then exposed the healthy Gatus entry while keeping Homepage at one
replica. Fleet convergence for the dashboard bundle must be checked separately
from an HTTP success or a correct mounted file.

Rollback stops the new writer and removes only the new route/monitor resources.
Keep the retained claim and its volume unless deletion is separately approved.
Revert only the Gatus DNS/paths/Homepage additions, preserving other changes.