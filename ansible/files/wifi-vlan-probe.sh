#!/usr/bin/env bash
set -euo pipefail
trap 'printf "Wi-Fi VLAN probe failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
[[ $EUID -eq 0 && $(hostname -s) == cp1 ]] || exit 1
vlan=${1:-20}
case "$vlan" in 20|40|50) ;; *) exit 1 ;; esac
mode=${2:-connectivity}
case "$mode" in connectivity|services|technitium) ;; *) exit 1 ;; esac
[[ "$mode" != services || "$vlan" == 20 ]] || exit 1
namespace="owl-wifi-$vlan"
device="owl-wifi-$vlan"
directory="/etc/netns/$namespace"
[[ ! -e "$directory" && ! -e "/run/netns/$namespace" && ! -e "/sys/class/net/$device" ]] || exit 1
ip -j -4 address show dev vmbr0 | python3 -c 'import json,sys; assert any(item["local"]=="10.0.10.11" and item["prefixlen"]==24 for item in json.load(sys.stdin)[0]["addr_info"])'
created=false
cleanup() {
    if "$created"; then ip netns delete "$namespace" 2>/dev/null || true; fi
    if [[ -e "/sys/class/net/$device" ]]; then ip link delete "$device" 2>/dev/null || true; fi
    rm -f -- "$directory/resolv.conf"
    rmdir -- "$directory" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
ip netns add "$namespace"
created=true
install -d -m 0700 -- "$directory"
dns="10.0.$vlan.1"
if [[ "$mode" == technitium ]]; then dns="10.0.$vlan.30"; fi
printf 'nameserver %s\noptions timeout:2 attempts:1\n' "$dns" > "$directory/resolv.conf"
ip netns exec "$namespace" sysctl -q -w net.ipv6.conf.all.disable_ipv6=1
ip link add link nic0 name "$device" type vlan id "$vlan"
ip link set dev "$device" address "02:76:79:$vlan:00:fe"
ip link set dev "$device" netns "$namespace"
ip netns exec "$namespace" ip link set lo up
ip netns exec "$namespace" ip address add "10.0.$vlan.254/24" dev "$device"
ip netns exec "$namespace" ip link set "$device" up
ip netns exec "$namespace" ip route add default via "10.0.$vlan.1"
ip netns exec "$namespace" ping -c 2 -W 2 "10.0.$vlan.1" >/dev/null
ip netns exec "$namespace" python3 - "$vlan" "$mode" <<'PY'
import ipaddress,json,socket,subprocess,sys
vlan=int(sys.argv[1]);mode=sys.argv[2];gateway=f'10.0.{vlan}.1'
neighbours=json.loads(subprocess.check_output(['ip','-j','neigh','show','dev',f'owl-wifi-{vlan}']))
assert next(item for item in neighbours if item['dst']==gateway)['lladdr']=='6c:fe:54:70:08:31'
if mode=='technitium':
 assert socket.gethostbyname('rancher.owl.red')=='10.0.10.201'
 assert socket.gethostbyname('ap.owl.red')=='10.0.10.40'
 assert ipaddress.ip_address(socket.gethostbyname('example.com')).is_global
 dns=f'10.0.{vlan}.30'
 connection=socket.create_connection((dns,53),timeout=3);connection.close()
 for port in [22,5380]:
  try:connection=socket.create_connection((dns,port),timeout=2)
  except TimeoutError:continue
  else:
   connection.close();raise AssertionError('Technitium management exposed on client VLAN')
 print(json.dumps({'success':True,'vlan':vlan,'DNS':dns,'UDP53Resolved':True,'TCP53Reachable':True,'SSHAndAdminBlocked':True,'DHCPAuthorityChanged':False,'IPv6Tested':False}))
 raise SystemExit(0)
if mode=='services':
 assert socket.gethostbyname('dns.owl.red')=='10.0.10.201'
 status=subprocess.check_output(['curl','-4','--fail','--silent','--show-error','--connect-timeout','4','--max-time','15','--resolve','dns.owl.red:443:10.0.10.201','--output','/dev/null','--write-out','%{http_code}','https://dns.owl.red/'],text=True)
 assert status in ['200','301','302','303','307','308']
 for address,port in [('10.0.10.40',443),('10.0.10.3',8006),('10.0.10.5',443)]:
  try:connection=socket.create_connection((address,port),timeout=2)
  except TimeoutError:continue
  else:
   connection.close();raise AssertionError('Direct appliance/hypervisor administration became reachable')
 print(json.dumps({'success':True,'vlan':20,'ingressHTTPS':True,'TLSVerified':True,'directAPProxmoxNASAdminBlocked':True,'DHCPChanged':False,'IPv6Tested':False}))
 raise SystemExit(0)
assert socket.gethostbyname('nas.owl.red')=='10.0.10.5'
public=socket.gethostbyname('example.com');assert ipaddress.ip_address(public).is_global
for address,port in [('10.0.10.5',443),(gateway,22)]+([(public,443)] if vlan==40 else []):
 try:connection=socket.create_connection((address,port),timeout=3)
 except TimeoutError:continue
 else:
  connection.close();raise AssertionError('Forbidden private/management/internet connection succeeded')
if vlan!=40:
 status=subprocess.check_output(['curl','-4','--fail','--silent','--show-error','--connect-timeout','4','--max-time','15','--output','/dev/null','--write-out','%{http_code}','https://example.com'],text=True)
 assert status=='200'
print(json.dumps({'success':True,'vlan':vlan,'gateway':gateway,'DNS':True,'gatewayMAC':True,'privateAndManagementBlocked':True,'internetAllowed':vlan!=40,'internetPolicyVerified':True,'IPv6Tested':False}))
PY