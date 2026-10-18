#!/usr/bin/env bash
set -euo pipefail
trap 'printf "Wi-Fi VLAN probe failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR
[[ $EUID -eq 0 && $(hostname -s) == cp1 ]] || exit 1
vlan=${1:-20}
case "$vlan" in 10|20|30|40|50) ;; *) exit 1 ;; esac
mode=${2:-connectivity}
case "$mode" in connectivity|services|technitium|capture|dualstack|dns-policy|dhcp) ;; *) exit 1 ;; esac
[[ "$mode" != services || "$vlan" == 20 ]] || exit 1
[[ "$vlan" != 30 || "$mode" == technitium || "$mode" == capture || "$mode" == dualstack ]] || exit 1
[[ "$vlan" != 10 || "$mode" == dhcp || "$mode" == capture ]] || exit 1
ipv6_dns=${3:-}
[[ "$mode" != dualstack && "$mode" != dns-policy || "$ipv6_dns" == fd*::* ]] || exit 1
namespace="owl-wifi-$vlan"
device="owl-wifi-$vlan"
directory="/etc/netns/$namespace"
[[ ! -e "$directory" && ! -e "/run/netns/$namespace" && ! -e "/sys/class/net/$device" ]] || exit 1
ip -j -4 address show dev vmbr0 | python3 -c 'import json,sys; assert any(item["local"]=="10.0.10.11" and item["prefixlen"]==24 for item in json.load(sys.stdin)[0]["addr_info"])'
created=false
cleanup() {
  if [[ -s "$directory/udhcpc.pid" ]]; then
    client_pid=$(< "$directory/udhcpc.pid")
    if [[ "$client_pid" =~ ^[0-9]+$ && -r "/proc/$client_pid/cmdline" ]]; then
      client_command=$(tr '\0' ' ' < "/proc/$client_pid/cmdline")
      if [[ "$client_command" == *"udhcpc"*"$device"* ]]; then
        kill -USR2 "$client_pid" 2>/dev/null || true
        kill -TERM "$client_pid" 2>/dev/null || true
      fi
    fi
  fi
    if "$created"; then ip netns delete "$namespace" 2>/dev/null || true; fi
    if [[ -e "/sys/class/net/$device" ]]; then ip link delete "$device" 2>/dev/null || true; fi
    rm -f -- "$directory/resolv.conf"
    rm -f -- "$directory/udhcpc.pid"
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
if [[ "$vlan" == 10 ]]; then
  ip link add link vmbr0 name "$device" type macvlan mode bridge
else
  ip link add link nic0 name "$device" type vlan id "$vlan"
fi
ip link set dev "$device" address "02:76:79:$vlan:00:fe"
ip link set dev "$device" netns "$namespace"
ip netns exec "$namespace" ip link set lo up
ip netns exec "$namespace" ip address add "10.0.$vlan.254/24" dev "$device"
ip netns exec "$namespace" ip link set "$device" up
ip netns exec "$namespace" ip route add default via "10.0.$vlan.1"
if [[ "$mode" == dualstack || "$mode" == dns-policy ]]; then
  ip netns exec "$namespace" sysctl -q -w net.ipv6.conf.all.forwarding=0
  ip netns exec "$namespace" sysctl -q -w net.ipv6.conf.all.disable_ipv6=0
  ip netns exec "$namespace" sysctl -q -w "net.ipv6.conf.$device.accept_ra=2"
fi
if [[ "$mode" == capture ]]; then
  printf 'OWL_VLAN_CAPTURE_READY\n'
  read -r -t 60 capture_completion
  [[ "$capture_completion" == complete ]]
  exit 0
fi
if [[ "$mode" == dhcp ]]; then
  hook=/tmp/owl-vlan-dhcp-client-hook.sh
  [[ -f "$hook" && $(stat -c %u "$hook") == 0 && $(stat -c %a "$hook") == 700 ]] || exit 1
  ip netns exec "$namespace" ip -4 address flush dev "$device" scope global
  ip netns exec "$namespace" python3 - "$vlan" "$device" "$hook" "$directory/udhcpc.pid" <<'DHCPCHECK'
import json,selectors,signal,subprocess,sys,time
vlan=int(sys.argv[1]);device,hook,pidfile=sys.argv[2:]
client=subprocess.Popen(['busybox','udhcpc','-f','-n','-R','-i',device,'-s',hook,'-p',pidfile,'-t','3','-T','3'],stdout=subprocess.PIPE,text=True)
selector=selectors.DefaultSelector();selector.register(client.stdout,selectors.EVENT_READ)
events=[];deadline=time.monotonic()+35
try:
 while len(events)<2:
  remaining=deadline-time.monotonic();assert remaining>0 and selector.select(remaining),'DHCP acquisition/renewal timed out'
  line=client.stdout.readline();assert line,'DHCP client exited before acceptance'
  if not line.startswith('{'):continue
  event=json.loads(line);assert event['event'] in ['BOUND','RENEW'];events.append(event);print(line,end='',flush=True)
  if len(events)==1:client.send_signal(signal.SIGUSR1)
 assert events[0]['event']=='BOUND' and events[1]['event']=='RENEW'
 assert events[0]['address']==events[1]['address']
 answer=subprocess.check_output(['dig','+short','+time=3','+tries=1',f'@10.0.{vlan}.30','rancher.owl.red','A'],text=True)
 assert answer.splitlines()[-1]=='10.0.10.201'
 print(json.dumps({'success':True,'vlan':vlan,'DORA':True,'Renewal':True,'DNS':f'10.0.{vlan}.30','realClientChanged':False}),flush=True)
finally:
 selector.close();client.send_signal(signal.SIGUSR2);client.terminate();client.wait(timeout=5)
DHCPCHECK
  exit 0
fi
ip netns exec "$namespace" ping -c 2 -W 2 "10.0.$vlan.1" >/dev/null
ip netns exec "$namespace" python3 - "$vlan" "$mode" "$ipv6_dns" <<'PY'
import ipaddress,json,selectors,socket,subprocess,sys,time
vlan=int(sys.argv[1]);mode=sys.argv[2];gateway=f'10.0.{vlan}.1'
neighbours=json.loads(subprocess.check_output(['ip','-j','neigh','show','dev',f'owl-wifi-{vlan}']))
assert next(item for item in neighbours if item['dst']==gateway)['lladdr']=='6c:fe:54:70:08:31'
if mode in ['dualstack','dns-policy']:
 dns6=sys.argv[3];subnet=ipaddress.IPv6Network(dns6+'/64',strict=False)
 monitor=subprocess.Popen(['ip','-6','monitor','address','route'],stdout=subprocess.PIPE,text=True)
 selector=selectors.DefaultSelector();selector.register(monitor.stdout,selectors.EVENT_READ)
 try:
  deadline=time.monotonic()+40
  while True:
   interfaces=json.loads(subprocess.check_output(['ip','-j','-6','address','show','dev',f'owl-wifi-{vlan}']))
   addresses=[ipaddress.IPv6Address(address['local']) for address in interfaces[0]['addr_info'] if not address.get('tentative') and not address.get('dadfailed')]
   routes=json.loads(subprocess.check_output(['ip','-j','-6','route','show','default']))
   if any(address in subnet for address in addresses) and any(address.is_global for address in addresses) and routes:break
   remaining=deadline-time.monotonic()
   assert remaining>0,'Missing SLAAC ULA/global address or IPv6 default route'
   assert selector.select(remaining),'Timed out waiting for IPv6 RA/SLAAC'
   monitor.stdout.readline()
 finally:
  selector.close();monitor.terminate();monitor.wait()
 answer=subprocess.check_output(['dig','-6','+short','+time=3','+tries=1','@'+dns6,'rancher.owl.red','A'],text=True)
 assert answer.splitlines()[-1]=='10.0.10.201'
 public_answers=subprocess.check_output(['dig','-6','+short','+time=3','+tries=1','@'+dns6,'example.com','AAAA'],text=True).splitlines()
 public6=next(address for address in public_answers if ipaddress.IPv6Address(address).is_global)
 connection=socket.create_connection((dns6,53),timeout=3);connection.close()
 if mode=='dns-policy':
  assert vlan in [20,50]
  answer=subprocess.check_output(['dig','+short','+time=3','+tries=1',f'@10.0.{vlan}.30','rancher.owl.red','A'],text=True)
  assert answer.splitlines()[-1]=='10.0.10.201'
  for family,address,record in [('-4','1.1.1.1','A'),('-6','2606:4700:4700::1111','AAAA')]:
   response=subprocess.run(['dig',family,'+short','+time=2','+tries=1','@'+address,'example.com',record],capture_output=True,text=True)
   assert response.returncode!=0,'Direct public DNS bypass succeeded'
   for port in [53,853]:
    try:connection=socket.create_connection((address,port),timeout=2)
    except TimeoutError:continue
    else:connection.close();raise AssertionError('Direct DNS/encrypted-DNS port bypass succeeded')
   status=subprocess.check_output(['curl',family,'--fail','--silent','--show-error','--connect-timeout','5','--max-time','15','--output','/dev/null','--write-out','%{http_code}','https://example.com'],text=True)
   assert status=='200'
  print(json.dumps({'success':True,'vlan':vlan,'localDNSBothFamilies':True,'directDNS53And853BlockedBothFamilies':True,'HTTPSBothFamilies':True}))
  raise SystemExit(0)
 for port in [22,5380]:
  try:connection=socket.create_connection((dns6,port),timeout=2)
  except TimeoutError:continue
  else:connection.close();raise AssertionError('IPv6 exposes Technitium administration')
 for address,port in [('10.0.10.3',8006),('fde4:cabf:d798:10::30',5380)]:
  try:connection=socket.create_connection((address,port),timeout=2)
  except TimeoutError:continue
  else:connection.close();raise AssertionError('Cross-VLAN administration became reachable')
 if vlan in [20,50]:
  status=subprocess.check_output(['curl','-6','--fail','--silent','--show-error','--connect-timeout','5','--max-time','15','--output','/dev/null','--write-out','%{http_code}','https://example.com'],text=True)
  assert status=='200'
 else:
  try:connection=socket.create_connection((public6,443),timeout=3)
  except TimeoutError:pass
  else:connection.close();raise AssertionError('IPv6 bypasses local/guest internet denial')
 print(json.dumps({'success':True,'vlan':vlan,'SLAACULA':True,'SLAACGlobal':True,'RADefaultRoute':True,'IPv6DNS':True,'IPv6TCP53':True,'IPv6ManagementBlocked':True,'CrossVLANManagementBlocked':True,'IPv6InternetAllowed':vlan in [20,50],'DHCPAuthorityChanged':False}))
 raise SystemExit(0)
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