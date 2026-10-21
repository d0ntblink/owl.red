import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'prepare', 'apply', 'verify', 'reset-target'].includes(phase), 'Use plan, prepare, apply, verify or reset-target.');
const home = os.homedir();
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/seerr-database-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Seerr database operation failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
const snapshotProgram = String.raw`
const fs = require('fs');
const sqlite = require('sqlite3');
const source = new sqlite.Database('/source/db.sqlite3', sqlite.OPEN_READONLY);
const backup = source.backup('/migration/source.sqlite');
backup.step(-1, error => {
  if (error) throw error;
  backup.finish(error => {
    if (error) throw error;
    source.close();
    const database = new sqlite.Database('/migration/source.sqlite', sqlite.OPEN_READONLY);
    const all = (sql, parameters = []) => new Promise((resolve, reject) => database.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows)));
    const quoted = name => '"' + name.replaceAll('"', '""') + '"';
    (async () => {
      const integrity = await all('PRAGMA quick_check');
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw Error('SQLite integrity failed');
      const tables = await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name");
      const counts = {};
      for (const { name } of tables) counts[name] = (await all('SELECT COUNT(*) AS count FROM ' + quoted(name)))[0].count;
      const columns = (await all('PRAGMA table_info("user")')).map(column => column.name);
      const fields = ['id', 'email', 'password', 'permissions', 'plexId', 'plexToken', 'jellyfinUserId', 'jellyfinAuthToken'].filter(field => columns.includes(field));
      const identities = await all('SELECT ' + fields.map(quoted).join(',') + ' FROM "user" ORDER BY id');
      fs.writeFileSync('/migration/source-summary.json', JSON.stringify({ counts, fields, identities }), { mode: 0o600 });
      database.close();
      console.log(JSON.stringify({ sqliteIntegrity: true, tableCount: tables.length, users: counts.user || 0 }));
    })().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
});
`;
const schemaProgram = String.raw`(async()=>{const database=require('/app/dist/datasource').default;await database.initialize();await database.runMigrations();await database.destroy();console.log('Native PostgreSQL schema initialized.');})().catch(error=>{console.error(error.message);process.exitCode=1;});`;
async function main() {
  let databaseUrl;
  if (['prepare', 'apply'].includes(phase)) {
    const stored = parseEnv(fs.readFileSync('/home/n0rth/owl.red/env.secret', 'utf8'));
    const worker = String.raw`const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');(async()=>{let text='';for await(const chunk of process.stdin)text+=chunk;const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(JSON.parse(text).token);const secret=await client.secrets().get('1c38f323-dfa6-4383-b634-b4ea0168353d');process.stdout.write(JSON.stringify({value:secret.value}));})().catch(()=>{process.stderr.write('Private database credential lookup failed');process.exitCode=1;});`;
    databaseUrl = JSON.parse(execute(process.execPath, ['-e', worker], { input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN }) })).value;
    const parsed = new URL(databaseUrl);
    assert.ok(parsed.username === 'seerr' && parsed.hostname === '10.0.10.5' && parsed.port === '15432' && parsed.pathname === '/seerr', 'Unexpected database target.');
  }
  const payload = { phase, databaseUrl, snapshotProgram, schemaProgram };
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),false,512,JSON_THROW_ON_ERROR);$phase=$request->phase;
$base='/mnt/ssd/appdata/seerr-postgres-migration';$image='ghcr.io/seerr-team/seerr@sha256:27602401178d54f1964442287b9f23f67a3fa2252645ee8065839ea1c3f69e45';$loader='ghcr.io/ralgar/pgloader@sha256:e5ae0b8149058828938d0f14ccc1f793171db8c4c8b69b7b6b45dfd998f0149f';
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args,$input='') {global $base;$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fwrite($pipes[0],$input);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);$status=proc_close($process);if($status!==0){if(is_dir($base)){file_put_contents($base.'/last-error.log',$output.$error);chmod($base.'/last-error.log',0600);}throw new RuntimeException('Native operation failed: '.$args[0]);}return trim($output);}
function inspect(){return json_decode(run(['docker','inspect','Seerr']),false,512,JSON_THROW_ON_ERROR)[0];}
function environment($container){$values=[];foreach($container->Config->Env as $entry){[$key,$value]=explode('=',$entry,2);$values[$key]=$value;}return $values;}
function sql($query){return run(['docker','exec','postgresql','psql','-U','postgres','-d','seerr','-v','ON_ERROR_STOP=1','-At','-c',$query]);}
function quoteName($name){return '"'.str_replace('"','""',$name).'"';}
function dockerApi($method,$path,$body=null){$handle=curl_init('http://localhost'.$path);curl_setopt_array($handle,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90]);if($body!==null)curl_setopt_array($handle,[CURLOPT_POSTFIELDS=>json_encode($body,JSON_THROW_ON_ERROR),CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);elseif($method==='POST')curl_setopt($handle,CURLOPT_POSTFIELDS,'');$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Docker API operation failed');return $output?json_decode($output):null;}
$container=inspect();check($container->Image==='sha256:c1673c6c7835e21540cacbf517abb7c4a80d2893b3484bec1b1a11212ac247fb','Existing Seerr image changed');$current=environment($container);
if($phase==='plan'){echo json_encode(['container'=>'Seerr','currentDatabase'=>$current['DB_TYPE']??'sqlite','targetDatabase'=>'seerr','targetServer'=>'nas.owl.red:15432','configRemainsOnNas'=>true,'changed'=>false]).PHP_EOL;exit(0);}
check(!file_exists($base)||is_file($base.'/.owl-red-seerr-postgres'),'Unmanaged migration directory');
if($phase==='reset-target'){
 check(($current['DB_TYPE']??'sqlite')==='sqlite'&&$container->State->Running&&is_file($base.'/qualified')&&is_file($base.'/schema-initialized'),'Original SQLite service and owned migration target required');
 check((int)sql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname='seerr' AND pid<>pg_backend_pid()")===0,'PostgreSQL target has another client');
 sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION seerr;');unlink($base.'/schema-initialized');unlink($base.'/qualified');
 echo json_encode(['isolatedTargetReset'=>true,'originalSqliteUntouched'=>true]).PHP_EOL;exit(0);
}
if(in_array($phase,['prepare','apply'],true)){
 check(($current['DB_TYPE']??'sqlite')!=='postgres','Already using PostgreSQL; re-import refused');
 if(!is_dir($base)){mkdir($base,0700,true);file_put_contents($base.'/.owl-red-seerr-postgres','seerr');}
 $connection=parse_url($request->databaseUrl);$values=['NODE_ENV'=>'production','DB_TYPE'=>'postgres','DB_HOST'=>'10.0.10.5','DB_PORT'=>'15432','DB_USER'=>'seerr','DB_NAME'=>'seerr','DB_PASS'=>rawurldecode($connection['pass']),'DB_POOL_SIZE'=>'2','DB_LOG_QUERIES'=>'false','CONFIG_DIRECTORY'=>'/app/config'];
 $lines=[];foreach($values as $key=>$value){check(!preg_match('/[\r\n]/',$value),'Multiline database value');$lines[]=$key.'='.$value;}file_put_contents($base.'/postgres.env',implode("\n",$lines)."\n");chmod($base.'/postgres.env',0600);
 $tables=(int)sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
 if(!is_file($base.'/schema-initialized')){check($tables===0,'Existing unowned database content; import refused');mkdir($base.'/schema-config',0700);run(['docker','run','--rm','--log-driver','none','--network','bridge','--user','0:100','--memory','1g','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges:true','--env-file',$base.'/postgres.env','-v',$base.'/schema-config:/app/config',$image,'node','-e',$request->schemaProgram]);file_put_contents($base.'/schema-initialized',$image);}
 if($phase==='apply'){check(is_file($base.'/qualified'),'Run prepare qualification before the final switch');file_put_contents($base.'/container-before.json',json_encode($container));chmod($base.'/container-before.json',0600);run(['docker','stop','--time','60','Seerr']);}
 try{
  if(is_file($base.'/source.sqlite'))rename($base.'/source.sqlite',$base.'/source-before-'.bin2hex(random_bytes(4)).'.sqlite');
  run(['docker','run','--rm','-i','--log-driver','none','--network','none','--user','0:100','--memory','512m','--cpus','1','--cap-drop','ALL','--security-opt','no-new-privileges:true','-v','/mnt/user/appdata/seerr/db:/source:ro','-v',$base.':/migration',$image,'node','-'],$request->snapshotProgram);
  $source=json_decode(file_get_contents($base.'/source-summary.json'),true,512,JSON_THROW_ON_ERROR);
  $names=array_keys($source['counts']);foreach($names as $name)check(preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/',$name),'Unexpected source table name');
  check((int)sql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname='seerr' AND pid<>pg_backend_pid()")===0,'Another Seerr PostgreSQL client is active; import refused');
  sql('TRUNCATE TABLE '.implode(',',array_map('quoteName',$names)).' RESTART IDENTITY CASCADE');
  $uri='postgresql://seerr:'.rawurlencode($values['DB_PASS']).'@10.0.10.5:15432/seerr';file_put_contents($base.'/migration.load','LOAD DATABASE FROM sqlite:///migration/source.sqlite INTO '.$uri.' WITH quote identifiers, data only, reset sequences EXCLUDING TABLE NAMES LIKE \'migrations\';');chmod($base.'/migration.load',0600);
  run(['docker','run','--rm','--log-driver','none','--network','bridge','--memory','1g','--cpus','2','--cap-drop','ALL','--security-opt','no-new-privileges:true','-v',$base.':/migration:ro',$loader,'pgloader','/migration/migration.load']);
  foreach($source['counts'] as $name=>$count)check((int)sql('SELECT COUNT(*) FROM '.quoteName($name))===$count,'Migrated table count differs: '.$name);
  $rows=json_decode(sql('SELECT COALESCE(json_agg(record),\'[]\'::json) FROM (SELECT '.implode(',',array_map('quoteName',$source['fields'])).' FROM "user" ORDER BY id) record'),true,512,JSON_THROW_ON_ERROR);check($rows===$source['identities'],'User account identities or credentials differ');
  file_put_contents($base.'/qualified',json_encode(['image'=>$image,'tableCount'=>count($source['counts']),'users'=>$source['counts']['user']??0]));
  echo json_encode(['conversionVerified'=>true,'tableCount'=>count($source['counts']),'users'=>$source['counts']['user']??0,'accountIdentitiesPreserved'=>true,'sourceStopped'=>$phase==='apply']).PHP_EOL;
 }catch(Throwable $error){if($phase==='apply')run(['docker','start','Seerr']);throw $error;}
 if($phase==='prepare')exit(0);
 $saved='Seerr-sqlite-rollback';check(run(['docker','ps','-a','--filter','name=^/'.$saved.'$','--format','{{.Names}}'])==='','Rollback container name occupied');$replacement=clone $container->Config;$replacement->Image=$image;$replacement->HostConfig=$container->HostConfig;$replacement->Env=[];$merged=array_merge($current,$values);foreach($merged as $key=>$value)$replacement->Env[]=$key.'='.$value;$created=false;
 try{dockerApi('POST','/containers/Seerr/rename?name='.$saved);dockerApi('POST','/containers/create?name=Seerr',$replacement);$created=true;dockerApi('POST','/containers/Seerr/start');}catch(Throwable $error){if($created){try{dockerApi('POST','/containers/Seerr/stop?t=10');}catch(Throwable $ignored){}dockerApi('DELETE','/containers/Seerr');}dockerApi('POST','/containers/'.$saved.'/rename?name=Seerr');run(['docker','start','Seerr']);throw $error;}
 echo json_encode(['postgresContainerStarted'=>true,'configAndPortsPreserved'=>true,'rollbackContainer'=>$saved]).PHP_EOL;
}
if($phase==='verify'){
 check(($current['DB_TYPE']??'')==='postgres'&&$container->State->Running,'Seerr PostgreSQL instance is not running');$settings=json_decode(file_get_contents('/mnt/user/appdata/seerr/settings.json'),true);$handle=curl_init('http://10.0.10.5:5055/api/v1/user?take=1');curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>15,CURLOPT_HTTPHEADER=>['X-Api-Key: '.$settings['main']['apiKey']]]);$output=curl_exec($handle);check($output!==false&&curl_getinfo($handle,CURLINFO_HTTP_CODE)===200,'Existing Seerr API identity failed');curl_close($handle);echo json_encode(['postgresInUse'=>true,'existingApiKeyVerified'=>true,'configRemainsOnNas'=>true,'userCount'=>(int)sql('SELECT COUNT(*) FROM "user"')]).PHP_EOL;
}
`;
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], { input: php.replace('REQUEST', Buffer.from(JSON.stringify(payload)).toString('base64')) }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });