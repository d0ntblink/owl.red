# Decision 012: Cloudflare Tunnel for External Access (No Inbound Port Forwarding)

## Status

Accepted

## Context

The current platform already depends on Cloudflare for public DNS hosting and cert-manager DNS-01 challenges. Internally, Traefik and MetalLB provide LAN service exposure on VLAN 10, and Technitium remains authoritative for LAN clients.

The new requirement is stricter:

- no inbound router port forwards for application access
- no public A or AAAA records pointing to the home WAN IP or LAN VIPs
- keep external access available for selected web applications

Important constraint: Cloudflare Tunnel removes inbound NAT and hides the origin IP, but it does not eliminate public DNS if browser-accessible hostnames are still required. Public hostnames exposed through the tunnel will remain publicly resolvable at Cloudflare, but they must terminate at the Cloudflare edge instead of pointing at the homelab origin.

This decision applies to external web access only. It does not replace LAN-only services such as DNS on port 53, DHCP, or the OPNsense captive portal path.

## Options Compared

| Option | Pros | Cons | Risks / failure modes | Hidden complexity |
|---|---|---|---|---|
| Public A or AAAA records plus router port forwards | Simple mental model. Works with standard DNS and direct client access. | Exposes the homelab WAN edge directly. Requires inbound firewall policy and origin hardening. | Misconfigured NAT or reverse proxy can expose admin apps directly to the internet. Origin IP becomes public and easier to target. | Requires careful edge hardening, patching discipline, rate limiting, and WAN monitoring. |
| Cloudflare Tunnel plus Cloudflare Access for externally reachable web apps | No inbound HTTP or HTTPS port forwards. Origin IP stays off public DNS. Access policy can gate admin apps before traffic reaches the homelab. Aligns with the existing Cloudflare dependency already used for DNS-01. | Cloudflare becomes part of the runtime path. Public hostnames still exist for externally reachable apps. Not suitable for every protocol. | Cloudflare outage or tunnel failure removes remote access even when the LAN is healthy. Split-horizon mistakes can send LAN clients to the Cloudflare edge instead of the local VIP. | Requires tunnel lifecycle management, Access policy design, and deliberate separation of internal-only vs externally reachable hostnames. |
| Private-only remote access with VPN or WARP and no public app hostnames | No public app records required. Strongest reduction in public discoverability. Clean fit for admin-only services. | Less convenient for browser access from unmanaged devices. Adds client enrollment and identity distribution overhead. | Operator lockout if VPN, WARP, or identity provider breaks during an incident. | Requires separate remote-access client management and onboarding. |

## Decision

Use Cloudflare Tunnel as the default and only supported external ingress path for homelab web applications.

- Do not configure inbound OPNsense port forwards for HTTP or HTTPS.
- Do not publish public A or AAAA records that point to the home WAN IP, Traefik VIP, or any RFC1918 address.
- Publish only Cloudflare-managed proxied hostnames for services that are intentionally reachable from outside the LAN.
- Require explicit Cloudflare Access policy for administrative services unless a service is deliberately meant to be anonymous.
- Keep Traefik as the internal ingress layer behind the tunnel.
- Keep MetalLB for LAN-only VIP ownership and internal service routing.
- Keep Technitium authoritative for the internal `owl.red` zone seen by LAN clients.

## Scope Boundaries

In scope:

- HTTP and HTTPS application access from outside the LAN
- external publication of selected app hostnames such as Rancher, Homepage, or other web UIs
- Cloudflare edge authentication and policy enforcement

Out of scope:

- internal DNS on `10.0.10.30`
- DHCP for any VLAN
- guest captive portal flows on OPNsense
- non-HTTP protocols that Cloudflare Tunnel does not handle cleanly in this environment
- any requirement for literally zero public DNS data while also keeping browser-based remote access

## Why This Option

- It removes the highest-risk exposure pattern in this homelab: inbound WAN reachability to self-hosted services.
- It preserves the existing internal architecture. Traefik and MetalLB can stay useful for LAN routing even after WAN exposure is removed.
- It fits the current provider choice. Cloudflare is already in the trust path for public DNS and certificate issuance.
- It gives a clean policy boundary. External access becomes an explicit per-app publication decision instead of an accidental consequence of DNS and port-forward state.

## Consequences

- Public records may still exist for externally reachable applications, but they must be Cloudflare-proxied tunnel hostnames rather than origin A or AAAA records.
- Internal and external answers for the same hostname may intentionally differ. Internal resolution should continue to prefer Technitium answers for LAN clients.
- ADR 004 and ADR 009 remain valid for LAN ingress behavior, but they no longer imply that Traefik or MetalLB services are reachable from the WAN.
- Sensitive services that do not need external access should not receive public tunnel hostnames at all.

## Risks And Mitigations

- Risk: a public wildcard record can accidentally publish internal-only names.
  Mitigation: remove the wildcard from the Cloudflare public zone and publish only explicit hostnames that are intentionally exposed.
- Risk: Technitium failure causes clients to fall back to public DNS and resolve internal names incorrectly.
  Mitigation: keep Technitium zone sync healthy, validate split-horizon behavior regularly, and avoid publishing unnecessary overlapping public names.
- Risk: Cloudflare Access policy drift exposes admin apps too broadly.
  Mitigation: default to deny, require identity-based policy per app, and review published hostnames as part of change control.
- Risk: tunnel outage breaks remote operations during an incident.
  Mitigation: preserve LAN break-glass access and keep at least one local management path independent of Cloudflare.

## Implementation Rules

1. Remove any public wildcard DNS record for `*.owl.red`.
2. Publish explicit public hostnames only for services that truly need remote access.
3. Point those public hostnames at Cloudflare Tunnel, not at the home WAN IP and not at `10.0.10.201`.
4. Keep internal Technitium records authoritative for LAN clients and VLAN-local workflows.
5. Keep OPNsense free of inbound application port forwards.
6. Treat new external publication as a security decision requiring explicit review.

## Validation Gates

- `dig +short random-check.owl.red @1.1.1.1` returns no answer once the public wildcard is removed.
- `dig +short <external-app>.owl.red @1.1.1.1` resolves to a Cloudflare-managed proxied record, never to the home WAN IP.
- `dig +short <internal-app>.owl.red @1.1.1.1` returns no public answer if the app is LAN-only.
- `dig +short <internal-app>.owl.red @10.0.10.30` returns the intended internal VIP or service IP.
- OPNsense has no inbound NAT or port-forward rules for application traffic.
- Remote access works through Cloudflare Tunnel and Access, while LAN access still works when the tunnel is unavailable.