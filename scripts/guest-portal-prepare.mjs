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