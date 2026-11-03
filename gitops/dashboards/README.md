# Glance Dashboard

Glance serves **https://home.owl.red** through the existing Traefik ingress,
DNS record and TLS certificate. Fleet owns this bundle. The dashboard has all
47 service shortcuts, grouped bookmarks, DuckDuckGo search, Catppuccin Mocha
by default and an optional Catppuccin Latte theme.

## Edit The Dashboard

Edit [glance.yml](glance.yml) for links, pages, widgets, feeds and theme colors.
It is Glance's native configuration, not an API import or generated subscription
database. Commit and publish the reviewed change to `main`; Fleet renders
[kustomization.yaml](kustomization.yaml), generates a content-hashed ConfigMap
and rolls the deployment automatically. No manual restart is needed.

Use bookmarks for service navigation. Each link has `title`, `url` and optional
`icon`/`description`. Icons use Glance's `di:` or `mdi:` prefixes or a full image
URL. Icons are fetched by the browser from external CDNs; no Docker socket,
Kubernetes credentials or application passwords are needed.

## Add RSS Feeds

Add an RSS widget to a page column's `widgets` list, replacing the example URL
with the feed you choose:

```yaml
- type: rss
  title: News
  style: detailed-list
  cache: 30m
  limit: 25
  collapse-after: 8
  feeds:
    - url: https://example.org/feed.xml
      title: Example
      limit: 5
```

Add/remove entries under `feeds` in Git to change subscriptions. Add another
entry under `pages` for a dedicated News page. Glance fetches feeds itself;
no subscription reconciler or database is required. No feeds have been selected
on your behalf. Glance caches articles but is not a persistent RSS inbox with
synchronized unread state or an archive.

Scheduled LLM enrichment is not deployed. A later worker can publish a private
briefing feed for an RSS widget; use `preserve-order: true` when that feed's
ordering represents relevance. Never put API tokens or article-triggered tool
execution into dashboard configuration.

## Operations

[glance.yaml](glance.yaml) pins Glance v0.8.7 by digest. One non-root, read-only
container runs without a service-account token, RBAC, persistent storage or
host mounts. Control-plane fallback scheduling remains enabled. Legacy
`homepage` resource/container names and selector are intentionally retained to
reuse the existing ingress, service and disruption-budget wiring.

The former Homepage HTTP/ping/pod badges are not recreated. Use the existing
[Gatus](../gatus/README.md) service for scheduled checks/history. A future native
Glance `monitor` widget can check selected HTTP backends, but neither a bookmark
nor a green backend check proves authenticated functionality or client access.
No access restriction is relaxed to make dashboard checks pass.

For validation, use the matching official Glance binary plus existing kubectl:

```sh
glance --config gitops/dashboards/glance.yml config:validate
kubectl kustomize gitops/dashboards
kubectl -n dashboards rollout status deployment/homepage --timeout=180s
```

Rollback is a reviewed Git revert of the dashboard replacement followed by
Fleet reconciliation. There is no dashboard database to restore. Publishing
any repository commit can also trigger the existing Technitium sync; do not
apply a second Helm release or introduce another dashboard configuration writer.
