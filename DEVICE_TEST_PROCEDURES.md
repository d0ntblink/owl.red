# Device Test Procedures

Test procedures for owl.red infrastructure. These are operational validation steps, not in README to keep docs uncluttered.

## OPNsense Firewall (`edge.owl.red`, 10.0.10.1)

### DHCP & DNS Verification

**Objective:** Confirm OPNsense serves DHCP for VLANs 20/30/40/50 and advertises Technitium as client DNS.

**Procedure:**
1. SSH to OPNsense or access web console.
2. Check DHCPv4 configuration for VLANs 20/30/40/50 and verify the expected ranges are enabled.
3. Verify each DHCP-enabled scope advertises `10.0.10.30` as DNS.
4. Verify the VLAN 30 scope includes Option 114 set to `https://captive.owl.red:8000/api/captiveportal/access/api`.
5. From a client on each DHCP-enabled VLAN, renew the lease and confirm the gateway and DNS values are correct.
6. From each VLAN, test DNS: `nslookup owl.red 10.0.10.30`

**Success Criteria:**
- OPNsense hands out leases on VLANs 20/30/40/50
- Option 3 gateways match the interface-local VLAN gateway
- Option 6 points clients to `10.0.10.30`
- VLAN 30 delivers Option 114
- DNS resolves `owl.red` correctly

### Captive Portal Configuration

**Objective:** Verify captive portal zone, port redirects, and option 114.

**Procedure:**
1. Web console → Services → Captive Portal → Zones
2. Verify zone 0 exists with VLAN 30 interface
3. Check SSL certificate is valid (not self-signed)
4. Verify hostname: `captive.owl.red` resolves to OPNsense IP
5. Test redirect: From guest VLAN, try `curl http://www.example.com` → should redirect to portal
6. Verify portal is accessible at both:
   - `https://captive.owl.red:8000/` (hostname-based)
   - `https://10.0.10.1:8000/` (IP-based fallback)

**Success Criteria:**
- Zone configured and enabled
- SSL cert is valid and public
- Both hostname and IP-based access work
- Redirect from unauth guests functions

### Firewall Rules Validation

**Objective:** Confirm inter-VLAN blocking and guest isolation.

**Procedure:**
1. From guest VLAN (VLAN 30) client, attempt ping to:
   - `10.0.10.11` (network-devices VLAN) → should be BLOCKED
   - `10.0.20.100` (private VLAN) → should be BLOCKED
   - `10.0.40.100` (IoT no-internet) → should be BLOCKED
   - `10.0.50.100` (IoT with-internet) → should be BLOCKED
   - `8.8.8.8` (internet) → should PASS (if authenticated in portal)
2. Verify multicast block: `ping 224.0.0.251` from guest VLAN → should be BLOCKED

**Success Criteria:**
- All inter-VLAN pings blocked
- Multicast blocked
- Internet access allowed for authenticated guests

---

## Technitium DNS + VLAN 10 DHCP (`dns.owl.red`, 10.0.10.30, on Kubernetes)

### DHCP Scope Verification

**Objective:** Confirm the Technitium VLAN 10 scope and reservations are configured correctly.

**Procedure:**
1. Access Technitium web console (URL depends on Kubernetes ingress setup)
2. Navigate to DHCP → Scopes.
3. Verify scope `vlan10-network-devices` exists with range `10.0.10.100–199`.
4. Verify scope options include router `10.0.10.1` and DNS `10.0.10.30`.
5. Verify reservations match `gitops/technitium/dhcp-reservations.json` for current known infrastructure devices.
6. Confirm VLANs 20/30/40/50 remain served by OPNsense rather than Technitium.

**Success Criteria:**
- VLAN 10 scope is present
- Reservation set matches source of truth
- Router and DNS options are correct
- No unexpected DHCP scope drift exists

### DHCP Lease Acquisition

**Objective:** Test actual VLAN 10 lease issuance from Technitium.

