import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const phase = process.argv[2] || 'plan';
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/proxmox-storage-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Storage operation failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function ssh(host, command, input) {
  return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'root@' + host, command], { input });
}
function prepareNas(config, password) {
  const request = Buffer.from(JSON.stringify({ config, password })).toString('base64');
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$target=$request['config'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function users(){return parse_ini_file('/var/local/emhttp/users.ini',true,INI_SCANNER_RAW);}
function share(){return parse_ini_file('/boot/config/shares/isos.cfg',false,INI_SCANNER_RAW);}
function update($fields){$variables=parse_ini_file('/var/local/emhttp/var.ini',false,INI_SCANNER_RAW);check(!empty($variables['csrf_token']),'Native CSRF token unavailable');$fields['csrf_token']=$variables['csrf_token'];$request=curl_init('http://localhost/update');curl_setopt_array($request,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/emhttpd.socket',CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($fields),CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30]);$output=curl_exec($request);$status=curl_getinfo($request,CURLINFO_HTTP_CODE);curl_close($request);check($output!==false&&$status>=200&&$status<300,'Native Unraid update failed');}
$protected=[];foreach(['/boot/config/shares/media.cfg','/boot/config/disk.cfg','/boot/config/super.dat','/boot/config/network.cfg'] as $file)$protected[$file]=hash_file('sha256',$file);
$original=share();check(($original['shareExport']??'')==='e'&&in_array($original['shareSecurity']??'',['secure','private']),'Unexpected ISO-share access policy');
$matches=array_filter(users(),fn($user)=>($user['name']??'')===$target['username']);
if(!$matches){update(['cmdUserEdit'=>'Add','userName'=>$target['username'],'userDesc'=>'Proxmox ISO and template storage','userPassword'=>base64_encode($request['password']),'userPasswordConf'=>base64_encode($request['password'])]);$matches=array_filter(users(),fn($user)=>($user['name']??'')===$target['username']);}
check(count($matches)===1,'Dedicated SMB identity is missing or ambiguous');
$read=array_filter(explode(',',$original['shareReadList']??''));$write=array_filter(explode(',',$original['shareWriteList']??''));
if(!in_array($target['username'],$write,true)){
 $fields=['changeShareAccess'=>'Apply','shareName'=>'isos','userAccess.0'=>'no-access'];
 foreach(users() as $user){$name=$user['name']??'';if($name==='root')continue;$access=($name===$target['username']||in_array($name,$write,true))?'read-write':(($original['shareSecurity']==='secure'||in_array($name,$read,true))?'read-only':'no-access');$fields['userAccess.'.$user['idx']]=$access;}
 update($fields);
}
$actual=share();check(($actual['shareSecurity']??'')===$original['shareSecurity']&&($actual['shareExport']??'')===$original['shareExport'],'ISO-share policy changed');check(in_array($target['username'],explode(',',$actual['shareWriteList']??''),true),'Dedicated ISO write grant missing');foreach($write as $name)check(in_array($name,explode(',',$actual['shareWriteList']??''),true),'Existing write grant lost');foreach($protected as $file=>$hash)check(hash_file('sha256',$file)===$hash,'Protected NAS settings changed');
echo json_encode(['dedicatedUser'=>$target['username'],'writeShare'=>'isos','existingSharePolicyPreserved'=>true,'protectedNasSettingsPreserved'=>true]).PHP_EOL;
`;
  console.log(ssh(config.server, 'php', php.replace('REQUEST', request)));
}
async function main() {
  assert.ok(['--validate-config', 'plan', 'prepare', 'apply', 'verify'].includes(phase), 'Use --validate-config, plan, prepare, apply or verify.');
  const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/proxmox-storage.json'), 'utf8'));
  assert.ok(config.cluster === 'owl-red' && config.coordinator === '10.0.10.3' && config.server === '10.0.10.5', 'Unexpected storage cluster or server.');
  assert.ok(config.storage_id === 'nas-isos' && config.share === 'isos' && config.username === 'pve', 'Unexpected SMB storage scope.');
  assert.deepEqual(config.content, ['iso', 'vztmpl']);
  assert.equal(config.content_dirs, 'iso=template/iso,vztmpl=template/cache');
  assert.deepEqual(Object.keys(config.nodes).sort(), ['cp1', 'cp2', 'cp3', 'edge', 'storage', 'worker1']);
  if (phase === '--validate-config') {
    console.log(JSON.stringify({ valid: true, clusterWide: true, contents: config.content, existingRootFilesMoved: false, changed: false }));
    return;
  }
  const cluster = ssh(config.coordinator, 'pvecm status');
  assert.ok(/Name:\s+owl-red\b/.test(cluster) && /Quorate:\s+Yes/.test(cluster), 'Expected quorate cluster is unavailable.');
  const perl = String.raw`use strict; use warnings; use JSON; use PVE::API2::Storage::Config; use PVE::Storage; use PVE::RPCEnvironment; use PVE::INotify;
local $/; my $request=decode_json(<STDIN>); my $target=$request->{config};
my $existing=PVE::Storage::config()->{ids}->{$target->{storage_id}};
my $created=0;
if ($existing) {
 die "Existing storage target differs\n" unless $existing->{type} eq 'cifs' && $existing->{server} eq $target->{server} && $existing->{share} eq $target->{share} && $existing->{username} eq $target->{username};
 die "Existing storage content differs\n" unless join(',',sort keys %{$existing->{content}}) eq 'iso,vztmpl';
}
if ($request->{phase} eq 'apply' && !$existing) {
 my $environment=PVE::RPCEnvironment->init('cli'); $environment->set_user('root@pam');
 my $parameters={type=>'cifs',storage=>$target->{storage_id},server=>$target->{server},share=>$target->{share},username=>$target->{username},password=>$request->{password},content=>join(',',@{$target->{content}}),nodes=>join(',',sort keys %{$target->{nodes}}),'content-dirs'=>$target->{content_dirs},smbversion=>'3.11'};
 PVE::API2::Storage::Config->create($parameters);
 $created=1;
 $existing=PVE::Storage::config()->{ids}->{$target->{storage_id}};
}
print encode_json({exists=>$existing?JSON::true:JSON::false,storage=>$target->{storage_id},changed=>$created?JSON::true:JSON::false}),"\n";
`;
  let password;
  if (['prepare', 'apply'].includes(phase)) {
    const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
    const worker = String.raw`const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');const {randomBytes}=require('node:crypto');(async()=>{let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.token);const organization='202b0b27-b135-44cd-a969-b43a003ad670';const matches=(await client.secrets().list(organization)).data.filter(secret=>secret.key===request.key);if(matches.length>1)throw Error('Duplicate storage credentials');const secret=matches.length?await client.secrets().get(matches[0].id):await client.secrets().create(organization,request.key,randomBytes(32).toString('hex'),'Dedicated Proxmox ISO/template SMB identity; do not rotate implicitly.',['89090d54-807a-4168-b063-b43a004ba0c1']);process.stdout.write(JSON.stringify({id:secret.id,value:secret.value}));})().catch(()=>{process.stderr.write('Private credential preparation failed');process.exitCode=1;});`;
    const secret = JSON.parse(execute(process.execPath, ['-e', worker], { input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, key: config.password_secret_key }) }));
    password = secret.value;
    if (phase === 'prepare') {
      prepareNas(config, password);
      console.log(JSON.stringify({ credentialSecretId: secret.id, credentialPrepared: true, clusterStorageChanged: false }));
      return;
    }
  }
  const encoded = Buffer.from(perl).toString('base64');
  const command = 'perl -MMIME::Base64 -e ' + "'eval decode_base64(\"" + encoded + "\"); die $@ if $@'";
  console.log(ssh(config.coordinator, command, JSON.stringify({ config, phase, password })));
  if (['apply', 'verify'].includes(phase)) {
    for (const [node, host] of Object.entries(config.nodes)) {
      if (phase === 'apply') ssh(host, "perl -MPVE::Storage -e 'PVE::Storage::activate_storage(PVE::Storage::config(),\"nas-isos\")'");
      const status = JSON.parse(ssh(host, 'pvesh get /nodes/' + node + '/storage/nas-isos/status --output-format json'));
      assert.ok(status.active === 1, 'Shared storage is not active on ' + node);
      console.log(JSON.stringify({ node, storage: config.storage_id, active: true }));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });