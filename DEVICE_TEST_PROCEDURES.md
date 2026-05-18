# Device Test Procedures

Operational validation steps for `owl.red`. This file is intentionally service-by-service and shorter than the root README.

## Validation Order

| Order | Area | Why first |
|------|------|-----------|
| 1 | OPNsense | Gateways, DHCP, and policy drive everything else |
| 2 | Technitium | DNS and VLAN 10 DHCP reservations are core control-plane services |
| 3 | Switch + AP | Trunks and SSID/VLAN mapping must match the L3 design |
| 4 | Kubernetes + storage | Platform services depend on the network being correct |
| 5 | End-to-end flows | Confirms the design works from the client perspective |
| 6 | Power recovery | Last, because it is highest-risk and slowest to test |

## OPNsense Firewall (`edge.owl.red`, `10.0.10.1`)

| Check | How | Pass criteria |
|------|-----|---------------|
| VLAN gateways | Review interface assignments and addresses | VLANs 10/20/30/40/50 use `10.0.x.1` |
| DHCP scopes | Review DHCPv4 for VLANs 20/30/40/50 | Correct ranges enabled on OPNsense |
| DNS advertisement | Renew client leases on VLANs 20/30/40/50 | Clients receive DNS `10.0.10.30` |
| Guest Option 114 | Inspect VLAN 30 DHCP options | `https://captive.owl.red:8000/api/captiveportal/access/api` present |
| Captive portal | Test from guest client or `curl` | Redirect works and portal loads via hostname and fallback IP |
| Inter-VLAN policy | Ping from VLAN 30 to VLANs 10/20/40/50 and internet | Internal VLANs blocked, internet allowed after portal acceptance |
| Multicast block | Test `224.0.0.251` from guest VLAN | Blocked |

Reference commands:

```bash
nslookup owl.red 10.0.10.30
curl -I http://www.example.com
ping 10.0.10.1
```

## Technitium DNS + VLAN 10 DHCP (`dns.owl.red`, `10.0.10.30`)

| Check | How | Pass criteria |
|------|-----|---------------|
| VLAN 10 scope | Web UI or API | Scope `vlan10-network-devices` exists with `10.0.10.100-199` |
| Reservations | Compare against `gitops/technitium/dhcp-reservations.json` | Reservation set matches source of truth |
| DHCP options | Inspect scope settings | Router `10.0.10.1`, DNS `10.0.10.30` |
| Reserved lease test | Place a reserved client on VLAN 10 and renew | Reserved IP is issued |
| Unknown lease test | Place an unreserved client on VLAN 10 and renew | Lease lands in `10.0.10.100-199` |
| Internal DNS | Query `owl.red`, `rancher.owl.red` | Internal names resolve correctly |
| External recursion | Query `google.com` against `10.0.10.30` | Recursive query succeeds |
| Pod health | `kubectl get pod,pvc -n technitium-namespace` | Pod Running, PVC bound |
| Persistence | Restart `technitium-0` | Zone data and VLAN 10 reservations survive restart |

Storage note: current Technitium data uses node-local `hostPath`, not shared Unraid NFS. Restart validation is required; true failover remains limited.

Reference commands:

```bash
kubectl get pod,pvc -n technitium-namespace
kubectl delete pod -n technitium-namespace technitium-0
nslookup rancher.owl.red 10.0.10.30
```

## MikroTik CSS326 (`switch.owl.red`, `10.0.10.2`)

| Check | How | Pass criteria |
|------|-----|---------------|
| Management access | Open SwOS web UI | Switch reachable at `10.0.10.2` |
| Port names | Compare UI or gathered facts against IaC | Matches `ansible/switch_configs/css326.yml` |
| AP trunk | Check `SW21` link and VLAN behavior | Up at 1G, trunk for VLANs `10/20/30/40/50` |
| Router trunk | Check `SW23` | Up at 1G, primary LAN trunk |
| Fallback trunk | Check `SW24` | Present and intentionally disabled or idle |
| Access ports | Spot-check active drops | Ports match intended VLAN role and patch target |
| Future 10G ports | Check `SFP+1` and `SFP+2` | Present, no hardware faults |

## Wireless Access Point (`ap.owl.red`, current management `10.0.10.40`)

