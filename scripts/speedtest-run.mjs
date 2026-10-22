import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'prepare';
assert.ok(['prepare', 'verify', 'retire'].includes(phase), 'Use prepare, verify or retire.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/speedtest.json'), 'utf8'));
const home = os.homedir();
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/speedtest-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Speedtest operation failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function kubectl(args, input) { return execute('kubectl', ['-n', config.namespace, ...args], input); }
function ssh(code) { return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], code); }
const common = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Speedtest operation failed: '.$error->getMessage().PHP_EOL);exit(1);});
$config=json_decode(base64_decode('CONFIG'),true,512,JSON_THROW_ON_ERROR);$directory=$config['private_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed');return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private write failed');check(chmod($file,0600),'Private permissions failed');}
`.replace('CONFIG', Buffer.from(JSON.stringify(config)).toString('base64'));
async function main() {
  if (phase === 'prepare') {
    const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
    const worker = String.raw`const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');const {randomBytes}=require('node:crypto');(async()=>{let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.token);const organization='202b0b27-b135-44cd-a969-b43a003ad670';const existing=(await client.secrets().list(organization)).data;const output={};for(const [name,key] of Object.entries(request.keys)){const matches=existing.filter(secret=>secret.key===key);if(matches.length>1)throw Error('Duplicate application credential');const value=name==='APP_KEY'?'base64:'+randomBytes(32).toString('base64'):randomBytes(24).toString('hex');const secret=matches.length?await client.secrets().get(matches[0].id):await client.secrets().create(organization,key,value,'Fresh Speedtest Tracker application credential; preserve on redeploy',['89090d54-807a-4168-b063-b43a004ba0c1']);output[name]={id:secret.id};}process.stdout.write(JSON.stringify(output));})().catch(()=>{process.stderr.write('Private application credential preparation failed');process.exitCode=1;});`;
    const secrets = JSON.parse(execute(process.execPath, ['-e', worker], JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, keys: { APP_KEY: config.app_key_secret, ADMIN_PASSWORD: config.admin_password_secret } })));
    console.log(ssh(common + String.raw`
if(!is_dir($directory))mkdir($directory,0700,true);$root=$config['config_directory'];check(!file_exists($root)||is_file($root.'/.owl-red-speedtest-fresh'),'Refusing to reuse unmanaged appdata');if(!is_dir($root))mkdir($root,0770,true);privateFile($root.'/.owl-red-speedtest-fresh','fresh-v1.15-postgresql');chown($root,'k8s');chgrp($root,'users');chmod($root,0770);chown($root.'/.owl-red-speedtest-fresh','k8s');
$legacy=json_decode(run(['docker','inspect',$config['legacy_container']]),true)[0];check($legacy['Image']===$config['legacy_image_id'],'Legacy image changed');if(!is_file($directory.'/legacy-container-before.json'))privateFile($directory.'/legacy-container-before.json',json_encode($legacy));run(['docker','update','--restart','no',$config['legacy_container']]);if($legacy['State']['Running'])run(['docker','stop','--time','60',$config['legacy_container']]);
echo json_encode(['newAppdataPrepared'=>true,'legacyContainerStopped'=>true,'legacyHistoryImported'=>false,'legacyFilesDeleted'=>false]).PHP_EOL;
`));
    console.log(JSON.stringify({ credentialSecretIds: secrets }));
    return;
  }
  const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=speedtest', '-o', 'json'])).items;
  assert.equal(pods.length, 1);
  const pod = pods[0];
  assert.ok(pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Replacement must be Ready.');
  if (phase === 'verify') {
    const php = String.raw`<?php
require '/app/www/vendor/autoload.php';$app=require '/app/www/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if(config('database.default')!=='pgsql'||config('database.connections.pgsql.database')!=='speedtest')throw new RuntimeException('Wrong database backend');
$user=App\Models\User::where('email',getenv('ADMIN_EMAIL'))->first();if(!$user||!$user->is_admin||!Illuminate\Support\Facades\Hash::check(getenv('ADMIN_PASSWORD'),$user->password))throw new RuntimeException('Initial administrator credentials do not match');
echo json_encode(['postgresqlConnected'=>Illuminate\Support\Facades\DB::selectOne('SELECT 1 AS ok')->ok===1,'database'=>'speedtest','adminAccountVerified'=>true,'users'=>App\Models\User::count(),'schedule'=>config('speedtest.schedule'),'legacyResultsImported'=>false]).PHP_EOL;
`;
    console.log(kubectl(['exec', '-i', pod.metadata.name, '-c', 'speedtest', '--', 'php'], php));
    return;
  }
  if (phase === 'retire') {
    console.log(ssh(common + String.raw`
$legacy=json_decode(run(['docker','inspect',$config['legacy_container']]),true)[0];check($legacy['Image']===$config['legacy_image_id']&&!$legacy['State']['Running'],'Only the stopped reviewed legacy container can be retired');check(is_file($directory.'/legacy-container-before.json'),'Legacy definition preimage missing');
$autostart='/boot/config/plugins/dockerMan/autostart';if(is_file($autostart)){$original=file_get_contents($autostart);if(!is_file($directory.'/autostart-before.txt'))privateFile($directory.'/autostart-before.txt',$original);$lines=explode("\n",$original);$lines=array_values(array_filter($lines,function($line)use($config){$name=preg_split('/\s+/',trim($line))[0]??'';return $name!==$config['legacy_container'];}));check(file_put_contents($autostart,implode("\n",$lines))!==false,'Autostart retirement failed');}
$template='/boot/config/plugins/dockerMan/templates-user/my-speedtest-tracker.xml';if(is_file($template)){privateFile($directory.'/legacy-unraid-template.xml',file_get_contents($template));check(unlink($template),'Legacy template retirement failed');}run(['docker','rm',$config['legacy_container']]);
check(is_file('/mnt/user/appdata/speedtest-tracker/speed.db')&&is_file('/mnt/user/appdata/speedtest-tracker/database.sqlite'),'Legacy database files must remain intact');echo json_encode(['legacyContainerAndTemplateRetired'=>true,'legacyHistoryFilesRetained'=>true,'newInstanceUntouched'=>true]).PHP_EOL;
`));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });