# Glance Dashboard

Glance serves **https://home.owl.red** through the existing Traefik ingress,
DNS record and TLS certificate. Fleet owns this bundle. The dashboard has all
47 service shortcuts, grouped bookmarks, DuckDuckGo search, Catppuccin Mocha
by default and an optional Catppuccin Latte theme.

## Contents

- [Configuration layout](#configuration-layout)
- [Add RSS feeds](#add-rss-feeds)
- [Create a News page](#create-a-news-page)
- [Arrange feeds and articles](#arrange-feeds-and-articles)
- [Other content widgets](#other-content-widgets)
- [Service links and monitoring](#service-links-and-monitoring)
- [Themes and branding](#themes-and-branding)
- [Split configuration into files](#split-configuration-into-files)
- [Validate and publish](#validate-and-publish)
- [Troubleshooting](#troubleshooting)
- [Operations](#operations)

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

## Configuration Layout

Run the commands below from the repository root. The configuration files are:

| File | Edit For |
|------|----------|
| [glance.yml](glance.yml) | Pages, service links, subscriptions, widgets, themes and branding |
| [kustomization.yaml](kustomization.yaml) | Files mounted into the Glance container |
| [glance.yaml](glance.yaml) | Image version, resources and Kubernetes deployment |

The nesting is `pages` -> `columns` -> `widgets`. An RSS widget's subscriptions
are under its `feeds` list. Keep the existing top-level `pages:` key; do not
create a second one. YAML indentation matters: use spaces, not tabs. Quote
values containing YAML punctuation, such as a title containing `: `.

The first page is the home page. Other pages appear in the navigation without
needing DNS records or ingress changes. Desktop pages support up to three
columns, with one or two `full` columns; `small` columns are fixed-width sidebars.
On mobile, Glance provides column navigation at the bottom of the screen.

## Add RSS Feeds

Add an RSS widget to a page column's `widgets` list, replacing the example URL
with the feed you choose. This is a **widget fragment**, not a whole file:

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

Use the RSS or Atom URL, not the site's ordinary homepage URL. The example.org
URLs throughout this guide are placeholders, not recommended sources or working
subscriptions. No feeds have been selected on your behalf.

To subscribe to another source, append another entry under the same `feeds`:

```yaml
feeds:
  - url: https://example.org/feed.xml
    title: Source One
    limit: 5
  - url: https://example.net/atom.xml
    title: Source Two
    limit: 5
```

Change a subscription by editing its URL/title. Unsubscribe by removing its
entire list entry. Publish the change through Git; there is no separate import,
database update or API reconciler. Removing a feed removes it from that widget,
not from another widget where you also configured it. Glance is not a durable
article archive or synchronized read/unread inbox.

## Create A News Page

Append this **page fragment** after the existing Home page, at the same
indentation as `- name: Home` under `pages:`. Do not replace the Home page or
paste a new top-level `pages:` key:

```yaml
- name: News
  slug: news
  width: wide
  columns:
    - size: full
      widgets:
        - type: rss
          title: Technology
          style: detailed-list
          cache: 30m
          limit: 25
          collapse-after: 8
          feeds:
            - url: https://example.org/technology.xml
              title: Technology Source
              limit: 5
    - size: full
      widgets:
        - type: rss
          title: Security
          style: detailed-list
          cache: 1h
          limit: 20
          collapse-after: 6
          feeds:
            - url: https://example.net/security.xml
              title: Security Source
              limit: 5
```

After reconciliation, open **https://home.owl.red/news** or choose News in the
navigation. To create another topic page, repeat with a unique name and slug.

## Arrange Feeds And Articles

| Setting | Effect |
|---------|--------|
| Widget `limit` | Maximum articles shown across that widget's feeds |
| Feed `limit` | Caps one source so a frequent publisher cannot dominate |
| `collapse-after` | Initially visible article count; `-1` disables collapsing |
| `cache: 30m` | Reuses fetched results for 30 minutes; not a persistent article store or a scheduled LLM job |
| `style: detailed-list` | Titles with descriptions/categories; suited to full columns |
| `style: vertical-list` | Compact list; suitable for full columns or sidebars |
| `style: horizontal-cards` | Thumbnail cards; suited to full columns |
| `preserve-order: true` | Preserves source ordering rather than the normal date ordering |

Use separate RSS widgets for topics you want to scan independently. To show
those widgets as tabs, put them inside a `group` widget:

```yaml
- type: group
  widgets:
    - type: rss
      title: Technology
      feeds:
        - url: https://example.org/technology.xml
    - type: rss
      title: Security
      feeds:
        - url: https://example.net/security.xml
```

With `preserve-order: true`, entries from earlier feeds can fill the widget
before later feeds contribute. Use per-feed limits, or a single ranked briefing
feed, when order represents importance. This option does not perform ranking,
deduplication, story clustering or AI summarization.

Scheduled LLM enrichment is not deployed. A later worker can publish a private
briefing feed for an RSS widget; use `preserve-order: true` when that feed's
ordering represents relevance. Keep original source links and publish a separate
briefing rather than modifying source articles. An enrichment failure must not
prevent ordinary feeds or the dashboard from loading.

## Other Content Widgets

These are optional **widget fragments**, added under a column's `widgets`.
The repositories below are examples; release tracking does not update software.

### Software Releases

```yaml
- type: releases
  title: Software Releases
  cache: 6h
  limit: 15
  collapse-after: 5
  show-source-icon: true
  repositories:
    - glanceapp/glance
    - jellyfin/jellyfin
```

GitHub permits limited anonymous API requests. Start with a short repository
list and a long cache. Errors caused by rate limits are not fixed by refreshing
more often. Add credentials only through a separately configured private Secret.

### YouTube Channels

```yaml
- type: videos
  title: Videos
  style: vertical-list
  limit: 10
  collapse-after: 5
  channels:
    - REPLACE_WITH_YOUTUBE_CHANNEL_ID
```

Use the channel's actual ID, not its handle, name or browser URL. Native videos
widgets and ordinary RSS widgets are separate options; a creator's RSS URL can
instead go directly in an RSS widget.

### Search

Home already has a DuckDuckGo search widget. Edit its `search-engine` or add
search shortcuts with `bangs`:

```yaml
- type: search
  search-engine: duckduckgo
  new-tab: true
  bangs:
    - title: GitHub
      shortcut: "!gh"
      url: https://github.com/search?q={QUERY}
```

This changes search navigation, not RSS subscriptions or the local LLM.

## Service Links And Monitoring

Add links inside an existing bookmark group's `links` list:

```yaml
links:
  - title: Example Service
    url: https://example.org
    icon: mdi:server
    description: Optional short description
```

Keep normal browser URLs for navigation. An icon such as `di:jellyfin` comes
from Dashboard Icons; `mdi:server` comes from Material Design Icons. If an icon
is missing, use a supported alternative or a verified image URL. Some Dashboard
Icons exist only as PNG and need an explicit suffix, such as `di:name.png`.

Core Platform, Media, Transfers and Network Tools use native monitor widgets
with `style: compact` for 18 HTTP checks. This reduces their visual footprint
without custom CSS. Each keeps its normal browser link while checking a known
backend endpoint where needed. Authenticated Arr applications, Traefik,
infrastructure, cameras and recovery links remain bookmarks rather than
displaying misleading authentication failures as outages.

Results are fetched on page load and reused for one minute. Refresh the page
after the cache expires to fetch fresh results; these widgets do not poll in
the background or send alerts. A login page returning 200 establishes HTTP
availability, not authenticated application health. No passwords, pod-read RBAC,
TLS bypasses or accepted-error status overrides are added.

Use [Gatus](../gatus/README.md) for existing scheduled health checks/history.
To add another lightweight Glance HTTP-status widget, this example uses Gatus's known
internal health endpoint while retaining its normal browser URL:

```yaml
- type: monitor
  title: Service Availability
  cache: 1m
  sites:
    - title: Gatus
      url: https://gatus.owl.red
      check-url: http://gatus.gatus.svc.cluster.local/health
      icon: di:gatus
```

Checks originate from the Glance pod. An admin ingress may correctly return
403 from there even when your browser works. Use a legitimate backend health
endpoint where appropriate; do not relax an allowlist, disable TLS verification
or add broad privileges to make a status indicator green. HTTP status does not
prove authenticated application functionality. Bookmarks have no health checks.

## Themes And Branding

Use the theme picker to choose the default dark theme or `catppuccin-latte`.
Edit `theme` in [glance.yml](glance.yml) to change the default palette. Glance's
theme colors use **HSL triples**, not hex strings. Existing Mocha Mauve is
`267 84 81`; preserve separate success and failure colors.

Under `branding`, `logo-text` changes the navigation label and `app-name`
configures supported app branding. A page's `name` is its navigation title.
Custom logos, favicons and CSS require a served assets directory or a reachable
image/CSS URL; a repository file does not automatically become a browser asset.
See the shared [design guide](../../docs/guides/design-and-theming.md).

## Split Configuration Into Files

Keep one file until it becomes inconvenient. Glance supports native includes;
for example, move the complete News page list entry into a sibling `news.yml`
starting with `- name: News` at its top level, and replace that page in
`glance.yml` with:

```yaml
- $include: news.yml
```

The existing Home page stays under `pages:`. Add `news.yml` to the existing
`configMapGenerator.files` list in [kustomization.yaml](kustomization.yaml),
alongside `glance.yml`, so Fleet actually mounts it. Commit both configuration
files and the Kustomize change together. Keep the leading `-` in the included
page file: Glance v0.8.7 inserts its list directly, rather than wrapping a page
mapping in a list for you. Includes are expanded by Glance before
YAML parsing, so validation line numbers may differ from the original files.
Do not enable Fleet template preprocessing for Glance secret expressions.

## Validate And Publish

Use the matching official **v0.8.7** Glance binary for native validation. It is
a controller validation tool, not another dashboard deployment. Existing
[controller prerequisites](../../docs/guides/controller-setup.md) cover Git and
kubectl. From the repository root:

```sh
glance --config gitops/dashboards/glance.yml config:validate
kubectl kustomize gitops/dashboards > /dev/null
git diff --check
git diff -- gitops/dashboards
```

Validation checks syntax/configuration, not whether placeholder feeds exist,
whether a provider permits requests or whether an external icon loads. Replace
placeholders before publishing. Do not put feed-access tokens, API keys, passwords
or secret-bearing URLs in Git. Private feeds need a separately reviewed
Bitwarden/Kubernetes Secret integration; none is configured in this bundle.

After reviewing the change, stage only the intended files. For an edit confined
to the existing main configuration:

```sh
git add -- gitops/dashboards/glance.yml
git diff --cached --stat
git commit -m "Update Glance feeds"
git push origin main
```

Check staged changes for unrelated work before committing. For includes, stage
the additional files and Kustomize change too. Fleet consumes the published
branch, not unsaved editor buffers or local-only commits. No `kubectl apply`,
imperative Helm upgrade or manual ConfigMap edit is part of the normal workflow.

To observe an update:

```sh
kubectl -n fleet-local wait --for=jsonpath='{.status.commit}'="$(git rev-parse HEAD)" gitrepo/owl-red --timeout=180s
kubectl -n dashboards rollout status deployment/homepage --timeout=180s
kubectl -n fleet-local get bundle owl-red-gitops-dashboards
```

Fleet's fetched commit can advance before the dashboard template is applied;
`rollout status` may still describe the previous revision. Confirm the new
content in the browser and the bundle's Ready state. ConfigMap content hashes
trigger a rollout. Glance also supports native file reload, but this deployment
deliberately uses Kustomize's versioned ConfigMaps for deterministic updates.
Reloading or restarting clears Glance's in-memory feed cache.

To undo a feed/widget edit, reverse that edit in Git, validate and publish again.
Use `git revert <commit>` only when that commit contains solely the intended
change. Do not revert unrelated work or use `git reset --hard`.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| No News page | Page must be under the existing `pages` list; confirm it was committed and pushed |
| Service group missing on mobile | Use Glance's bottom column navigation |
| Feed error indicator | Open the widget error details; check the feed URL, provider response and pod logs |
| Old articles | Check source publication dates and widget cache; date errors originate in some feeds |
| One source dominates | Lower that feed's `limit`; check `preserve-order` |
| Duplicate stories | Avoid duplicate subscriptions; Glance is not a cross-source story-clustering engine |
| News disappeared after removing a feed | Expected: Glance is not an article archive |
| Missing icon | Verify library/name/file extension; browser CDN access may differ from pod access |
| Valid locally, pod fails | Check included files are in the ConfigMap and environment/Secret references exist |
| Change never appears | Check published branch, Fleet bundle state and actual live ConfigMap reference |

Read bounded logs without dumping private configuration:

```sh
kubectl -n dashboards logs deployment/homepage -c homepage --tail=80
kubectl -n dashboards get pods
kubectl -n dashboards get deployment homepage -o jsonpath='{.spec.template.spec.volumes[0].configMap.name}'
```

Do not post raw logs publicly if you later add authenticated feeds: URLs and
provider error messages can contain private information. Repeated reloads clear
caches and can worsen upstream API limits. Fix invalid source configuration in
Git rather than repeatedly restarting the container.

## Operations

[glance.yaml](glance.yaml) pins Glance v0.8.7 by digest. One non-root, read-only
container runs without a service-account token, RBAC, persistent storage or
host mounts. Control-plane fallback scheduling remains enabled. Legacy
`homepage` resource/container names and selector are intentionally retained to
reuse the existing ingress, service and disruption-budget wiring.

The former Homepage ping/pod badges are not recreated. Use the existing
[Gatus](../gatus/README.md) service for scheduled checks/history. Native
Glance `monitor` widgets check selected HTTP backends, but neither a bookmark
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