**Procedure:**
1. Connect a test client to a VLAN 10 port or otherwise place a client on VLAN 10.
2. Request DHCP lease: `dhclient` (Linux) or `ipconfig /renew` (Windows).
3. If the client MAC has a reservation, verify the reserved IP is issued. If the client is unknown, verify the lease lands in `10.0.10.100–199`.
4. Verify DHCP options:
   - Option 3 (gateway) = `10.0.10.1`
   - Option 6 (DNS) = `10.0.10.30`
5. Check Technitium logs for DHCP requests/offers

**Success Criteria:**
- VLAN 10 lease is issued from the correct scope
- Reserved clients receive the expected IP
- Gateway and DNS options are correct
- No DHCP errors in logs

### DNS Resolution

**Objective:** Verify DNS resolves internal and external domains.

**Procedure:**
1. From a client in each VLAN, resolve:
   - `nslookup owl.red 10.0.10.30` → should resolve to Technitium or external IP (depending on auth)
   - `nslookup rancher.owl.red 10.0.10.30` → should resolve to the Traefik MetalLB VIP (for example `10.0.10.201`)
   - `nslookup google.com 10.0.10.30` → should resolve to Google's IP (recursive query)
2. Check Technitium query logs for resolution patterns
3. Verify no unexpected NXDOMAIN (not found) for valid internal names

**Success Criteria:**
- Internal names resolve correctly
- External recursive queries work
- No resolution errors in logs

### Kubernetes StatefulSet Health

**Objective:** Confirm Technitium pod is running on Kubernetes and persistent storage is working.

**Procedure:**
1. Access Kubernetes cluster via `kubectl`
2. Check Technitium pod status:
   ```bash
   kubectl get pod -n technitium-namespace | grep technitium
   ```
   Should show pod in Running state.
3. Check persistent volume claim (PVC):
   ```bash
   kubectl get pvc -n technitium-namespace
   ```
   Should show a bound PVC for the active Technitium data volume. Current deployment uses node-local `hostPath` storage.
4. Restart Technitium pod and verify it reschedules:
   ```bash
   kubectl delete pod -n technitium-namespace technitium-0
   ```
   Pod should return to Running and reattach its data volume. Because storage is currently node-local `hostPath`, failover flexibility is limited.
5. Verify DNS data and VLAN 10 DHCP reservations survive pod restart.

**Success Criteria:**
- Pod runs in Running state
- PVC is bound to the active data volume
- Pod restarts without losing zone or VLAN 10 DHCP data
- Clients maintain connectivity during pod transition

---

## MikroTik CSS326-24G-2S+RM Switch (`switch.owl.red`, 10.0.10.2)

### VLAN Configuration

**Objective:** Verify VLAN tagging and trunk configuration on switch.

**Procedure:**
1. Access SwOS (web browser to 10.0.10.2)
2. Navigate to VLAN settings
3. Verify bridge groups configured for:
   - VLAN 10: untagged on management port, tagged on trunk ports
   - VLAN 20: tagged on all ports except management
   - VLAN 30: tagged on all ports except management
   - VLAN 40: tagged on all ports except management
   - VLAN 50: tagged on all ports except management
4. Check trunk ports (to OPNsense, WAP): should be tagged for all VLANs 10–50
5. Verify access ports (to devices): each should be access port for single VLAN

**Success Criteria:**
- All VLAN bridge groups present
- Trunk ports have correct tag set
- Access ports assigned to correct VLAN

### Port Forwarding & Spanning Tree

**Objective:** Confirm traffic flows and no loops exist.

**Procedure:**
1. From a device in VLAN 20, ping a device in VLAN 30 via gateway:
   - Should be blocked by OPNsense firewall rule (expected)
2. From VLAN 20, ping OPNsense gateway (10.0.10.1) and verify response time < 5ms
3. Check Spanning Tree (STP) status: should be enabled and running without errors
4. Verify no spanning tree loops: check switch logs for "Port forwarding" errors

