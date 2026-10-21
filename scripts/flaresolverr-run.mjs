import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'apply', 'rollback', 'verify'].includes(phase), 'Use plan, apply, verify or rollback.');
process.umask(0o077);
const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
$phase='PHASE';
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native container operation failed');return trim($output);}
$paths=array_filter(array_merge(['/mnt/user/appdata/binhex-prowlarr/config.xml'],glob('/mnt/user/appdata/binhex-prowlarr/*/config.xml')),fn($file)=>is_file($file));check(count($paths)===1,'Unique Prowlarr configuration required');$configuration=simplexml_load_file(reset($paths));$key=(string)$configuration->ApiKey;
function request($url,$method='GET',$body=null,$headers=[]){$handle=curl_init($url);curl_setopt_array($handle,[CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>90,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_HTTPHEADER=>array_merge(['Content-Type: application/json'],$headers)]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body,JSON_THROW_ON_ERROR));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Application API failed (HTTP '.$status.'): '.$url);return $output?json_decode($output,true):null;}
function prowlarr($route,$method='GET',$body=null){global $key;return request('http://10.0.10.5:9696/api/v1'.$route,$method,$body,['X-Api-Key: '.$key]);}
function endpoint($proxy){foreach($proxy['fields'] as $field)if($field['name']==='host')return $field['value'];throw new RuntimeException('Proxy host field missing');}
$proxy=prowlarr('/indexerProxy/4');check(($proxy['implementation']??'')==='FlareSolverr','Unexpected proxy identity');$old='http://flaresolverr:8191';$new='http://flaresolverr.owl.red:8191';check(in_array(endpoint($proxy),[$old,$new],true),'Proxy endpoint was changed elsewhere');
$container=json_decode(run(['docker','inspect','flaresolverr']),true)[0];check($container['Image']==='sha256:ed7b6d5ab3ff3faa846e03ea54765d1b85089da5a04b81131f9a376fa34f7470','Existing NAS image changed; migration review required');
$directory='/root/.local/state/owl-red/flaresolverr-migration';$snapshot=$directory.'/proxy-before.json';
if($phase==='plan'){echo json_encode(['consumer'=>'prowlarr','proxyId'=>4,'currentHost'=>endpoint($proxy),'newHost'=>$new,'oldContainerRunning'=>$container['State']['Running'],'changed'=>false]).PHP_EOL;exit(0);}
if($phase==='rollback'){
 check(is_file($snapshot),'Private proxy preimage missing');if(!$container['State']['Running'])run(['docker','start','flaresolverr']);$previous=json_decode(file_get_contents($snapshot),true,512,JSON_THROW_ON_ERROR);prowlarr('/indexerProxy/4','PUT',$previous);run(['docker','update','--restart',$container['HostConfig']['RestartPolicy']['Name']==='no'?'unless-stopped':$container['HostConfig']['RestartPolicy']['Name'],'flaresolverr']);echo json_encode(['oldEndpointRestored'=>true,'dataDeleted'=>false]).PHP_EOL;exit(0);
}
$version=request($new.'/');check(($version['version']??'')==='3.5.2','New service version mismatch');
if($phase==='apply'){
 $session=request($new.'/v1','POST',['cmd'=>'sessions.create']);check(($session['status']??'')==='ok'&&!empty($session['session']),'Browser session creation failed');request($new.'/v1','POST',['cmd'=>'sessions.destroy','session'=>$session['session']]);
 if(!is_dir($directory))mkdir($directory,0700,true);
 if(!is_file($snapshot)){check(endpoint($proxy)===$old,'Cannot capture original proxy after external cutover');file_put_contents($snapshot,json_encode($proxy));chmod($snapshot,0600);file_put_contents($directory.'/container-before.json',json_encode($container));chmod($directory.'/container-before.json',0600);}
 foreach($proxy['fields'] as &$field)if($field['name']==='host')$field['value']=$new;unset($field);
 prowlarr('/indexerProxy/test','POST',$proxy);prowlarr('/indexerProxy/4','PUT',$proxy);check(endpoint(prowlarr('/indexerProxy/4'))===$new,'Proxy update did not persist');
 run(['docker','update','--restart','no','flaresolverr']);if($container['State']['Running'])run(['docker','stop','--time','30','flaresolverr']);
}
check(endpoint(prowlarr('/indexerProxy/4'))===$new,'Consumer is not using the Kubernetes service');$actual=json_decode(run(['docker','inspect','flaresolverr']),true)[0];check(!$actual['State']['Running'],'Old NAS service is still running');echo json_encode(['service'=>$new,'version'=>'3.5.2','consumer'=>'prowlarr','consumerUpdated'=>true,'oldNasContainerStopped'=>true,'oldFilesPreserved'=>true]).PHP_EOL;
`;
const home = os.homedir();
const result = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], { input: php.replace('PHASE', phase), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
if (result.status !== 0) {
  const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/flaresolverr-migration-'));
  fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
  console.error('Migration operation failed; private diagnostics: ' + directory);
  process.exitCode = 1;
} else console.log(result.stdout.trim());