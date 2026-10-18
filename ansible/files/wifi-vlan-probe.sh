#!/usr/bin/env bash
set -euo pipefail
trap 'printf "Wi-Fi VLAN probe failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
[[ $EUID -eq 0 && $(hostname -s) == cp1 ]] || exit 1
vlan=${1:-20}
case "$vlan" in 20|40|50) ;; *) exit 1 ;; esac
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
printf 'nameserver 10.0.%s.1\noptions timeout:2 attempts:1\n' "$vlan" > "$directory/resolv.conf"
ip netns exec "$namespace" sysctl -q -w net.ipv6.conf.all.disable_ipv6=1
ip link add link nic0 name "$device" type vlan id "$vlan"
ip link set dev "$device" address "02:76:79:$vlan:00:fe"
ip link set dev "$device" netns "$namespace"
ip netns exec "$namespace" ip link set lo up
ip netns exec "$namespace" ip address add "10.0.$vlan.254/24" dev "$device"
ip netns exec "$namespace" ip link set "$device" up
ip netns exec "$namespace" ip route add default via "10.0.$vlan.1"
ip netns exec "$namespace" ping -c 2 -W 2 "10.0.$vlan.1" >/dev/null
ip netns exec "$namespace" python3 - "$vlan" <<'PY'
import ipaddress,json,socket,subprocess,sys
vlan=int(sys.argv[1]);gateway=f'10.0.{vlan}.1'
neighbours=json.loads(subprocess.check_output(['ip','-j','neigh','show','dev',f'owl-wifi-{vlan}']))
assert next(item for item in neighbours if item['dst']==gateway)['lladdr']=='6c:fe:54:70:08:31'
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