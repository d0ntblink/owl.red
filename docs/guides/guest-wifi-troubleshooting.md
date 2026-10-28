# Guest Wi-Fi Troubleshooting

Guest Wi-Fi is intentionally disabled until WAP replacement. The retained
gateway and portal do not mean the guest SSID should be visible. Do not enable
it as a troubleshooting step; see the [AP qualification target](wifi-architecture.md#replacement-ap-target-not-yet-deployed).

Start with [Wi-Fi architecture](wifi-architecture.md) for the accepted topology
and [gateway operations](../../terraform/proxmox/guest-portal/README.md) for
enforcement ownership. Use the supported Node 24 controller environment and
existing private credentials from [controller setup](controller-setup.md).

## Identify The Failing Boundary

| Symptom | First check | Do not assume |
|---------|-------------|---------------|
| SSID missing | Independent over-air scan; compare the intended Grandstream bands and guest pause | A configured profile proves beacon visibility |
| SSID visible, association fails | Selected SSID and current Bitwarden key; client radio support | A portal failure explains WPA authentication |
| Associated, no lease | Guest VLAN 30 bridge path and Technitium scope/service | The AP or VyOS should start a replacement DHCP server |
| Lease, no internet before consent | Check portal reachability and client captive detection | Pre-auth internet denial is a fault |
| Consent fails | HTTPS origin, signed offer/cookie and native Authmon readiness | Disabling Origin validation is a fix |
| Internet fails after consent | Native openNDS session, fresh lease facts, transit and upstream policy | A successful page render proves enforcement authorization |
| Private/admin destination blocked | Compare the documented isolation policy | Broad inter-VLAN access should be opened for troubleshooting |
| AP SSH fails but HTTPS works | Existing management jump and trusted host identity | The AP needs a reboot or firewall exception |

Guests use `silence of the lans`, a `10.0.30.0/24` lease, gateway `10.0.30.1`
and VLAN-local Technitium DNS `10.0.30.30`. Consent is at
`https://guest.owl.red`. The AP does not route, NAT, serve DHCP or enforce sessions.
Do not use the retired `captive.owl.red` address or expect DHCP option 114.

## Read-Only Controller Checks

Use the Grandstream's native SSH `1` / Status menu through the documented
[bootstrap access](wifi-architecture.md#bootstrap-discovery-and-access).
Preserve strict host-key checking. No general shell or repeatable AP inspection
runner is qualified yet. Share only sanitized status, never credentials.

Verify each configured SSID's VLAN mapping and an independent over-air scan;
then test association and the intended VLAN's lease. Management reachability
does not prove tagged transport. Do not change workstation routes, DNS or SSID
association merely to manufacture a passing result.

## Bounded End-To-End Acceptance

The existing fixture creates a temporary production guest namespace, requests a
real lease, exercises HTTPS consent/native Authmon, tests established-connection
revocation and private/admin/IPv6 denial, then releases the lease and removes its
namespace. It is not read-only: use it only with approval for that bounded test.

```bash
ANSIBLE_CONFIG=ansible/ansible.cfg .venv/bin/ansible-playbook \
  -i ansible/inventory/hosts.yml ansible/playbooks/guest-portal-acceptance.yml \
  -e portal_acceptance_allowed=true
```

Expected result: `PRODUCTION_GUEST_DHCP_HTTPS_CONSENT_REVOKE_PRIVATE_IPV6_PASS`.
This checks the wired guest enforcement path, not handset compatibility or RF
coverage. A real browser login was owner-confirmed; coverage and broader handset
testing remain [roadmap work](../../ROADMAP.md#network-follow-ups).

## Stop And Escalate

Do not replay gateway stage/preparation, transit handoff, firmware apply or AP
reboot as a health check. Do not flush security rules, bypass lease freshness,
disable IPv6 isolation or weaken the FAS Origin/cookie/signature checks. The
intentional failure mode is denial rather than unauthenticated forwarding.

Capture the failing boundary, sanitized error, time and affected client/VLAN.
If a live apply timed out, inspect actual state before retrying: the outcome may
be unknown. Firmware reset/recovery requires a new approved outage and qualified
local recovery access. A VyOS VM lifecycle apply is not AP recovery; the provider previously
restarted the router despite `reboot=false`.