#!/usr/bin/env bash
set -euo pipefail
trap 'printf "VLAN20 probe failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

[[ $EUID -eq 0 && $(hostname -s) == cp1 ]] || exit 1
namespace=owl-v20-pilot
device=owl-v20-probe
directory="/etc/netns/$namespace"
[[ ! -e "$directory" && ! -e "/sys/class/net/$device" ]] || exit 1
ip -j netns list | python3 -c 'import json,sys; value=sys.stdin.read(); assert not any(item["name"]=="owl-v20-pilot" for item in json.loads(value or "[]"))'
ip -j -4 address show dev vmbr0 | python3 -c 'import json,sys; assert any(item["local"]=="10.0.10.11" and item["prefixlen"]==24 for item in json.load(sys.stdin)[0]["addr_info"])'

namespace_created=false
device_created=false
directory_created=false
cleanup() {
    if "$namespace_created"; then ip netns delete "$namespace" 2>/dev/null || true; fi
    if "$device_created"; then ip link delete "$device" 2>/dev/null || true; fi
    if "$directory_created"; then
        rm -f -- "$directory/resolv.conf"
        rmdir -- "$directory" 2>/dev/null || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

ip netns add "$namespace"
namespace_created=true
install -d -m 0700 -- "$directory"
directory_created=true
printf 'nameserver 10.0.20.1\noptions timeout:2 attempts:1\n' > "$directory/resolv.conf"
chmod 0600 "$directory/resolv.conf"
ip netns exec "$namespace" sysctl -q -w net.ipv6.conf.all.disable_ipv6=1
ip link add link nic0 name "$device" type vlan id 20
device_created=true
ip link set dev "$device" address 02:76:79:20:00:fe
ip link set dev "$device" netns "$namespace"
ip netns exec "$namespace" ip link set lo up
ip netns exec "$namespace" ip address add 10.0.20.254/24 dev "$device"
ip netns exec "$namespace" ip link set "$device" up
ip netns exec "$namespace" ip route add default via 10.0.20.1
ip netns exec "$namespace" ping -c 2 -W 2 10.0.20.1 >/dev/null

ip netns exec "$namespace" python3 - <<'PY'
import ipaddress
import json
import socket
import subprocess

neighbours = json.loads(subprocess.check_output(['ip', '-j', 'neigh', 'show', 'dev', 'owl-v20-probe']))
gateway = next(item for item in neighbours if item['dst'] == '10.0.20.1')
assert gateway['lladdr'] == '6c:fe:54:70:08:31'
assert socket.gethostbyname('nas.owl.red') == '10.0.10.5'
assert ipaddress.ip_address(socket.gethostbyname('example.com')).is_global
for address, port in [('10.0.10.5', 443), ('10.0.20.1', 22)]:
    try:
        connection = socket.create_connection((address, port), timeout=2)
    except TimeoutError:
        continue
    else:
        connection.close()
        raise AssertionError('Forbidden management/private TCP connection succeeded')
PY

status=$(ip netns exec "$namespace" curl -4 --fail --silent --show-error --connect-timeout 4 --max-time 15 --output /dev/null --write-out '%{http_code}' https://example.com)
[[ "$status" == 200 ]] || exit 1
printf '{"success":true,"client":"10.0.20.254/24","gatewayMAC":"6c:fe:54:70:08:31","gatewayPing":true,"internalDNS":true,"publicDNS":true,"verifiedHTTPS":true,"privateNASBlocked":true,"routerSSHBlocked":true,"IPv6Tested":false}\n'