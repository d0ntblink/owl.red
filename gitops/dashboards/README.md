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