**Success Criteria:**
- Ping latency to gateway < 5ms
- No spanning tree issues
- VLAN isolation works as designed

### Trunk Port Status (for 10G migration planning)

**Objective:** Verify SFP+ ports are available for future migration.

**Procedure:**
1. Access switch web console
2. Check SFP+ port status: should show "not connected" (no cables yet)
3. Verify ports support 10Gbps speed (specs should confirm)
4. When 10G upgrade is ready, plug in 10G optic and re-run this procedure

**Success Criteria:**
- SFP+ ports recognized and available
- No hardware errors reported
- Ports ready for 10G optics

---

## Wireless Access Point (`ap.owl.red`, 10.0.10.20, OpenWrt)

### SSID & VLAN Mapping

**Objective:** Verify SSIDs broadcast on correct VLANs.

**Procedure:**
1. Access OpenWrt web console (10.0.10.20)
2. Navigate to Network → Wireless
3. Verify SSID configuration:
   - `owl.red` on VLAN 20 (`private-net`)
   - `silence of the lans` on VLAN 30 (`guest-net`)
   - `owl.red-iot` on VLAN 40 or 50 (IoT networks)
4. Check security settings:
   - `owl.red`: WPA3/WPA2
   - `silence of the lans`: Open or simple PSK (for guest convenience)
   - `owl.red-iot`: WPA3/WPA2
5. Verify uplink to switch trunk is configured (VLAN 10, 20, 30, 40, 50 tagged)

**Success Criteria:**
- All SSIDs broadcast on correct VLANs
- Security settings appropriate for each SSID
- Uplink configured for VLAN tagging

### Client Association & DHCP

**Objective:** Verify clients can connect and receive DHCP leases.

**Procedure:**
1. Connect a device to each SSID:
   - `owl.red`: Should connect and receive IP in `10.0.20.x` range
   - `silence of the lans`: Should connect and see captive portal
   - `owl.red-iot`: Should connect and receive IP in `10.0.40.x` or `10.0.50.x` range
2. From each client, verify internet access or VLAN restrictions (expected for IoT VLANs)
3. Check DHCP lease time and renewal process (run `iwconfig` or WiFi settings)

**Success Criteria:**
- Clients associate with correct SSID
- DHCP leases issued from correct VLAN scope
- Internet access works as expected per VLAN policy

---

## Kubernetes Cluster (Control Plane Nodes: cp1-cp3, Worker: worker1)

### Cluster Health

**Objective:** Verify all nodes are ready and quorum is maintained.

**Procedure:**
1. Access Kubernetes cluster via `kubectl`
2. Capture canonical node names used by Kubernetes:
   ```bash
   kubectl get nodes -o wide
   ```
   Use names from this output in all drain/node-selector commands below.
3. Check node status:
   ```bash
   kubectl get nodes
   ```
   All 4 nodes should show "Ready" status.
4. Check kube-apiserver: should have 3 running instances (one per CP node)
   ```bash
   kubectl get pods -n kube-system | grep apiserver
   ```
5. Verify quorum:
   ```bash
   kubectl logs -n kube-system -l component=etcd | tail -20
   ```
   Should show "cluster is operational" or "healthy" messages.

**Success Criteria:**
- All 4 nodes Ready
- 3 kube-apiserver instances running
- etcd cluster healthy

### Pod Scheduling

**Objective:** Verify pods schedule evenly and critical services are not disrupted.

**Procedure:**
1. Check where Technitium pod is running:
   ```bash
   kubectl get pod -n technitium-namespace -o wide
   ```
   Should be on one of the 3 CP nodes.
2. Drain one CP node to test rescheduling (replace `<cp-node-name>` with actual node name from `kubectl get nodes`):
   ```bash
   kubectl drain <cp-node-name> --ignore-daemonsets --delete-emptydir-data
   ```
3. Verify Technitium pod moves to another CP node within 2 min
4. Re-add drained node to cluster:
   ```bash
   kubectl uncordon <cp-node-name>
   ```

