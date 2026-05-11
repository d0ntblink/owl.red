# Dashboards Bake-Off (GitOps)

This bundle deploys three dashboard products side-by-side so you can choose your winner with real traffic, real links, and the same infrastructure context.

- `flame.owl.red`
- `homepage.owl.red`
- `homer.owl.red`

All manifests are reconciled by Fleet from this repository.

## Sales Floor

### Flame Representative

You want velocity and no nonsense. Flame is the closer for teams that need a launcher that gets out of your way. It is fast, practical, and ruthless about keeping your critical links one click away. In this deployment it is wired with:

- Catppuccin-inspired CSS and title defaults
- Ingress auto-discovery support (via Kubernetes annotations)
- Seeded links via idempotent API job for now-and-later services

Pitch: if you need an ops launchpad that feels like a command deck, Flame wants your signature.

### Homepage Representative

You want polish and information density. Homepage is your premium control surface: rich cards, flexible layout, and deep service widget ecosystem. In this deployment it is wired with:

- Catppuccin-inspired custom CSS
- Curated sections for Core Platform, Infrastructure, and Future Roadmap
- Clean bookmark rails for rapid navigation

Pitch: if dashboard UX and extensibility matter, Homepage is selling you long-term upside.

### Homer Representative

You want speed, clarity, and static reliability. Homer is the minimalist rainmaker: simple YAML, instant render, and low operational drag. In this deployment it is wired with:

- Catppuccin color overrides in native Homer config
- Grouped service cards for now and later targets
- Lightweight static footprint for fast page loads

Pitch: if you value deterministic simplicity and maintainability, Homer is asking for the deal today.

## Notes

- Hostnames are expected in DNS zone data:
  - `flame.owl.red`
  - `homepage.owl.red`
  - `homer.owl.red`
- Traefik currently redirects HTTP to HTTPS. If certs are not yet provisioned for these hosts, browser warnings may appear until TLS policy is finalized.
- Default Flame password is currently sourced from `dashboard-flame-auth` secret and is set to a placeholder. Rotate it immediately.