| Check | How | Pass criteria |
|------|-----|---------------|
| Management reachability | Open OpenWrt UI or ping `10.0.10.40` | Reachable on VLAN 10 |
| SSID mapping | Review wireless config | `owl.red` -> VLAN 20, `silence of the lans` -> VLAN 30, `owl.red-iot` -> VLAN 40 or 50 |
| Security profile | Review SSID auth settings | Trusted and IoT SSIDs use WPA2/WPA3 as intended |
| Trunk uplink | Review switch + AP uplink config | Tagged VLANs `10/20/30/40/50` on `SW21` |
| Client behavior | Join each SSID | Client lands in correct VLAN and policy domain |

## Kubernetes Platform

| Check | How | Pass criteria |
|------|-----|---------------|
| Node readiness | `kubectl get nodes -o wide` | All nodes `Ready` |
| Control-plane health | Inspect apiserver / etcd state | Three control-plane instances healthy |
| Technitium placement | `kubectl get pod -n technitium-namespace -o wide` | Pod Running with data volume attached |
| Pod rescheduling | Drain one control-plane node in maintenance window | Critical services recover acceptably |
| Pod networking | Launch two test pods on different nodes and ping | Pod-to-pod networking works |
| Ingress | Resolve and reach services via Traefik VIP | Expected VIP and ingress routing work |

Reference commands:

```bash
kubectl get nodes -o wide
kubectl get pod -n technitium-namespace -o wide
kubectl drain <cp-node-name> --ignore-daemonsets --delete-emptydir-data
kubectl uncordon <cp-node-name>
```

## Unraid and Shared Storage (`nas.owl.red`, `10.0.10.5`)

| Check | How | Pass criteria |
|------|-----|---------------|
| NFS exports | Review Unraid export configuration | Expected exports available to cluster clients |
| Mount test | Mount export from a client or node | Mount succeeds without timeout |
| Write test | Copy or write a test file | Throughput is acceptable for intended workloads |
| Plex | Query local Plex identity if in service | Plex responds on expected endpoint |

This is still worth validating because other platform services depend on Unraid, even though Technitium no longer uses Unraid-backed storage in the active deployment.

## End-to-End Validation

### Guest Client Path

| Step | Expected result |
|------|-----------------|
| Join `silence of the lans` | Client gets VLAN 30 lease from OPNsense |
| Inspect lease | DNS is `10.0.10.30`, Option 114 present |
| Open any HTTP/HTTPS site | Client is redirected to captive portal |
| Accept portal | Internet access works |
| Check logs | OPNsense DHCP/firewall and Technitium DNS logs show the transaction |

### VLAN 10 Management Client Path

| Step | Expected result |
|------|-----------------|
| Place client on VLAN 10 | Lease comes from Technitium |
| If reserved | Reserved IP issued |
| If unknown | IP lands in `10.0.10.100-199` |
| Resolve internal names | `owl.red` and `rancher.owl.red` resolve via Technitium |

### Break-Glass Access Path

| Check | Expected result |
|------|-----------------|
| Plug recovery laptop into `SW10` | Local management path remains available |
| Reach switch / OPNsense / PVE | Critical management endpoints still reachable |

## UPS, NUT, and Recovery

| Check | How | Pass criteria |
|------|-----|---------------|
| NUT status | `upsc <ups-name>@localhost ups.status` | UPS responds |
| Notify script | Review notify / WoL script | Correct target MACs present |
| WoL dry run | Send `etherwake` to a target host | Target host powers on |
| Recovery rehearsal | Maintenance-window recovery test | Cluster, DNS, DHCP, and guest portal recover in expected order |

## Production Checklist

- [ ] OPNsense DHCP scopes for VLANs 20/30/40/50 are correct
- [ ] VLAN 30 captive portal and Option 114 are correct
- [ ] Technitium VLAN 10 scope and reservations match Git
- [ ] Technitium pod and PVC are healthy
- [ ] Switch trunks and named ports match IaC
- [ ] AP SSIDs map to the correct VLANs
- [ ] Kubernetes nodes are Ready
- [ ] Guest flow works end to end
- [ ] VLAN 10 management lease path works end to end
- [ ] Recovery laptop path on `SW10` is usable
- [ ] UPS / WoL / recovery flow has been tested at an acceptable level

## Suggested Cadence

- Weekly: DHCP/DNS checks, guest portal check, core service name resolution
- Monthly: switch / AP / inter-VLAN policy validation, Kubernetes reschedule test
- Quarterly: storage and recovery-path validation
- Annually: full power-event rehearsal during maintenance window
