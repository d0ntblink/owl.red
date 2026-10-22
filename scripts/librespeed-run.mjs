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
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/librespeed.json'), 'utf8'));
const home = os.homedir();
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/librespeed-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Librespeed operation failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function kubectl(args, input) { return execute('kubectl', ['-n', config.namespace, ...args], input); }
function ssh(code) { return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], code); }
const common = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Librespeed operation failed: '.$error->getMessage().PHP_EOL);exit(1);});
$config=json_decode(base64_decode('CONFIG'),true,512,JSON_THROW_ON_ERROR);$directory=$config['private_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args,$input=null,$environment=null){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes,null,$environment);if($input!==null)fwrite($pipes[0],$input);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed');return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private write failed');check(chmod($file,0600),'Private permissions failed');}
`.replace('CONFIG', Buffer.from(JSON.stringify(config)).toString('base64'));
async function main() {
  if (phase === 'prepare') {
    const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
    const worker = String.raw`const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');const {randomBytes}=require('node:crypto');(async()=>{let text='';for await(const chunk of process.stdin)text+=chunk;const request=JSON.parse(text);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.token);const organization='202b0b27-b135-44cd-a969-b43a003ad670';const all=(await client.secrets().list(organization)).data;const database=all.filter(secret=>secret.key===request.databaseKey);if(database.length!==1)throw Error('Existing database credential required');const matches=all.filter(secret=>secret.key===request.statsKey);if(matches.length>1)throw Error('Duplicate stats credential');const stats=matches.length?await client.secrets().get(matches[0].id):await client.secrets().create(organization,request.statsKey,randomBytes(24).toString('hex'),'Fresh Librespeed results-page password; retain on redeploy',['89090d54-807a-4168-b063-b43a004ba0c1']);const password=await client.secrets().get(database[0].id);process.stdout.write(JSON.stringify({database:password.value,statsId:stats.id}));})().catch(()=>{process.stderr.write('Private credential preparation failed');process.exitCode=1;});`;
    const secrets = JSON.parse(execute(process.execPath, ['-e', worker], JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, databaseKey: config.database_password_secret, statsKey: config.stats_password_secret })));
    console.log(ssh(common + String.raw`
if(!is_dir($directory))mkdir($directory,0700,true);$root=$config['config_directory'];check(!file_exists($root)||is_file($root.'/.owl-red-librespeed-fresh'),'Refusing to reuse unmanaged configuration');if(!is_dir($root))mkdir($root,0770,true);privateFile($root.'/.owl-red-librespeed-fresh','fresh-postgresql');chown($root,'k8s');chgrp($root,'users');chmod($root,0770);chown($root.'/.owl-red-librespeed-fresh','k8s');
$environment=getenv();$environment['PGPASSWORD']=base64_decode('DATABASE_PASSWORD');$psql=['docker','exec','-i','-e','PGPASSWORD','postgresql','psql','-h','127.0.0.1','-U','librespeed','-d','librespeed','-v','ON_ERROR_STOP=1','-At'];$exists=run(array_merge($psql,['-c',"SELECT to_regclass('public.speedtest_users') IS NOT NULL"]),null,$environment);
if($exists==='f'){$schema=run(['docker','run','--rm','--network','none','--entrypoint','cat',$config['image'],'/app/www/public/results/telemetry_postgresql.sql']);$schema=str_replace(["SET default_with_oids = false;","COMMENT ON EXTENSION plpgsql IS 'PL/pgSQL procedural language';"],'',$schema);run($psql,$schema,$environment);}
check(run(array_merge($psql,['-c','SELECT count(*) FROM speedtest_users']),null,$environment)==='0','Fresh database must be empty before activation');
$legacy=json_decode(run(['docker','inspect',$config['legacy_container']]),true)[0];check($legacy['Image']===$config['legacy_image_id'],'Legacy image changed');if(!is_file($directory.'/legacy-container-before.json'))privateFile($directory.'/legacy-container-before.json',json_encode($legacy));run(['docker','update','--restart','no',$config['legacy_container']]);if($legacy['State']['Running'])run(['docker','stop','--time','60',$config['legacy_container']]);
echo json_encode(['freshDatabaseInitialized'=>true,'legacyTelemetryImported'=>false,'newAppdataPrepared'=>true,'legacyContainerStopped'=>true,'legacyFilesDeleted'=>false]).PHP_EOL;
`.replace('DATABASE_PASSWORD', Buffer.from(secrets.database).toString('base64'))));
    console.log(JSON.stringify({ statsPasswordSecretId: secrets.statsId }));
    return;
  }
  const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=librespeed', '-o', 'json'])).items;
  assert.equal(pods.length, 1);
  const pod = pods[0];
  assert.ok(pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Replacement must be Ready.');
  if (phase === 'verify') {
    const php = String.raw`<?php
include '/app/www/public/results/telemetry_settings.php';
if($db_type!=='postgresql'||$PostgreSql_databasename!=='librespeed')throw new RuntimeException('Wrong telemetry backend');
$database=new PDO('pgsql:host='.$PostgreSql_hostname.';dbname='.$PostgreSql_databasename,$PostgreSql_username,$PostgreSql_password,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);$rows=$database->query('SELECT count(*) FROM speedtest_users')->fetchColumn();$database->beginTransaction();$statement=$database->prepare('INSERT INTO speedtest_users (ip,ua,lang,log) VALUES (:ip,:ua,:lang,:log)');$statement->execute(['ip'=>'127.0.0.1','ua'=>'owl-red-verification','lang'=>'en','log'=>'temporary-transaction-check']);$database->rollBack();
echo json_encode(['postgresqlTelemetryVerified'=>true,'nativeSchemaWritable'=>true,'verificationRowRolledBack'=>true,'currentTelemetryRows'=>(int)$rows,'freshInstance'=>true]).PHP_EOL;
`;
    console.log(kubectl(['exec', '-i', pod.metadata.name, '-c', 'librespeed', '--', 'php'], php));
    return;
  }
  if (phase === 'retire') {
    console.log(ssh(common + String.raw`
$legacy=json_decode(run(['docker','inspect',$config['legacy_container']]),true)[0];check($legacy['Image']===$config['legacy_image_id']&&!$legacy['State']['Running'],'Only the reviewed stopped legacy container can be removed');check(is_file($directory.'/legacy-container-before.json'),'Legacy definition preimage missing');$template='/boot/config/plugins/dockerMan/templates-user/my-librespeed.xml';if(is_file($template)){privateFile($directory.'/legacy-unraid-template.xml',file_get_contents($template));check(unlink($template),'Legacy template retirement failed');}
$autostart='/boot/config/plugins/dockerMan/autostart';if(is_file($autostart)){$before=file_get_contents($autostart);if(!is_file($directory.'/autostart-before.txt'))privateFile($directory.'/autostart-before.txt',$before);$lines=array_filter(explode("\n",$before),fn($line)=>(preg_split('/\s+/',trim($line))[0]??'')!==$config['legacy_container']);check(file_put_contents($autostart,implode("\n",$lines))!==false,'Boot entry retirement failed');}run(['docker','rm',$config['legacy_container']]);check(is_dir('/mnt/user/appdata/librespeed'),'Legacy appdata must remain intact');echo json_encode(['legacyContainerRetired'=>true,'legacyTemplateArchived'=>true,'legacyAppdataRetained'=>true]).PHP_EOL;
`));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });