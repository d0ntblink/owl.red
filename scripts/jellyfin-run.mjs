import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'inspect';
assert(['inspect', 'deploy', 'configure', 'finish', 'template', 'qualify', 'media-plan', 'media-apply', 'media-verify', 'scan-status'].includes(phase), 'Use inspect, deploy, configure, finish, template, qualify, scan-status or media-plan/media-apply/media-verify.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/jellyfin.json'), 'utf8'));
const recovery = fs.mkdtempSync(path.join(os.homedir(), '.local/state/owl-red/jellyfin-'));
const request = { phase, config, template: fs.readFileSync(path.join(repository, 'unraid/templates/jellyfin.xml'), 'utf8'), approved: process.env.JELLYFIN_DEPLOY_ALLOWED === 'true' };
if (phase === 'configure' || phase === 'finish' || phase === 'scan-status' || phase.startsWith('media-')) {
	assert(request.approved, 'Explicit Jellyfin configuration approval required.');
	const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
	const binary = path.join(os.homedir(), '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
	const environment = { ...process.env, BW_SECRET: stored.BW_SECRET, BITWARDENCLI_APPDATA_DIR: path.join(os.homedir(), '.local/state/owl-red/bitwarden-cli-2026.7.0') };
	const vault = (args, input) => {
		const result = spawnSync(binary, args, { input, env: environment, encoding: 'utf8' });
		assert.equal(result.status, 0, 'Private vault operation failed; output suppressed.');
		return result.stdout.trim();
	};
	environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
	vault(['sync']);
	const matches = JSON.parse(vault(['list', 'items', '--search', 'Jellyfin Access'])).filter(item => item.name === 'Jellyfin Access');
	assert(matches.length <= 1, 'Ambiguous existing Jellyfin vault items.');
	let item = matches[0];
	if (phase === 'finish' || phase === 'scan-status' || phase.startsWith('media-')) assert(item, 'Existing Jellyfin owner item required; no account reset.');
	if (!item) {
		item = JSON.parse(vault(['get', 'template', 'item']));
		Object.assign(item, { type: 1, name: 'Jellyfin Access', notes: 'Owner login for the separate owl.red Jellyfin instance. Plex credentials are unchanged.', login: { username: 'admin', password: randomBytes(30).toString('base64url'), totp: null, uris: [{ uri: config.webui, match: null }] } });
		item = JSON.parse(vault(['create', 'item'], Buffer.from(JSON.stringify(item)).toString('base64') + '\n'));
	}
	assert(item.login?.username && item.login?.password, 'Jellyfin vault login missing.');
	request.login = { username: item.login.username, password: item.login.password };
	fs.writeFileSync(path.join(recovery, 'owner-access.json'), JSON.stringify({ vaultItemId: item.id, phase, libraries: config.libraries, hardwareAcceleration: 'nvenc' }), { mode: 0o600, flag: 'wx' });
}
const code = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Jellyfin operation failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$config=$request['config'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed: '.$args[0]);return trim($output);}
function inspect($name){return json_decode(run(['docker','inspect',$name]),true,512,JSON_THROW_ON_ERROR)[0];}
function mediaMounts($config){$mounts=[];foreach($config['libraries'] as $library){check(in_array($library['type'],['movies','tvshows','music'],true),'Unsupported library type');foreach($library['paths'] as $path){check(str_starts_with($path,'/media/')&&!str_contains($path,'..')&&!str_contains($path,':'),'Unexpected library path');$source='/mnt/user'.$path;check(is_dir($source)&&!is_link($source),'Expected media directory missing or symlinked');$mounts[$path]=['Source'=>$source,'Destination'=>$path,'RW'=>false];}}ksort($mounts);return $mounts;}
function containerArguments($config){$args=['docker','run','-d','--name','jellyfin','--restart','unless-stopped','--stop-timeout','60','--runtime','nvidia','--gpus','device='.$config['gpu'],'--user',$config['uid'].':'.$config['gid'],'--cpus',(string)$config['cpus'],'--memory',$config['memory_mib'].'m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-opt','max-size=10m','--log-opt','max-file=3','--label','owl.red.component=jellyfin','--label','net.unraid.docker.webui='.$config['webui'],'--label','net.unraid.docker.icon='.$config['icon'],'-e','NVIDIA_VISIBLE_DEVICES='.$config['gpu'],'-e','NVIDIA_DRIVER_CAPABILITIES=compute,video,utility','-e','JELLYFIN_PublishedServerUrl='.$config['webui'],'-e','TZ=America/Edmonton','-v',$config['config'].':/config','-v',$config['cache'].':/cache'];foreach(mediaMounts($config) as $mount){$args[]='-v';$args[]=$mount['Source'].':'.$mount['Destination'].':ro';}$args[]='-p';$args[]='10.0.10.5:'.$config['port'].':8096';$args[]=$config['image'];return $args;}
function api($route,$method='GET',$body=null,$token=null){$handle=curl_init('http://10.0.10.5:8096'.$route);$authorization='MediaBrowser Client="owl.red", Device="controller", DeviceId="owl-red-provisioning", Version="1.0"';if($token!==null){check(is_string($token)&&$token!=='','Missing owner session token');$authorization.=', Token="'.$token.'"';}$headers=['Content-Type: application/json','Authorization: '.$authorization];curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>$headers]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Native Jellyfin API failed: '.parse_url($route,PHP_URL_PATH).' HTTP '.$status);return $output!==''?json_decode($output,true):null;}
$plex=inspect('plex');check($plex['State']['Running'],'Plex is not running; stop before adding GPU load');
$existing=run(['docker','ps','-a','--filter','name=^jellyfin$','--format','{{.ID}}']);
if($request['phase']==='inspect'){echo json_encode(['existingJellyfin'=>$existing!=='','plexRunning'=>true,'plexStarted'=>$plex['State']['StartedAt'],'gpu'=>$config['gpu']]);exit;}
check($request['approved'],'Explicit Jellyfin deployment approval required');
if($request['phase']==='scan-status'){
 $auth=api('/Users/AuthenticateByName','POST',['Username'=>$request['login']['username'],'Pw'=>$request['login']['password']]);$token=$auth['AccessToken'];check($auth['User']['Policy']['IsAdministrator'],'Owner is not administrator');
 $tasks=api('/ScheduledTasks','GET',null,$token);$active=array_values(array_filter($tasks,fn($task)=>$task['State']!=='Idle'||($task['Key']??'')==='RefreshLibrary'));$counts=api('/Items/Counts','GET',null,$token);$folders=api('/Library/VirtualFolders','GET',null,$token);$libraries=[];
 foreach($folders as $folder){$items=api('/Items?'.http_build_query(['ParentId'=>$folder['ItemId'],'Recursive'=>'true','Limit'=>0,'EnableTotalRecordCount'=>'true']),'GET',null,$token);$images=api('/Items/'.$folder['ItemId'].'/Images','GET',null,$token);$libraries[]=['name'=>$folder['Name'],'id'=>$folder['ItemId'],'indexedItems'=>$items['TotalRecordCount'],'locations'=>$folder['Locations'],'imageTypes'=>array_column($images,'ImageType'),'scanOptions'=>array_intersect_key($folder['LibraryOptions']??[],array_flip(['EnableRealtimeMonitor','SaveLocalMetadata','EnableChapterImageExtraction','EnableTrickplayImageExtraction','ExtractChapterImagesDuringLibraryScan','EnableAutomaticSeriesGrouping','MetadataSavers','TypeOptions']))];}
 api('/Sessions/Logout','POST',null,$token);echo json_encode(['observedAt'=>gmdate('c'),'tasks'=>$active,'counts'=>$counts,'libraries'=>$libraries]);exit;
}
if(str_starts_with($request['phase'],'media-')){
 check($existing!=='','Jellyfin container missing');$before=inspect('jellyfin');check($before['State']['Running']&&$before['Config']['Image']===$config['image'],'Unexpected Jellyfin runtime');
 $auth=api('/Users/AuthenticateByName','POST',['Username'=>$request['login']['username'],'Pw'=>$request['login']['password']]);$token=$auth['AccessToken'];check($auth['User']['Policy']['IsAdministrator'],'Owner is not administrator');
 $libraries=api('/Library/VirtualFolders','GET',null,$token);$expected=mediaMounts($config);$missing=[];
 foreach($config['libraries'] as $library){$matches=array_values(array_filter($libraries,fn($item)=>$item['Name']===$library['name']));check(count($matches)<=1,'Duplicate library name');if($matches){check($matches[0]['Locations']===$library['paths']&&$matches[0]['CollectionType']===$library['type'],'Conflicting existing library');}else{$missing[]=$library;}}
 $actual=[];foreach($before['Mounts'] as $mount)if(str_starts_with($mount['Destination'],'/media/'))$actual[$mount['Destination']]=array_intersect_key($mount,array_flip(['Source','Destination','RW']));ksort($actual);check(!$actual||$actual===$expected,'Existing media mount configuration differs; inspect before replacement');
 if($request['phase']==='media-plan'){api('/Sessions/Logout','POST',null,$token);echo json_encode(['libraries'=>$config['libraries'],'missingLibraries'=>count($missing),'recreateRequired'=>$actual!==$expected,'readOnlyMounts'=>array_values($expected),'plexUnchanged'=>true]);exit;}
 if($request['phase']==='media-apply'){
  $private='/root/.local/state/owl-red/jellyfin-media-'.bin2hex(random_bytes(6));check(mkdir($private,0700,true),'Private media preimage directory failed');foreach(['container-before.json'=>$before,'libraries-before.json'=>$libraries] as $file=>$value){file_put_contents($private.'/'.$file,json_encode($value));chmod($private.'/'.$file,0600);}
	if($actual!==$expected){check(!$actual,'Refusing to replace nonempty unexpected media mounts');$bindings=$before['HostConfig']['PortBindings']['8096/tcp'];check(count($bindings)===1&&$bindings[0]['HostIp']==='10.0.10.5'&&$bindings[0]['HostPort']==='8096','Unexpected backend binding');api('/Sessions/Logout','POST',null,$token);file_put_contents($private.'/recreate-issued.json',json_encode(['expectedMounts'=>$expected,'image'=>$config['image']]));chmod($private.'/recreate-issued.json',0600);run(['docker','stop','--time','60','jellyfin']);check(inspect('jellyfin')['Id']===$before['Id'],'Container identity drift');run(['docker','rm','jellyfin']);run(containerArguments($config));$recreated=inspect('jellyfin');$verifiedMounts=[];foreach($recreated['Mounts'] as $mount)if(str_starts_with($mount['Destination'],'/media/'))$verifiedMounts[$mount['Destination']]=array_intersect_key($mount,array_flip(['Source','Destination','RW']));ksort($verifiedMounts);check($verifiedMounts===$expected&&$recreated['State']['Running']&&$recreated['HostConfig']['Runtime']==='nvidia','Recreated media/runtime verification failed');$afterPlex=inspect('plex');check($afterPlex['Id']===$plex['Id']&&$afterPlex['State']['StartedAt']===$plex['State']['StartedAt'],'Plex continuity changed');echo json_encode(['mediaMountsAdded'=>count($expected),'recreated'=>true,'librarySetupPending'=>true,'plexUnchanged'=>true,'remotePreimage'=>$private]);exit;}
  foreach($missing as $library){$marker=$private.'/library-'.hash('sha256',$library['name']).'-issued.json';file_put_contents($marker,json_encode($library));chmod($marker,0600);api('/Library/VirtualFolders?'.http_build_query(['name'=>$library['name'],'collectionType'=>$library['type'],'paths'=>implode(',',$library['paths']),'refreshLibrary'=>'false']),'POST',['LibraryOptions'=>['EnableRealtimeMonitor'=>true,'SaveLocalMetadata'=>false]],$token);}
 }
 $saved=api('/Library/VirtualFolders','GET',null,$token);foreach($config['libraries'] as $library){$matches=array_values(array_filter($saved,fn($item)=>$item['Name']===$library['name']));check(count($matches)===1&&$matches[0]['Locations']===$library['paths']&&$matches[0]['CollectionType']===$library['type'],'Saved library verification failed');foreach($library['paths'] as $path)run(['docker','exec','jellyfin','sh','-c','test -r "$1" && test -x "$1"','sh',$path]);}
 check($actual===$expected,'Expected media mounts not installed');$afterPlex=inspect('plex');check($afterPlex['Id']===$plex['Id']&&$afterPlex['State']['StartedAt']===$plex['State']['StartedAt'],'Plex continuity changed');api('/Sessions/Logout','POST',null,$token);echo json_encode(['verifiedLibraries'=>count($config['libraries']),'readOnlyMediaMounts'=>count($expected),'preservedOtherLibraries'=>count($saved)-count($config['libraries']),'plexUnchanged'=>true,'scanStarted'=>false]);
}elseif($request['phase']==='template'){
 check($existing!=='','Jellyfin container missing');$live=inspect('jellyfin');
 check($live['Config']['Image']===$config['image'],'Unexpected running Jellyfin image');
 $binding=$live['HostConfig']['PortBindings']['8096/tcp'];check(count($binding)===1&&$binding[0]['HostIp']==='10.0.10.5'&&$binding[0]['HostPort']==='8096','Unexpected backend port binding');
 $template='/boot/config/plugins/dockerMan/templates-user/my-jellyfin.xml';$xml=simplexml_load_file($template);check((string)$xml->Repository===$config['image']&&(string)$xml->WebUI===$config['webui'],'Existing template ownership drift');
 $private='/root/.local/state/owl-red/jellyfin-template-'.bin2hex(random_bytes(6));check(mkdir($private,0700,true),'Private template preimage directory failed');check(copy($template,$private.'/before.xml'),'Template preimage failed');chmod($private.'/before.xml',0600);
 check(file_put_contents($template,$request['template'])!==false,'Template publication failed');chmod($template,0600);check(file_get_contents($template)===$request['template'],'Template verification failed');
 echo json_encode(['templateUpdated'=>true,'runningContainerUnchanged'=>true,'nasOnlyBinding'=>true,'remotePreimage'=>$private]);
}elseif(in_array($request['phase'],['configure','finish'],true)){
 check($existing!=='','Jellyfin container missing');$status=api('/System/Info/Public');
 if($request['phase']==='configure'){
 check(!$status['StartupWizardCompleted'],'Already initialized; refusing account reset');
 api('/Startup/Configuration','POST',['ServerName'=>'Owl.red Jellyfin','UICulture'=>'en-US','MetadataCountryCode'=>'CA','PreferredMetadataLanguage'=>'en']);
 api('/Startup/User','POST',['Name'=>$request['login']['username'],'Password'=>$request['login']['password']]);
 api('/Startup/RemoteAccess','POST',['EnableRemoteAccess'=>true,'EnableAutomaticPortMapping'=>false]);
 api('/Startup/Complete','POST');
 }else{check($status['StartupWizardCompleted'],'Expected completed owner setup before finish');}
 $auth=api('/Users/AuthenticateByName','POST',['Username'=>$request['login']['username'],'Pw'=>$request['login']['password']]);$token=$auth['AccessToken'];check($auth['User']['Policy']['IsAdministrator'],'New owner is not administrator');
 $encoding=api('/System/Configuration/encoding','GET',null,$token);$encoding['HardwareAccelerationType']='nvenc';$encoding['EnableHardwareEncoding']=true;$encoding['HardwareDecodingCodecs']=['h264','hevc','mpeg2video','vc1'];$encoding['EnableEnhancedNvdecDecoder']=true;$encoding['EnableHevcEncoding']=false;$encoding['EnableAv1Encoding']=false;$encoding['TranscodingTempPath']='/cache/transcodes';
 api('/System/Configuration/encoding','POST',$encoding,$token);
 $network=api('/System/Configuration/network','GET',null,$token);$network['EnableUPnP']=false;api('/System/Configuration/network','POST',$network,$token);
 $libraries=api('/Library/VirtualFolders','GET',null,$token);check(count($libraries)===0,'Unexpected existing libraries');
 $saved=api('/System/Configuration/encoding','GET',null,$token);check($saved['HardwareAccelerationType']==='nvenc'&&$saved['EnableHardwareEncoding'],'NVENC setting not saved');
 $after=inspect('plex');check($after['Id']===$plex['Id']&&$after['State']['StartedAt']===$plex['State']['StartedAt'],'Plex continuity changed');
 api('/Sessions/Logout','POST',null,$token);
 echo json_encode(['startupCompleted'=>true,'ownerLoginVerified'=>true,'vaultItem'=>'Jellyfin Access','libraries'=>[],'hardwareAcceleration'=>'nvenc','automaticPortMapping'=>false,'plexUnchanged'=>true]);
}elseif($request['phase']==='deploy'){
 check($existing==='','Existing Jellyfin container; inspect instead of replacing');
 check(!file_exists(dirname($config['config'])),'New SSD profile already exists');
 mediaMounts($config);
 $private='/root/.local/state/owl-red/jellyfin-'.gmdate('YmdTHis').'-'.bin2hex(random_bytes(3));check(mkdir($private,0700,true),'Private preimage directory failed');
 $template='/boot/config/plugins/dockerMan/templates-user/my-jellyfin.xml';
 if(file_exists($template)){check(copy($template,$private.'/template-before.xml'),'Template preimage failed');chmod($private.'/template-before.xml',0600);}
 file_put_contents($private.'/plex-before.json',json_encode(['id'=>$plex['Id'],'started'=>$plex['State']['StartedAt'],'image'=>$plex['Image']]));chmod($private.'/plex-before.json',0600);
 run(['docker','pull',$config['image']]);
 foreach([$config['config'],$config['cache']] as $directory){check(mkdir($directory,0770,true),'New data directory creation failed');check(chown($directory,$config['uid'])&&chgrp($directory,$config['gid'])&&chmod($directory,0770),'New directory ownership failed');}
 check(file_put_contents($template,$request['template'])!==false,'Template publication failed');chmod($template,0600);
 file_put_contents($private.'/create-issued.json',json_encode(['image'=>$config['image'],'gpu'=>$config['gpu'],'config'=>$config['config'],'libraries'=>$config['libraries']]));chmod($private.'/create-issued.json',0600);
 run(containerArguments($config));
 $live=inspect('jellyfin');$after=inspect('plex');check($after['Id']===$plex['Id']&&$after['State']['StartedAt']===$plex['State']['StartedAt'],'Plex continuity changed');
 check($live['HostConfig']['Runtime']==='nvidia','NVIDIA runtime missing');
 $media=array_values(array_filter($live['Mounts'],fn($mount)=>str_starts_with($mount['Destination'],'/media')));check(count($media)===count(mediaMounts($config)),'Unexpected media mount count');
 echo json_encode(['running'=>$live['State']['Running'],'image'=>$config['image'],'mediaMounts'=>count($media),'gpu'=>$config['gpu'],'plexUnchanged'=>true,'remotePreimage'=>$private]);
}else{
 check($existing!=='','Jellyfin is not deployed');$live=inspect('jellyfin');check($live['State']['Running'],'Jellyfin is not running');
 run(['docker','exec','jellyfin','nvidia-smi','--query-gpu=uuid','--format=csv,noheader']);
 run(['docker','exec','jellyfin','/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1280x720:rate=30','-t','1','-c:v','h264_nvenc','-f','null','-']);
 $after=inspect('plex');check($after['Id']===$plex['Id']&&$after['State']['StartedAt']===$plex['State']['StartedAt'],'Plex changed during qualification');
 echo json_encode(['nvencSyntheticTest'=>true,'plexUnchanged'=>true]);
}
`.replace('REQUEST', Buffer.from(JSON.stringify(request)).toString('base64'));
const result = spawnSync('ssh', ['-T', '-i', path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], { input: code, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(recovery, 'result.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
assert.equal(result.status, 0, 'Jellyfin operation failed; private diagnostics: ' + recovery);
console.log(result.stdout.trim());