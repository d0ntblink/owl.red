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

LibreSpeed and Speedtest Tracker use Homepage's native `siteMonitor` checks
against their internal Service URLs. Browser links remain their normal HTTPS
hostnames; no administration allowlist is weakened to permit monitoring.
The indicators were verified in the deployed Homepage UI. A failed monitor
can display 500 for a connection timeout; this does not mean the application
itself returned HTTP 500.

These checks show backend HTTP availability from the Homepage pod, not complete
client DNS/TLS/ingress or authenticated application functionality. They do not
send background alerts or replace Kubernetes liveness. A separately selected
monitor such as Gatus can provide scheduled checks, history and notifications;
its placement must allow the outages it is expected to detect.

ConfigMap changes need one controlled rollout because files use `subPath`.
Preserve all other live ConfigMap data and the existing replica count. The
health-indicator change was applied locally; reviewed Git publication remains
required to retain it through future Fleet reconciliation.
