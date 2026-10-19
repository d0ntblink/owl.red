# Management Ingress

Fleet owns the pinned Traefik chart and its custom resources through
[values.yaml](values.yaml). The internal MetalLB VIP remains `10.0.10.201`.
Three replicas use control-plane tolerations and preferred spreading.

## TLS

Global backend certificate verification is enabled. The only scoped exception
is PDM's [ServersTransport](../pdm/pdm-serverstransport.yaml), referenced by
the PDM Service, not its Ingress. Do not restore a global bypass to repair
one backend.

The `management-ingress` Certificate uses the existing `letsencrypt-prod`
ClusterIssuer and DNS-01 automation for `traefik.owl.red`, `home.owl.red` and
`pdm.owl.red`. Its Secret supplies both the dashboard and the default TLSStore.
Rancher and Technitium retain separate Certificates. Private keys remain in
Kubernetes Secrets, never chart values or Git.

The [cert-manager controller](../cert-manager-controller/fleet.yaml) is pinned
to its existing version and uses public recursive resolvers only for DNS-01
self-checks. Internal split DNS does not contain the public ACME TXT records.
Normal client DNS and the separate scoped Cloudflare automation token remain
unchanged. Issuers stay in [their own bundle](../cert-manager/clusterissuer-prod.yaml).

Fleet normalizes only the webhook CA and verified API defaults omitted by the
chart. Admission rules, operations, API groups, service names/paths and failure
policy remain checked; entire webhook resources are not excluded.

## Dashboard Access

Both the dashboard/API route and its slash-normalizing redirect require the
`traefik-dashboard-access` middleware. Allowed sources are:

- `10.0.10.0/24`: native management network.
- `10.0.20.10/32`: the reserved administration workstation Wi-Fi address.

The LoadBalancer uses `externalTrafficPolicy: Local` to preserve source IPs.
Keep the allowlist narrow; do not allow all private networks. Forwarded headers
alone must not grant access. This is a network restriction, not user login:
trusted hosts or NAT/proxy endpoints allowed by the policy are trusted sources.
Remote administration needs a separately reviewed path.

## Change And Verify

Custom Certificates, TLSStores, Middlewares and the redirect IngressRoute live
in `extraObjects` so the remote chart actually renders and owns them. Standalone
files beside a remote chart are not automatically part of its templates.
`helm.takeOwnership` permits adoption of the existing redirect objects.

After publishing, require matching desired/applied Fleet deployment IDs and
three Ready Traefik replicas:

```bash
kubectl -n fleet-local get bundle owl-red-gitops-traefik
kubectl -n traefik rollout status deployment/traefik
kubectl -n traefik get certificate management-ingress
```

Verify trusted HTTPS from the administration path, then require `403` on both
the API and redirect from an unauthorized source, including a forged forwarded
header. An in-cluster direct-pod test proves middleware behavior, not VLAN
firewall isolation. Verify Rancher, home, DNS and PDM remain reachable with
certificate verification enabled.

A healthy old release is insufficient while desired/applied IDs differ.
For `waitingForValues`, inspect the controller-owned options Secret before
changing workloads. Never delete a BundleDeployment as a generic repair:
its finalizer can uninstall the release.