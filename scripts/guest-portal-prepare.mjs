import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

process.umask(0o077);
const home = os.homedir();
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const settings = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
if (['ap-inspect', 'ap-refresh', 'ap-reload', 'ap-reboot', 'ap-allocate', 'ap-enable', 'ap-verify', 'ap-confirm', 'ap-rollback'].includes(process.argv[2])) {
  const phase = process.argv[2];
  if (phase !== 'ap-inspect') assert.equal(process.env.GUEST_PORTAL_APPLY_ALLOWED, 'true', 'Explicit guest-only AP approval is required');
  const environment = {
    ...process.env,
    BW_SECRET: settings.BW_SECRET,
    BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0'),
  };
  const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
  const executeVault = args => {
    const result = spawnSync(binary, args, { env: environment, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Private AP credential lookup failed');
    return result.stdout.trim();
  };
  environment.BW_SESSION = executeVault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
  const login = JSON.parse(executeVault(['get', 'item', '10da341d-20ad-4f4a-b15c-add2008eb0e4']));
  assert.equal(login.login.username, 'root');
  const input = JSON.parse(fs.readFileSync(path.join(home, '.local/state/owl-red/openwrt-rebuild/input.json'), 'utf8'));
  const code = String.raw`import importlib.util,json,os,pathlib,re,shlex,subprocess,sys
request=json.load(sys.stdin)
spec=importlib.util.spec_from_file_location('native_ap',request['module'])
native=importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
directory=pathlib.Path(request['directory'])
transaction_file=directory/'ap-transaction.json'
transaction=json.loads(transaction_file.read_text()) if transaction_file.exists() else {}
session=transaction.get('session') if request['phase'] in ['ap-verify','ap-confirm','ap-rollback'] else None
client=native.NativeAP('https://10.0.10.40',request['password'],request['fingerprint'],session_id=session)
board=client.call('system','board')
assert board['board_name']=='dlink,dir-885l'
assert board['release']['version']=='25.12.2'
if request['phase']=='ap-rollback':
 client.call('uci','rollback'); print(json.dumps({'guestTrialRolledBack':True})); sys.exit(0)
wireless=client.call('uci','get',{'config':'wireless'})['values']
network=client.call('uci','get',{'config':'network'})['values']
snapshot=directory/'ap-before.json'
if not snapshot.exists():
 snapshot.write_text(json.dumps({'wireless':wireless,'network':network})); snapshot.chmod(0o600)
guest=[{'name':name,'device':value.get('device'),'network':value.get('network'),'disabled':value.get('disabled'),'isolate':value.get('isolate')} for name,value in wireless.items() if value.get('.type')=='wifi-iface' and value.get('ssid')=='silence of the lans']
assert len(guest)==2 and {item['device'] for item in guest}=={'radio0','radio1'}
assert all(item['network']=='guest' and item['isolate']=='1' for item in guest)
assert network['guest']['device']=='br-guest' and network['guest']['proto']=='none'
assert network['guest_bridge']['ports']==['br-ap.30']
def shell(command,accepted=(0,)):
 result=subprocess.run(['sshpass','-e','ssh','-o','BatchMode=no','-o','StrictHostKeyChecking=yes','-o','HostKeyAlias=10.10.20.1','-o','ConnectTimeout=5','-o','PreferredAuthentications=password','-o','PubkeyAuthentication=no','root@10.0.10.40',command],env={**os.environ,'SSHPASS':request['password']},capture_output=True,text=True,timeout=60)
 assert result.returncode in accepted,'Trusted AP runtime '+shlex.split(command)[0]+' failed with exit '+str(result.returncode)+'; private output withheld'
 return result.stdout
def runtime_bindings(repair=False):
  status = json.loads(shell('ubus call network.wireless status'))
  interfaces = [interface for radio in status.values() for interface in radio.get('interfaces', [])]
  result = []
  for interface in interfaces:
    section = interface.get('section')
    name = interface.get('ifname')
    assert section in wireless and re.fullmatch(r'phy[01]-ap[0-9]+', name), 'Unexpected AP interface identity'
    selected = wireless[section]['network']
    if isinstance(selected, list):
      assert len(selected) == 1
      selected = selected[0]
    bridge = network[selected]['device']
    assert bridge in ['br-private', 'br-guest', 'br-iot-local', 'br-iot-cloud']
    probe = 'if test -d /sys/class/net/' + name + '; then readlink -f /sys/class/net/' + name + '/master || printf unbound; else printf missing; fi'
    actual = shell(probe).strip().split('/')[-1]
    if actual != bridge and repair and actual != 'missing':
      assert actual in ['br-ap', 'br-private', 'br-guest', 'br-iot-local', 'br-iot-cloud', 'master', 'unbound']
      command = ('brctl delif ' + shlex.quote(actual) + ' ' + shlex.quote(name) + '; ' if actual not in ['master', 'unbound'] else '') + 'brctl addif ' + shlex.quote(bridge) + ' ' + shlex.quote(name)
      shell(command)
      actual = shell(probe).strip().split('/')[-1]
    result.append({'section': section, 'ifname': name, 'bridge': actual, 'expected': bridge})
  return result
if request['phase']=='ap-reboot':
 marker=directory/'ap-reboot-issued.json'
 assert not marker.exists(),'The approved single AP reboot was already requested'
 assert wireless['guest_radio1']['disabled']=='1','The 5 GHz guest must remain disabled'
 assert not client.call('uci','changes',{'config':'wireless'}).get('changes'),'Refuse pending wireless edits before cold recovery'
 evidence={'bootBefore':shell('cat /proc/sys/kernel/random/boot_id').strip(),'wireless':wireless,'network':network,'singleApRebootRequested':True}
 client.call('uci','set',{'config':'wireless','section':'guest_radio0','values':{'disabled':'0'}})
 client.call('uci','commit',{'config':'wireless'})
 expected=json.loads(json.dumps(wireless)); expected['guest_radio0']['disabled']='0'
 assert native.normalize(client.call('uci','get',{'config':'wireless'})['values'])==native.normalize(expected),'Cold recovery changed non-guest wireless settings'
 marker.write_text(json.dumps(evidence)); marker.chmod(0o600)
 shell('/sbin/reboot',accepted=(0,255))
 print(json.dumps({'singleApRebootRequested':True,'onlyApprovedGuestFlagStaged':True,'nonGuestConfigurationChanged':False})); sys.exit(0)
if request['phase']=='ap-refresh':
 assert all(item['disabled']=='1' for item in guest),'Refresh is restricted to the rolled-back guest-disabled state'
 assert not client.call('uci','changes',{'config':'wireless'}).get('changes'),'Refuse to refresh pending wireless edits'
 shell('ubus call network.wireless up '+shlex.quote(json.dumps({'device':'radio1'})))
 print(json.dumps({'existingRadioRuntimeRefreshRequested':True,'wirelessConfigurationChanged':False})); sys.exit(0)
if request['phase']=='ap-reload':
 assert all(item['disabled']=='1' for item in guest),'Radio recovery requires the guest-disabled state'
 assert not client.call('uci','changes',{'config':'wireless'}).get('changes'),'Refuse pending wireless edits'
 before=json.loads(snapshot.read_text())
 assert native.normalize(before['wireless'])==native.normalize(wireless),'Wireless source changed since preimage'
 marker=directory/'radio1-recovery-issued.json'
 assert not marker.exists(),'The approved single radio recovery was already issued'
 marker.write_text(json.dumps({'radio':'radio1','nativeDownUpIssued':True})); marker.chmod(0o600)
 if transaction_file.exists(): transaction_file.rename(directory/'ap-transaction-before-radio-recovery.json')
 selected=shlex.quote(json.dumps({'device':'radio1'}))
 shell('ubus call network.wireless down '+selected+' && ubus call network.wireless up '+selected)
 print(json.dumps({'radio':'radio1','singleNativeReloadIssued':True,'wirelessConfigurationChanged':False})); sys.exit(0)
if request['phase']=='ap-allocate':
 assert not client.call('uci','changes',{'config':'wireless'}).get('changes'),'Refuse pending wireless edits'
 assert wireless['private_radio1'].get('disabled','0')=='0' and wireless['guest_radio1']['disabled']=='1','Preserve private 5 GHz and disabled guest 5 GHz'
 before=json.loads(json.dumps(wireless))
 snapshot_file=directory/'ap-before-three-bss.json'
 assert not snapshot_file.exists(),'The three-BSS allocation was already attempted'
 snapshot_file.write_text(json.dumps({'wireless':before,'network':network})); snapshot_file.chmod(0o600)
 if transaction_file.exists(): transaction_file.rename(directory/'ap-transaction-before-three-bss.json')
 client.call('uci','set',{'config':'wireless','section':'private_radio0','values':{'disabled':'1'}})
 client.call('uci','set',{'config':'wireless','section':'guest_radio0','values':{'disabled':'0'}})
 active=[name for name,value in before.items() if value.get('.type')=='wifi-iface' and value.get('disabled','0')!='1' and name!='private_radio0']
 required=sorted(set(active)|{'guest_radio0','iot_local_radio0','iot_cloud_radio0','private_radio1','iot_cloud_radio1'})
 transaction_file.write_text(json.dumps({'session':client.session_id,'guestSections':['guest_radio0'],'beforeFile':str(snapshot_file),'disabledSections':['private_radio0'],'requiredSections':required,'baselineBindings':runtime_bindings()})); transaction_file.chmod(0o600)
 client.call('uci','apply',{'rollback':True,'timeout':300})
 print(json.dumps({'threeBssTrialPending':True,'private5GHzPreserved':True,'rollbackSeconds':300})); sys.exit(0)
if request['phase']=='ap-enable':
 assert not transaction_file.exists(),'An existing AP trial must be reviewed first'
 before=json.loads(snapshot.read_text())
 assert native.normalize(before['wireless'])==native.normalize(wireless),'AP wireless configuration changed since preimage'
 assert native.normalize(before['network'])==native.normalize(network),'AP network configuration changed since preimage'
 assert all(item['disabled']=='1' for item in guest)
 assert not client.call('uci','changes',{'config':'wireless'}).get('changes')
 selected=[item for item in guest if item['device']=='radio0']
 assert len(selected)==1,'Only the approved 2.4 GHz guest BSS may be enabled'
 baseline_bindings=runtime_bindings()
 for item in selected: client.call('uci','set',{'config':'wireless','section':item['name'],'values':{'disabled':'0'}})
 transaction_file.write_text(json.dumps({'session':client.session_id,'guestSections':[item['name'] for item in selected],'baselineBindings':baseline_bindings})); transaction_file.chmod(0o600)
 try: client.call('uci','apply',{'rollback':True,'timeout':300})
 except native.APError: print(json.dumps({'guestTrialPending':True,'applyResponseUnknown':True})); sys.exit(0)
 print(json.dumps({'guestTrialPending':True,'rollbackSeconds':300})); sys.exit(0)
if request['phase'] in ['ap-verify','ap-confirm']:
 assert session,'A native UCI trial session is required'
 before=json.loads(pathlib.Path(transaction.get('beforeFile',str(snapshot))).read_text())
 expected=before['wireless']
 for name in transaction['guestSections']: expected[name]['disabled']='0'
 for name in transaction.get('disabledSections',[]): expected[name]['disabled']='1'
 assert native.normalize(wireless)==native.normalize(expected),'Non-guest wireless changes detected'
 assert native.normalize(network)==native.normalize(before['network']),'AP network topology changed'
 bindings=runtime_bindings(repair=True)
 baseline={item['section']:item for item in transaction['baselineBindings']}
 required=set(transaction.get('requiredSections',[])) or ({name for name,item in baseline.items() if item['bridge']!='missing'}|set(transaction['guestSections']))
 actual={item['section']:item for item in bindings}
 assert all(name in actual and actual[name]['bridge']==actual[name]['expected'] for name in required),'An active AP bridge boundary changed or the guest BSS is missing'
 verified=directory/'ap-runtime-verified.json'
 verified.write_text(json.dumps({'bindings':bindings})); verified.chmod(0o600)
 status=json.loads(shell('ubus call network.wireless status'))
 interfaces=[interface for radio in status.values() for interface in radio.get('interfaces',[])]
 active=[{'section':interface.get('section'),'ifname':interface.get('ifname')} for interface in interfaces if interface.get('section') in transaction['guestSections']]
 assert len(active)==len(transaction['guestSections']),'The approved guest BSS must be active'
 if request['phase']=='ap-confirm':
  assert (directory/'ap-runtime-verified.json').exists(),'Actual guest and existing BSS bridge bindings must be verified before confirmation'
  client.call('uci','confirm')
  print(json.dumps({'guestSsidEnabled':True,'guestBand':'2.4GHz','guest5GHzEnabled':False,'otherSsidConfigurationPreserved':True})); sys.exit(0)
 print(json.dumps({'guestBss':active,'allBss':[{'section':interface.get('section'),'ifname':interface.get('ifname')} for interface in interfaces],'nonGuestConfigurationPreserved':True})); sys.exit(0)
bindings=runtime_bindings()
kernel=shell('for device in /sys/class/net/phy*-ap*; do test -d "$device" || continue; name=$(basename "$device"); bridge=$(readlink -f "$device/master" 2>/dev/null || true); master=$(basename "$bridge"); printf "%s %s\\n" "$name" "$master"; done')
logs=shell('logread | tail -250')
errors=[re.sub(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}','[mac]',line) for line in logs.splitlines() if re.search(r'phy[01]|radio[01]',line) and re.search(r'fail|error|not supported|no space|busy',line,re.I) and not re.search(r'password|psk|secret|key',line,re.I)]
print(json.dumps({'guestSections':guest,'guestNetwork':{name:network.get('guest',{}).get(name) for name in ['device','proto']},'guestDevices':[{'name':name,'type':value.get('type'),'ports':value.get('ports')} for name,value in network.items() if value.get('name') in ['br-guest','br-ap.30']],'runtimeBindings':bindings,'kernelBridges':kernel.splitlines(),'radioRuntimeErrors':errors[-8:],'currentBssBridgeBindingsMatch':all(item['bridge']==item['expected'] for item in bindings)}))
`;
  const result = spawnSync(path.join(repository, '.venv/bin/python'), ['-c', code], {
    input: JSON.stringify({ phase, module: path.join(repository, 'ansible/library/openwrt_ap.py'), password: login.login.password, fingerprint: input.certificate_sha256, directory: path.join(home, '.local/state/owl-red/guest-cutover-Bgjxae') }),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fs.writeFileSync(path.join(home, '.local/state/owl-red/guest-cutover-Bgjxae/ap-inspect-failure.log'), result.stderr, { mode: 0o600 });
    throw new Error('Private AP inspection failed; recovery diagnostics retained');
  }
  console.log(result.stdout.trim());
  process.exit(0);
}
const require = createRequire(import.meta.url);
const sdk = require(path.join(home, '.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi'));
const client = new sdk.BitwardenClient(undefined, 4);
await client.auth().loginAccessToken(settings.BWS_ACCESS_TOKEN);
const organization = '202b0b27-b135-44cd-a969-b43a003ad670';
const name = 'guest-portal__technitium-lease-token';
const matches = (await client.secrets().list(organization)).data.filter(secret => secret.key === name);
assert(matches.length <= 1, 'Duplicate guest lease-reader credentials');
let credential;
if (matches.length) {
  credential = await client.secrets().get(matches[0].id);
} else {
  const code = String.raw`import pathlib,urllib.request,urllib.parse,json,secrets
admin=pathlib.Path('/etc/technitium/sync.token').read_text().strip()
def api(path,parameters,token=admin):
 request=urllib.request.Request('http://127.0.0.1:5380/api/'+path,data=urllib.parse.urlencode({'token':token,**parameters}).encode())
 with urllib.request.urlopen(request,timeout=10) as response: return json.load(response)
user='owl-guest-lease-reader'
users=api('admin/users/list',{})
assert users['status']=='ok'
assert not any(item['username']==user for item in users['response']['users']),'Unmanaged lease reader already exists'
before=api('admin/permissions/get',{'section':'DhcpServer'})
assert before['status']=='ok'
directory=pathlib.Path('/var/lib/owl-guest-portal'); directory.mkdir(mode=0o700,exist_ok=True)
preimage=directory/'dhcp-permissions-before.json'
assert not preimage.exists(),'Unfinished credential preparation needs review'
preimage.write_text(json.dumps(before)); preimage.chmod(0o600)
created=api('admin/users/create',{'user':user,'pass':secrets.token_urlsafe(36),'displayName':'owl.red guest read-only lease adapter'})
assert created['status']=='ok','Could not create dedicated lease reader'
rows=before['response']['userPermissions']+[{'username':user,'canView':True,'canModify':False,'canDelete':False}]
table='|'.join('|'.join([item['username'],str(item['canView']).lower(),str(item['canModify']).lower(),str(item['canDelete']).lower()]) for item in rows)
updated=api('admin/permissions/set',{'section':'DhcpServer','userPermissions':table})
assert updated['status']=='ok','Could not grant DHCP view permission'
issued=api('admin/sessions/createToken',{'user':user,'tokenName':'owl.red guest lease facts'})
assert issued['status']=='ok','Could not issue dedicated API token'
token=issued['response']['token']
session=api('user/session/get',{},token)
permissions=session['info']['permissions']
assert permissions['DhcpServer']['canView'] and not permissions['DhcpServer']['canModify'] and not permissions['DhcpServer']['canDelete']
assert all(not item['canModify'] and not item['canDelete'] for item in permissions.values()),'Reader unexpectedly has mutation permissions'
assert api('dhcp/leases/list',{},token)['status']=='ok'
assert api('settings/get',{},token)['status']!='ok','Reader unexpectedly has settings access'
print(json.dumps({'token':token}))
`;
  const result = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.3', 'pct exec 200 -- /run/current-system/sw/bin/python3 -'], { input: code, encoding: 'utf8' });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/guest-credential-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), result.stderr, { mode: 0o600 });
    throw new Error('Private lease-reader preparation failed; diagnostics: ' + directory);
  }
  const value = JSON.parse(result.stdout).token;
  assert(value, 'Native lease-reader token missing');
  credential = await client.secrets().create(organization, name, value, 'Technitium DHCP-view-only API token for native openNDS lease facts', ['89090d54-807a-4168-b063-b43a004ba0c1']);
}
const directory = path.join(home, '.local/state/owl-red/guest-portal');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(directory, 'technitium.token'), credential.value, { mode: 0o600 });
console.log(JSON.stringify({ leaseReaderSecretId: credential.id, credentialPreparedPrivately: true }));