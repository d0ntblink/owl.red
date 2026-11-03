# Cloudflare DDNS

Fleet-owned, stateless Favonia Cloudflare DDNS 1.18.0, pinned by digest. It replaces
the NAS `cloudflareddns` container and manages only the `dash.d0ntb.link` A record.
It does not manage `*.owl.red`, IPv6, tunnels, WAF lists, or any other DNS name.

## Runtime

- One replica with `Recreate`; no NAS dependency, PVC, host network, inbound
  Service, or WebUI.
- Public IPv4 detection uses Cloudflare HTTPS trace through normal cluster
  egress, not the downloader VPN. The native updater checks every five minutes.
- Existing proxy status and TTL are preserved. Their fallback values are proxied
  and Automatic TTL. `DELETE_ON_STOP=false` preserves DNS when the pod stops.
- The approved existing `cloudflare-iac-api-token` is delivered by Bitwarden as a
  read-only file. Its permission scope is broader than this single-record
  workload; replace its mapping with a dedicated zone-scoped token when available.
- The process runs non-root with dropped capabilities, no service-account token,
  a read-only filesystem, and bounded CPU/memory.

Terraform in `cloudflare-iac/zones/d0ntb.link` owns the record's existence and
static attributes. Its protected `ddns_dash` resource ignores only `content`,
so it cannot overwrite DDNS's live IP with a stale snapshot. CNAMEs pointing to
`dash.d0ntb.link` continue following it without changing their definitions.

## Activation And Acceptance

Stage at zero replicas. Bootstrap `bw-auth-token` privately in the new namespace
and let the existing operator deliver `cloudflare-ddns-credentials`. Register
only this new Fleet path, preserving all other live paths.

Before enabling one replica, capture the DNS record and zone preimage, verify
the NAS and cluster detect the same public IPv4, and stop the exact old NAS
container. Publish the replica change through Fleet. Do not start two updaters.

Pod readiness only proves the process started. Acceptance additionally requires
a successful native update/check log and Cloudflare API readback: one A record,
the verified WAN IP, unchanged record ID/proxy/TTL, no AAAA change, and no other
zone-record changes. No deliberate fake-IP DNS test is needed.

After acceptance, archive and remove only the old container, matching Unraid
template, and its boot-autostart entry. Retain its appdata/logs and private
definition preimage. Never run Docker prune or delete DNS records as retirement.

## Recovery

Keep NAS SSH and the controller's existing Cloudflare credential available.
If the new updater fails, publish zero replicas and wait until no updater pod
remains. DNS is preserved on shutdown; leave the last verified correct WAN IP
in place while investigating. Reverting a record uses only the captured exact A
record and requires reviewing whether the old address is still appropriate.

The legacy token returned HTTP 401 during migration verification, so restarting
the old container unchanged is not a functional fallback. Its retained definition
is reconstruction evidence, not proof of working DNS updates. Do not restore an
entire zone or stale Terraform state to recover one record.

Inspect the native operational view with:

```bash
kubectl -n cloudflare-ddns get deployment,pods
kubectl -n cloudflare-ddns logs deployment/cloudflare-ddns --timestamps --tail=40
```

There is deliberately no headless-service WebUI link or fake health endpoint.