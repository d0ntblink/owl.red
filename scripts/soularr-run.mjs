import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'prepare', 'seed', 'verify', 'repair-config'].includes(phase), 'Use plan, prepare, seed, verify or repair-config.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = os.homedir();
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/soularr.json'), 'utf8'));
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/soularr-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Soularr migration failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function ssh(php) {
  return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], php);
}
function kubectl(args, input) { return execute('kubectl', ['-n', config.namespace, ...args], input); }
const common = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Soularr migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed');return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private write failed');chmod($file,0600);}
$directory='/root/.local/state/owl-red/soularr-migration';
`;
function capture() {
  return JSON.parse(ssh(common + String.raw`
$containers=[];foreach(['slskd','soularr'] as $name){$container=json_decode(run(['docker','inspect',$name]),true,512,JSON_THROW_ON_ERROR)[0];check(!$container['State']['Running'],'NAS dependency pair must stay stopped');$containers[$name]=$container;}
check($containers['slskd']['Image']==='sha256:049ad0e0e881b39a9bd1ed270e882e964a86fac18076fc11438161f76ababf54','slskd image changed');check($containers['soularr']['Image']==='sha256:4c2dba73ff1967767b1db060b59254906893b82fa289b94a9b936e7c2b7da709','Soularr image changed');
$environment=[];foreach($containers['slskd']['Config']['Env'] as $entry){[$key,$value]=explode('=',$entry,2);if(str_starts_with($key,'SLSKD_'))$environment[$key]=$value;}
$lidarr=simplexml_load_file('/mnt/user/appdata/binhex-lidarr/config.xml');
echo json_encode(['yaml'=>file_get_contents('/mnt/user/appdata/slskd/slskd.yml'),'environment'=>$environment,'lidarrKey'=>(string)$lidarr->ApiKey],JSON_THROW_ON_ERROR);
`));
}
async function main() {
  if (phase === 'repair-config') {
    const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=qbittorrent', '-o', 'json'])).items;
    assert.ok(pods.every(pod => !pod.status.containerStatuses?.find(container => container.name === 'slskd')?.ready), 'Repair only the rejected, inactive slskd configuration.');
    const original = ssh(common + "echo file_get_contents('/mnt/user/appdata/slskd/slskd.yml');\n");
    const parser = String.raw`import sys,yaml
settings=yaml.safe_load(sys.stdin)
transfers=settings.setdefault('transfers',{})
for name,values in (settings.pop('global',{}) or {}).items():
    target=transfers.setdefault(name,{})
    for key,value in values.items(): target.setdefault(key,value)
if 'groups' in settings:
    target=transfers.setdefault('groups',{})
    for key,value in settings.pop('groups').items(): target.setdefault(key,value)
