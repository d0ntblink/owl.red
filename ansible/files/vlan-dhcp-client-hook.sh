#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 && $(hostname -s) == cp1 ]] || exit 1
[[ $(readlink /proc/self/ns/net) != "$(readlink /proc/1/ns/net)" ]] || exit 1
case "${interface:-}" in owl-wifi-10|owl-wifi-20|owl-wifi-40|owl-wifi-50) ;; *) exit 1 ;; esac
reason=${reason:-${1:-}}
case "$reason" in bound) reason=BOUND ;; renew) reason=RENEW ;; esac
export reason
export new_ip_address=${new_ip_address:-${ip:-}}
export new_routers=${new_routers:-${router:-}}
export new_subnet_mask=${new_subnet_mask:-${subnet:-}}
export new_domain_name_servers=${new_domain_name_servers:-${dns:-}}
case "${reason:-}" in
    BOUND|RENEW|REBIND|REBOOT)
        python3 - <<'PY'
import ipaddress,json,os,subprocess
interface=os.environ['interface'];vlan=int(interface.rsplit('-',1)[1])
address=os.environ['new_ip_address'];gateway=os.environ['new_routers'];dns=os.environ['new_domain_name_servers']
assert ipaddress.IPv4Address(address) in ipaddress.IPv4Network(f'10.0.{vlan}.0/24')
assert os.environ['new_subnet_mask']=='255.255.255.0'
assert gateway==f'10.0.{vlan}.1' and dns==f'10.0.{vlan}.30'
subprocess.run(['ip','-4','address','flush','dev',interface,'scope','global'],check=True)
subprocess.run(['ip','address','add',address+'/24','dev',interface],check=True)
subprocess.run(['ip','route','replace','default','via',gateway,'dev',interface],check=True)
print(json.dumps({'event':os.environ['reason'],'address':address,'gateway':gateway,'DNS':dns,'server':os.environ.get('new_dhcp_server_identifier') or os.environ.get('serverid')}),flush=True)
PY
        ;;
esac