**Success Criteria:**
- Technitium pod reschedules without service loss
- Clients maintain DHCP/DNS connectivity during transition (< 30 sec downtime)
- Node successfully rejoins cluster

### Network Connectivity

**Objective:** Verify Kubernetes networking (CNI) and inter-pod communication.

**Procedure:**
1. Deploy test pods on different nodes:
   ```bash
   kubectl run test-pod1 --image=busybox --restart=Never --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"<node-a>"}}}' -- sleep 3600
   kubectl run test-pod2 --image=busybox --restart=Never --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"<node-b>"}}}' -- sleep 3600
   kubectl wait --for=condition=Ready pod/test-pod1 pod/test-pod2 --timeout=120s
   ```
2. Ping between pods:
   ```bash
   kubectl exec test-pod1 -- ping -c 4 test-pod2
   ```
   Should respond with < 10ms latency.
3. Check Flannel VXLAN status:
   ```bash
   kubectl logs -n kube-system -l app=flannel
   ```
   Should show "Starting flannel" without errors.

**Success Criteria:**
- Pod-to-pod communication works
- Latency acceptable (< 10ms local)
- Flannel overlay stable

---

## Unraid NFS Storage (`nas.owl.red`, 10.0.10.5)

### NFS Export Availability

**Objective:** Verify NFS mount is exported and accessible.

**Procedure:**
1. SSH to Unraid or access web console
2. Check NFS exports:
   ```bash
   exportfs -a
   ```
   Should list `/mnt/user` exported to the Kubernetes node network
3. From a Kubernetes node, attempt NFS mount:
   ```bash
   mount -t nfs 10.0.10.5:/mnt/user /mnt/test
   ```
   Should succeed without timeout
4. Write test file to NFS:
   ```bash
   dd if=/dev/zero of=/mnt/test/test-file bs=1M count=100
   ```
   Should complete within expected time (< 5 sec for 100MB)
5. Verify Technitium PVC is mounted and has data:
   ```bash
   ls -la /mnt/user/k8s-pvcs/technitium-pvc/
   ```
   Should show DHCP/DNS config files

**Success Criteria:**
- NFS export accessible and mounted
- Write performance acceptable (> 20MB/s typical)
- Technitium PVC mounted and contains data

### Plex Media Server

**Objective:** Verify Plex service is running and accessible.

**Procedure:**
1. Verify Plex process running on Unraid
2. Test Plex HTTP access:
   ```bash
   curl http://10.0.10.5:32400/identity
   ```
   Should return Plex identity XML
3. Verify Plex port forwarding via Traefik (if configured):
   ```bash
   curl https://plex.owl.red/identity
   ```
   Should return same Plex identity through Traefik ingress

**Success Criteria:**
- Plex service running
- HTTP API responding
- Ingress routing works (if configured)

---

## OPNsense → Technitium → Kubernetes Dependency Chain

### End-to-End DHCP + DNS + Captive Portal Test

**Objective:** Verify complete flow from guest client to OPNsense DHCP, Technitium DNS, and captive portal.

**Procedure:**
1. Connect a test device to `silence of the lans` SSID (guest VLAN 30)
2. Device should automatically:
   - Get DHCP lease from OPNsense on the VLAN 30 scope
   - Receive DNS server `10.0.10.30`
   - Receive DHCP Option 114 with portal URL
   - Attempt to access any HTTP/HTTPS site
   - Be redirected to captive portal at `https://captive.owl.red:8000/`
3. Verify portal page loads (check certificate is valid)
4. After "accepting" portal (splash screen), try to access internet
5. Verify access works (ping 8.8.8.8 should succeed)
6. Check OPNsense DHCP logs for lease records
7. Check Technitium query logs for DNS lookups
8. Check OPNsense firewall logs for redirect and allow rules

**Success Criteria:**
- Device gets DHCP lease in `10.0.30.x` range from OPNsense
- DNS server assigned to the client is `10.0.10.30`
- Portal detected and opens automatically (or accessible via fallback IP)
- After authentication, internet access granted
- All components logged transaction flow

