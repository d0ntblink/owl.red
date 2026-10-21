import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'prepare', 'stop', 'verify', 'rollback'].includes(phase), 'Use plan, prepare, stop, verify or rollback.');
if (phase === 'rollback') {
  const result = spawnSync('kubectl', ['-n', 'seerr', 'get', 'pods', '-l', 'app.kubernetes.io/name=seerr', '-o', 'json'], { encoding: 'utf8' });
  assert.ok(result.status === 0 && JSON.parse(result.stdout).items.length === 0, 'Pause the Fleet deployment and wait for all Seerr pods to stop before rollback.');
}
const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Seerr host migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
$phase='PHASE';$directory='/root/.local/state/owl-red/seerr-host-migration';$configFile='/mnt/user/appdata/seerr/settings.json';
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed: '.$args[0]);return trim($output);}
$container=json_decode(run(['docker','inspect','Seerr']),true)[0];$settings=json_decode(file_get_contents($configFile),true,512,JSON_THROW_ON_ERROR);$key=$settings['main']['apiKey'];$environment=[];foreach($container['Config']['Env'] as $entry){[$name,$value]=explode('=',$entry,2);$environment[$name]=$value;}
check($container['Image']==='sha256:c1673c6c7835e21540cacbf517abb7c4a80d2893b3484bec1b1a11212ac247fb'&&($environment['DB_TYPE']??'')==='postgres'&&($environment['DB_NAME']??'')==='seerr','Expected qualified PostgreSQL Seerr instance');
function api($endpoint,$route,$method='GET',$body=null){global $key;$request=curl_init($endpoint.'/api/v1'.$route);curl_setopt_array($request,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Api-Key: '.$key]]);if($body!==null)curl_setopt($request,CURLOPT_POSTFIELDS,json_encode($body,JSON_THROW_ON_ERROR));$output=curl_exec($request);$status=curl_getinfo($request,CURLINFO_HTTP_CODE);curl_close($request);check($output!==false&&$status>=200&&$status<300,'Native Seerr API failed (HTTP '.$status.'): '.$route);return $output?json_decode($output,true):null;}
function counts(){return json_decode(run(['docker','exec','postgresql','psql','-U','postgres','-d','seerr','-At','-c','SELECT json_build_object(\'users\',(SELECT count(*) FROM "user"),\'requests\',(SELECT count(*) FROM media_request))']),true);}
$old='http://10.0.10.5:5055';$new='https://seerr.owl.red';
if($phase==='plan'){echo json_encode(['oldRunning'=>$container['State']['Running'],'database'=>'postgres','ordinaryConfig'=>'NAS appdata/seerr','target'=>$new,'counts'=>counts(),'changed'=>false]).PHP_EOL;exit(0);}
if($phase==='prepare'){
 check($container['State']['Running'],'Old PostgreSQL instance must be running for native settings updates');
 if(!is_dir($directory))mkdir($directory,0700,true);if(!is_file($directory.'/settings-before.json')){file_put_contents($directory.'/settings-before.json',json_encode($settings));chmod($directory.'/settings-before.json',0600);file_put_contents($directory.'/container-before.json',json_encode($container));chmod($directory.'/container-before.json',0600);}
 foreach(['radarr'=>[0=>['radarr_fhd',7878],1=>['radarr_uhd',17878]],'sonarr'=>[0=>['sonarr_fhd',8989],1=>['sonarr_uhd',18989]]] as $kind=>$targets){$servers=api($old,'/settings/'.$kind);check(count($servers)===2,'Unexpected service count; stop for review');foreach($servers as $server){$target=$targets[$server['id']]??null;check($target&&in_array($server['hostname'],[$target[0],'nas.owl.red'],true),'Service host changed elsewhere');$server['hostname']='nas.owl.red';$server['port']=$target[1];api($old,'/settings/'.$kind.'/'.$server['id'],'PUT',$server);}}
 $tautulli=api($old,'/settings/tautulli');check(in_array($tautulli['hostname']??'',['tautulli','nas.owl.red'],true),'Tautulli host differs');$tautulli['hostname']='nas.owl.red';$tautulli['port']=8181;api($old,'/settings/tautulli','POST',$tautulli);
 $baseline=counts();$baseline['clientId']=$settings['clientId'];$baseline['sessionSecret']=$settings['sessionSecret'];file_put_contents($directory.'/baseline.json',json_encode($baseline));chmod($directory.'/baseline.json',0600);echo json_encode(['nativePeerUpdatesComplete'=>true,'existingCredentialsPreserved'=>true,'databaseCounts'=>$baseline['users'].' users / '.$baseline['requests'].' requests']).PHP_EOL;exit(0);
}
check(is_file($directory.'/baseline.json'),'Private migration baseline missing');
if($phase==='stop'){check($container['State']['Running'],'Original service already stopped; inspect state before retry');run(['docker','update','--restart','no','Seerr']);run(['docker','stop','--time','60','Seerr']);echo json_encode(['oldPostgresContainerStopped'=>true,'configAndDatabaseUnchanged'=>true]).PHP_EOL;exit(0);}
if($phase==='rollback'){
 if(!$container['State']['Running'])run(['docker','start','Seerr']);run(['curl','--fail','--silent','--retry','8','--retry-all-errors','--retry-max-time','60','--max-time','10',$old.'/api/v1/status']);$previous=json_decode(file_get_contents($directory.'/container-before.json'),true);run(['docker','update','--restart',$previous['HostConfig']['RestartPolicy']['Name'],'Seerr']);echo json_encode(['oldPostgresHostRestored'=>true,'databaseRevertedToSqlite'=>false]).PHP_EOL;exit(0);
}
if($phase==='verify'){
 check(!$container['State']['Running'],'Old NAS writer still running');$status=api($new,'/status');check(($status['version']??'')==='3.5.0','Application version changed');api($new,'/user?take=1');$baseline=json_decode(file_get_contents($directory.'/baseline.json'),true);$current=counts();check($current['users']===$baseline['users']&&$current['requests']>=$baseline['requests'],'Account/request state mismatch');$actual=json_decode(file_get_contents($configFile),true);check($actual['clientId']===$baseline['clientId']&&$actual['sessionSecret']===$baseline['sessionSecret'],'Application/session identity changed');foreach(['radarr','sonarr'] as $kind){$servers=api($new,'/settings/'.$kind);foreach($servers as $server)api($new,'/settings/'.$kind.'/test','POST',$server);}api($new,'/settings/tautulli','POST',api($new,'/settings/tautulli'));echo json_encode(['url'=>$new,'version'=>'3.5.0','existingApiKeyVerified'=>true,'users'=>$current['users'],'requests'=>$current['requests'],'peerConnectionsVerified'=>true,'nasConfigAndSessionIdentityPreserved'=>true,'oldNasWriterStopped'=>true]).PHP_EOL;
}
`;
const home = os.homedir();
const result = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], { input: php.replace('PHASE', phase), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
if (result.status !== 0) {
  const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/seerr-host-'));
  fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
  console.error('Seerr host migration failed; private diagnostics: ' + directory);
  process.exitCode = 1;
} else console.log(result.stdout.trim());