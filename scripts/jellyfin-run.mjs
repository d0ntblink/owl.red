import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'inspect';
assert(['inspect', 'deploy', 'configure', 'finish', 'template', 'qualify'].includes(phase), 'Use inspect, deploy, configure, finish, template or qualify.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/jellyfin.json'), 'utf8'));
const recovery = fs.mkdtempSync(path.join(os.homedir(), '.local/state/owl-red/jellyfin-'));
const request = { phase, config, template: fs.readFileSync(path.join(repository, 'unraid/templates/jellyfin.xml'), 'utf8'), approved: process.env.JELLYFIN_DEPLOY_ALLOWED === 'true' };
if (phase === 'configure' || phase === 'finish') {
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
	if (phase === 'finish') assert(item, 'Existing Jellyfin owner item required; no account reset.');
	if (!item) {
		item = JSON.parse(vault(['get', 'template', 'item']));
		Object.assign(item, { type: 1, name: 'Jellyfin Access', notes: 'Owner login for the separate owl.red Jellyfin instance. Plex credentials are unchanged.', login: { username: 'admin', password: randomBytes(30).toString('base64url'), totp: null, uris: [{ uri: config.webui, match: null }] } });
		item = JSON.parse(vault(['create', 'item'], Buffer.from(JSON.stringify(item)).toString('base64') + '\n'));
	}
	assert(item.login?.username && item.login?.password, 'Jellyfin vault login missing.');
	request.login = { username: item.login.username, password: item.login.password };
	fs.writeFileSync(path.join(recovery, 'configure-issued.json'), JSON.stringify({ vaultItemId: item.id, libraries: [], hardwareAcceleration: 'nvenc' }), { mode: 0o600, flag: 'wx' });
}
const code = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Jellyfin operation failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$config=$request['config'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed: '.$args[0]);return trim($output);}
function inspect($name){return json_decode(run(['docker','inspect',$name]),true,512,JSON_THROW_ON_ERROR)[0];}
function api($route,$method='GET',$body=null,$token=null){$handle=curl_init('http://10.0.10.5:8096'.$route);$authorization='MediaBrowser Client="owl.red", Device="controller", DeviceId="owl-red-provisioning", Version="1.0"';if($token!==null){check(is_string($token)&&$token!=='','Missing owner session token');$authorization.=', Token="'.$token.'"';}$headers=['Content-Type: application/json','Authorization: '.$authorization];curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>$headers]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Native Jellyfin API failed: '.parse_url($route,PHP_URL_PATH).' HTTP '.$status);return $output!==''?json_decode($output,true):null;}
$plex=inspect('plex');check($plex['State']['Running'],'Plex is not running; stop before adding GPU load');
$existing=run(['docker','ps','-a','--filter','name=^jellyfin$','--format','{{.ID}}']);
if($request['phase']==='inspect'){echo json_encode(['existingJellyfin'=>$existing!=='','plexRunning'=>true,'plexStarted'=>$plex['State']['StartedAt'],'gpu'=>$config['gpu']]);exit;}
check($request['approved'],'Explicit Jellyfin deployment approval required');
if($request['phase']==='template'){
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
 check($config['libraries']===[],'Unexpected media library configuration');
 $private='/root/.local/state/owl-red/jellyfin-'.gmdate('YmdTHis').'-'.bin2hex(random_bytes(3));check(mkdir($private,0700,true),'Private preimage directory failed');
 $template='/boot/config/plugins/dockerMan/templates-user/my-jellyfin.xml';
 if(file_exists($template)){check(copy($template,$private.'/template-before.xml'),'Template preimage failed');chmod($private.'/template-before.xml',0600);}
 file_put_contents($private.'/plex-before.json',json_encode(['id'=>$plex['Id'],'started'=>$plex['State']['StartedAt'],'image'=>$plex['Image']]));chmod($private.'/plex-before.json',0600);
 run(['docker','pull',$config['image']]);
 foreach([$config['config'],$config['cache']] as $directory){check(mkdir($directory,0770,true),'New data directory creation failed');check(chown($directory,$config['uid'])&&chgrp($directory,$config['gid'])&&chmod($directory,0770),'New directory ownership failed');}
 check(file_put_contents($template,$request['template'])!==false,'Template publication failed');chmod($template,0600);
 file_put_contents($private.'/create-issued.json',json_encode(['image'=>$config['image'],'gpu'=>$config['gpu'],'config'=>$config['config'],'libraries'=>[]]));chmod($private.'/create-issued.json',0600);
 run(['docker','run','-d','--name','jellyfin','--restart','unless-stopped','--stop-timeout','60','--runtime','nvidia','--gpus','device='.$config['gpu'],'--user',$config['uid'].':'.$config['gid'],'--cpus',(string)$config['cpus'],'--memory',$config['memory_mib'].'m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-opt','max-size=10m','--log-opt','max-file=3','--label','owl.red.component=jellyfin','--label','net.unraid.docker.webui='.$config['webui'],'--label','net.unraid.docker.icon='.$config['icon'],'-e','NVIDIA_VISIBLE_DEVICES='.$config['gpu'],'-e','NVIDIA_DRIVER_CAPABILITIES=compute,video,utility','-e','JELLYFIN_PublishedServerUrl='.$config['webui'],'-e','TZ=America/Edmonton','-v',$config['config'].':/config','-v',$config['cache'].':/cache','-p','10.0.10.5:'.$config['port'].':8096',$config['image']]);
 $live=inspect('jellyfin');$after=inspect('plex');check($after['Id']===$plex['Id']&&$after['State']['StartedAt']===$plex['State']['StartedAt'],'Plex continuity changed');
 check($live['HostConfig']['Runtime']==='nvidia','NVIDIA runtime missing');
 $media=array_values(array_filter($live['Mounts'],fn($mount)=>str_starts_with($mount['Destination'],'/media')));check(count($media)===0,'Unexpected media mount');
 echo json_encode(['running'=>$live['State']['Running'],'image'=>$config['image'],'mediaMounts'=>[],'gpu'=>$config['gpu'],'plexUnchanged'=>true,'remotePreimage'=>$private]);
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