---

## UPS + WoL + NUT Recovery Procedure

### Manual Test (Non-Destructive)

**Objective:** Verify UPS notification and WoL trigger logic without full power loss.

**Procedure:**
1. Simulate low-battery notification via NUT:
   ```bash
   upsc <ups-name>@localhost ups.beeper.status
   ```
   Should show UPS status
2. Check NUT notify script is configured:
   ```bash
   cat /etc/nut/notify-wol.sh
   ```
   Should contain MAC addresses for PVE hosts
3. Test WoL manually from storage.pve:
   ```bash
   etherwake <mac-address-of-target-host>
   ```
   Target host should power on
4. Verify storage.pve wakes up other hosts in sequence:
   ```bash
   journalctl -u nut | tail -50
   ```
   Should show WoL triggers in log

**Success Criteria:**
- UPS communicates with NUT daemon
- NUT can trigger WoL commands
- Target hosts respond to WoL packets

### Post-Power-Event Recovery (After UPS Depletion)

**Objective:** Verify cluster and services come back online after power loss and restoration.

**Procedure (ONLY IF SAFE):**
1. Simulate UPS depletion: (DO NOT DO unless in maintenance window)
   - Option A: Kill power to UPS (not recommended for production)
   - Option B: Disable AC recovery on hosts first, then restore AC (safer)
2. Monitor recovery sequence:
   - All UPS-backed hosts shut down gracefully (check NUT timeout config)
   - After AC restored, NUT triggers WoL
   - Hosts boot up in sequence (verify BIOS AC recovery setting)
   - Kubernetes cluster re-establishes (monitor `kubectl get nodes`)
   - Technitium pod resumes on first available CP node
3. Verify DHCP/DNS work after recovery:
   - VLAN 10 client gets DHCP lease from Technitium
   - Guest client gets DHCP lease from OPNsense and receives Option 114
   - DNS resolves correctly
   - Captive portal accessible
4. Check for any stale sessions or pod failures:
   ```bash
   kubectl get events -n technitium-namespace
   ```
   Should show pod restarts but no errors

**Success Criteria:**
- All hosts recover gracefully
- Kubernetes cluster back to Ready state
- Technitium pod recovered with data intact
- Network services operational within 2–5 min

---

## Checklist Summary

Use this as a quick validation checklist before considering the network production-ready:

- [ ] OPNsense DHCP scopes, DNS advertisement, and firewall rules working
- [ ] OPNsense captive portal responsive on port 8000 (hostname + IP-based)
- [ ] Technitium VLAN 10 DHCP scope and reservations configured
- [ ] OPNsense Option 114 set for VLAN 30 (guest captive portal)
- [ ] Technitium running on Kubernetes with active persistent volume (current deployment: node-local `hostPath`)
- [ ] Kubernetes cluster has 3 CP nodes (quorum) and 1 worker node
- [ ] MikroTik switch VLAN trunking configured
- [ ] OpenWrt WAP SSIDs on correct VLANs with correct security
- [ ] Guest clients get DHCP from OPNsense, DNS from Technitium, portal redirect, and option 114 delivery
- [ ] Inter-VLAN blocking rules preventing lateral access
- [ ] Multicast blocked for guest VLAN (no mDNS enumeration)
- [ ] Unraid NFS accessible and fast (> 20MB/s write)
- [ ] UPS + NUT + WoL recovery procedure tested
- [ ] All nodes recover gracefully after simulated power loss (if safe to test)

---

## Test Frequency

Recommended test schedule:
- **Weekly:** DHCP lease acquisition, DNS resolution, captive portal access
- **Monthly:** Inter-VLAN isolation, firewall rule verification, pod rescheduling
- **Quarterly:** UPS battery runtime and WoL recovery (non-destructive if possible)
- **Annually:** Full power-loss simulation and recovery (during maintenance window only)