print(yaml.safe_dump(settings,sort_keys=False))`;
    const repaired = execute(path.join(repository, '.venv/bin/python'), ['-c', parser], original);
    console.log(ssh(common + "$file='/mnt/user/appdata/slskd/slskd.yml';privateFile($directory.'/slskd-before-schema-repair.yml',file_get_contents($file));privateFile($file,base64_decode('" + Buffer.from(repaired).toString('base64') + "'));chown($file,'k8s');chgrp($file,'users');chmod($file,0660);echo json_encode(['nativeTransfersSchemaRepaired'=>true,'limitValuesPreserved'=>true]).PHP_EOL;\n"));
    return;
  }
  if (phase === 'plan' || phase === 'prepare') {
    const source = capture();
    const parsed = JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(json.load(sys.stdin)["yaml"]) or {}))'], JSON.stringify(source)));
    if (phase === 'plan') {
      console.log(JSON.stringify({ nasPairStopped: true, slskdImagePinned: true, soularrImagePinned: true, downloads: parsed.directories?.downloads || '/app/downloads', incomplete: parsed.directories?.incomplete || '/app/incomplete', sharedDirectories: parsed.shares?.directories || [], soulseekCredentialsPresent: Boolean(parsed.soulseek?.username || source.environment.SLSKD_SLSK_USERNAME), changed: false }));
      return;
    }
    const template = await fetch('https://raw.githubusercontent.com/mrusse/soularr/2037399aa57433f9032bbae09833439830d2b409/config.ini');
    assert.ok(template.ok, 'Pinned native Soularr template unavailable.');
    source.template = await template.text();
    const deployment = JSON.parse(kubectl(['get', 'deployment', config.deployment, '-o', 'json']));
    assert.ok(!deployment.spec.template.spec.containers.some(container => container.name === 'slskd'), 'Prepare only before the cluster slskd writer is added.');
    const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
    const worker = String.raw`const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');const {randomBytes}=require('node:crypto');(async()=>{let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.token);const organization='202b0b27-b135-44cd-a969-b43a003ad670';const key='slskd__soularr-api-key';const matches=(await client.secrets().list(organization)).data.filter(secret=>secret.key===key);if(matches.length>1)throw Error('Duplicate API credential');const secret=matches.length?await client.secrets().get(matches[0].id):await client.secrets().create(organization,key,randomBytes(32).toString('hex'),'Soularr access to slskd; preserve existing account credentials',['89090d54-807a-4168-b063-b43a004ba0c1']);process.stdout.write(JSON.stringify({id:secret.id,value:secret.value}));})().catch(()=>{process.stderr.write('Private API credential preparation failed');process.exitCode=1;});`;
    const secret = JSON.parse(execute(process.execPath, ['-e', worker], JSON.stringify({ token: stored.BWS_ACCESS_TOKEN })));
    const parser = String.raw`import configparser,io,json,sys,yaml
request=json.load(sys.stdin)
settings=yaml.safe_load(request['yaml']) or {}
def default(path,value):
    node=settings
    for key in path[:-1]:
        if not isinstance(node.get(key),dict): node[key]={}
        node=node[key]
    if node.get(path[-1]) is None: node[path[-1]]=value
mapping={'SLSKD_SLSK_USERNAME':['soulseek','username'],'SLSKD_SLSK_PASSWORD':['soulseek','password'],'SLSKD_USERNAME':['web','authentication','username'],'SLSKD_PASSWORD':['web','authentication','password'],'SLSKD_SLSK_DESCRIPTION':['soulseek','description'],'SLSKD_UPLOAD_SLOTS':['transfers','upload','slots'],'SLSKD_UPLOAD_SPEED_LIMIT':['transfers','upload','speed_limit']}
for key,target in mapping.items():
    if key in request['environment']:
        value=request['environment'][key]
        default(target,int(value) if key in ['SLSKD_UPLOAD_SLOTS','SLSKD_UPLOAD_SPEED_LIMIT'] else value)
default(['web','authentication','api_keys','soularr','key'],request['apiKey'])
default(['web','authentication','api_keys','soularr','role'],'Administrator')
default(['web','authentication','api_keys','soularr','cidr'],'127.0.0.0/8')
api_key=settings['web']['authentication']['api_keys']['soularr']['key']
if not settings.get('soulseek',{}).get('username') or not settings.get('soulseek',{}).get('password'): raise ValueError('Existing Soulseek credentials required')
config=configparser.ConfigParser(interpolation=None)
config.read_string(request['template'])
config['Lidarr']['api_key']=request['lidarrKey']
config['Lidarr']['host_url']='http://10.0.10.5:8686'
config['Lidarr']['download_dir']='/media/Downloads/slskd'
config['Slskd']['api_key']=api_key
config['Slskd']['host_url']='http://127.0.0.1:5030'
config['Slskd']['download_dir']='/downloads'
buffer=io.StringIO();config.write(buffer)
directories=settings.get('directories',{})
print(json.dumps({'yaml':yaml.safe_dump(settings,sort_keys=False),'ini':buffer.getvalue(),'downloads':directories.get('downloads') or '/app/downloads','incomplete':directories.get('incomplete') or '/app/incomplete'}))
`;
    const prepared = JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', parser], JSON.stringify({ ...source, apiKey: secret.value })));
    assert.ok(['/app/downloads', '/media/Downloads/slskd'].includes(prepared.downloads), 'Review existing download placement before changing it.');
    const payload = Buffer.from(JSON.stringify(prepared)).toString('base64');
    console.log(ssh(common + String.raw`
$request=json_decode(base64_decode('PAYLOAD'),true,512,JSON_THROW_ON_ERROR);if(!is_dir($directory))mkdir($directory,0700,true);
foreach(['slskd','soularr'] as $name){$container=json_decode(run(['docker','inspect',$name]),true)[0];check(!$container['State']['Running'],'NAS source started elsewhere');if(!is_file($directory.'/'.$name.'-before.json'))privateFile($directory.'/'.$name.'-before.json',json_encode($container));run(['docker','update','--restart','no',$name]);}
$file='/mnt/user/appdata/slskd/slskd.yml';if(!is_file($directory.'/slskd-before.yml'))privateFile($directory.'/slskd-before.yml',file_get_contents($file));privateFile($file,$request['yaml']);chown($file,'k8s');chgrp($file,'users');chmod($file,0660);chgrp(dirname($file),'users');chmod(dirname($file),0770);
$root='/mnt/user/appdata/soularr';check(is_dir($root)&&!is_link($root),'Expected Soularr appdata directory');check(!is_file($root.'/config.ini'),'Refusing to replace existing Soularr configuration');privateFile($root.'/config.ini',$request['ini']);chown($root,'k8s');chgrp($root,'users');chmod($root,0770);chown($root.'/config.ini','k8s');chgrp($root.'/config.ini','users');chmod($root.'/config.ini',0660);
$stage=$directory.'/database';check(!file_exists($stage),'Database staging already exists; inspect before retrying');mkdir($stage,0700);$baseline=[];
foreach(glob('/mnt/user/appdata/slskd/data/*.db') as $file){$source=new SQLite3($file,SQLITE3_OPEN_READONLY);$target=new SQLite3($stage.'/'.basename($file));check($source->backup($target),'Native SQLite backup failed');check($target->querySingle('PRAGMA quick_check')==='ok','SQLite integrity failed');$baseline[basename($file)]=hash_file('sha256',$stage.'/'.basename($file));$target->close();$source->close();chmod($stage.'/'.basename($file),0600);}
check(count($baseline)===5,'Unexpected database inventory');privateFile($directory.'/database-hashes.json',json_encode($baseline));run(['tar','-C',$stage,'-czf',$directory.'/database.tgz','.']);chmod($directory.'/database.tgz',0600);privateFile($directory.'/paths.json',json_encode(['downloads'=>$request['downloads'],'incomplete'=>$request['incomplete']]));
echo json_encode(['privateConfigsPrepared'=>true,'existingSlskdCredentialsPreserved'=>true,'soularrInitialized'=>true,'sqliteBackupsVerified'=>count($baseline),'diskToolingChanged'=>false]).PHP_EOL;
`.replace('PAYLOAD', payload)));
    console.log(JSON.stringify({ apiCredentialSecretId: secret.id }));
    return;
  }
  if (phase === 'seed') {
    const workload = JSON.parse(kubectl(['get', 'deployment', config.deployment, '-o', 'json']));
    assert.ok(!workload.spec.template.spec.containers.some(container => container.name === 'slskd'), 'Do not seed an active database.');
    const claim = JSON.parse(kubectl(['get', 'pvc', config.slskd.database_claim, '-o', 'json']));
    assert.equal(claim.spec.storageClassName, 'longhorn-appdata');
    const name = 'slskd-database-seed';
    const existing = kubectl(['get', 'pod', name, '--ignore-not-found', '-o', 'json']);
    assert.ok(!existing, 'Seeder already exists; inspect before retrying.');
    const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: config.namespace, labels: { 'owl.red/migration': 'slskd-database' } }, spec: { restartPolicy: 'Never', activeDeadlineSeconds: 300, automountServiceAccountToken: false, tolerations: workload.spec.template.spec.tolerations, containers: [{ name: 'seed', image: workload.spec.template.spec.containers[0].image, command: ['/bin/bash', '-ec', 'exec tail -f /dev/null'], securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'], add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'] } }, volumeMounts: [{ name: 'database', mountPath: '/database' }] }], volumes: [{ name: 'database', persistentVolumeClaim: { claimName: config.slskd.database_claim } }] } };
    kubectl(['create', '-f', '-'], JSON.stringify(pod));
    kubectl(['wait', '--for=condition=Ready', 'pod/' + name, '--timeout=180s']);
    const archive = ssh(common + "echo base64_encode(file_get_contents($directory.'/database.tgz'));\n");
    kubectl(['exec', '-i', name, '-c', 'seed', '--', '/bin/bash', '-ec', 'test ! -e /database/.owl-red-seeded; test ! -e /database/transfers.db; tar --no-same-owner -xzf - -C /database; chown -R 1654:100 /database'], Buffer.from(archive, 'base64'));
    const hashes = JSON.parse(ssh(common + "echo file_get_contents($directory.'/database-hashes.json');\n"));
    for (const [file, expected] of Object.entries(hashes)) {
      assert.match(file, /^[a-z.]+\.db$/);
      const actual = kubectl(['exec', name, '-c', 'seed', '--', 'sha256sum', '/database/' + file]).split(/\s+/)[0];
      assert.equal(actual, expected, 'Copied database checksum differs: ' + file);
    }
    kubectl(['exec', name, '-c', 'seed', '--', 'touch', '/database/.owl-red-seeded']);
    kubectl(['delete', 'pod', name, '--wait=true']);
    console.log(JSON.stringify({ databasesSeededAndChecksummed: Object.keys(hashes).length, storage: 'longhorn-appdata', originalNasDatabasesRetained: true }));
    return;
  }
  if (phase === 'verify') {
    const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=qbittorrent', '-o', 'json'])).items;
    assert.equal(pods.length, 1);
    const pod = pods[0];
    assert.ok(pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Shared VPN pod must be Ready.');
    const credentials = JSON.parse(ssh(common + String.raw`$ini=parse_ini_file('/mnt/user/appdata/soularr/config.ini',true,INI_SCANNER_RAW);echo json_encode(['apiKey'=>$ini['Slskd']['api_key'],'lidarrKey'=>$ini['Lidarr']['api_key']]);`));
    const call = endpoint => JSON.parse(kubectl(['exec', '-i', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', '--max-time', '15', '--config', '-'], 'url = "http://127.0.0.1:5030/api/v0/' + endpoint + '"\nheader = "X-API-Key: ' + credentials.apiKey + '"\n'));
    const options = call('options');
    const server = call('server');
    const forwarding = JSON.parse(kubectl(['exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', 'http://127.0.0.1:8000/v1/portforward']));
    const ports = forwarding.ports || [forwarding.port];
    assert.equal(ports.length, 2, 'Two provider-forwarded ports required.');
    assert.equal(options.soulseek.listenPort, ports[0]);
    const qbittorrent = JSON.parse(kubectl(['exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', 'http://127.0.0.1:8080/api/v2/app/preferences']));
    assert.equal(qbittorrent.listen_port, ports[1]);
    assert.match(String(server.state), /LoggedIn/i, 'Soulseek login must succeed.');
    const connections = [
      'import configparser,json,urllib.request',
      "settings=configparser.ConfigParser(interpolation=None); settings.read('/data/config.ini')",
      "for section,route in [('Lidarr','/api/v1/system/status'),('Slskd','/api/v0/server')]:",
      "    request=urllib.request.Request(settings[section]['host_url'].rstrip('/')+route,headers={'X-Api-Key':settings[section]['api_key']})",
      '    with urllib.request.urlopen(request,timeout=15) as response:',
      "        if response.status!=200: raise RuntimeError('Native API connection failed')",
      "print(json.dumps({'soularrLidarrConnection':True,'soularrSlskdConnection':True}))",
    ].join('\n');
    console.log(kubectl(['exec', '-i', pod.metadata.name, '-c', 'soularr', '--', 'python', '-'], connections));
    console.log(JSON.stringify({ soulseekLoggedIn: true, separateForwardedPortsSynchronized: true, slskdAndSoularrRunning: true, sharedVpnPod: pod.metadata.name, diskToolingChanged: false }));
    return;
  }
  throw Error('Phase not implemented yet.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });