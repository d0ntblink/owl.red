# Dashboards Bake-Off (GitOps)

This bundle deploys the selected dashboard product for ongoing operations.

- `home.owl.red`

All manifests are reconciled by Fleet from this repository.

Availability defaults in this bundle:

- Homepage runs as a single replica (cold failover model).
- Control-plane fallback tolerations are enabled for dashboard pods.
- Topology spread + anti-affinity hints remain in place for scheduler behavior.

## Selected Dashboard

Homepage is the chosen dashboard and is wired with:

- Catppuccin-inspired custom CSS
- Curated sections for Core Platform, Infrastructure, and Future Roadmap
- Clean bookmark rails for rapid navigation

## Notes

- Hostnames are expected in DNS zone data:
  - `home.owl.red`
- Traefik currently redirects HTTP to HTTPS. If certs are not yet provisioned for these hosts, browser warnings may appear until TLS policy is finalized.

## Service Health Indicators

All 45 existing services have deployed status indicators: 21 HTTP checks,
17 host pings and 7 Kubernetes pod-readiness indicators. HTTP checks use native
backend routes where authentication or ingress restrictions would otherwise
misrepresent availability. Pod readiness covers Traefik and authenticated Arr
services, using a dedicated service account with read-only `get`/`list` access
to pods in `traefik` and `arr` only. No Secrets access or write permissions are
granted. Ping indicates host reachability, not application health; Unraid stays
ping-only until its certificate is repaired.

The prepared Gatus entry adds a 22nd HTTP check, bringing source coverage to
46 services; it is not live until the Gatus and Homepage changes are published.
Browser links remain their normal hostnames; no administration allowlist is
weakened to permit monitoring. A failed monitor
can display 500 for a connection timeout; this does not mean the application
itself returned HTTP 500.

These checks show backend HTTP availability from the Homepage pod, not complete
client DNS/TLS/ingress or authenticated application functionality. They do not
send background alerts or replace Kubernetes liveness. The selected Gatus
monitor is prepared as separate Fleet bundles with retained Longhorn SQLite
history and notifications disabled. Its in-cluster placement cannot report a
total cluster outage. See [Gatus](../gatus/README.md).

ConfigMap changes need one controlled rollout because files use `subPath`.
Preserve all other live ConfigMap data and the existing replica count. The
health-indicator change was applied locally; reviewed Git publication remains
required to retain it through future Fleet reconciliation.
