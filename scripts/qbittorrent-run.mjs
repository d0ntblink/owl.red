import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'prepare', 'apply', 'configure', 'metadata', 'repair-integration', 'verify', 'rollback', 'isolation'].includes(phase), 'Use plan, prepare, apply, configure, metadata, verify, isolation or rollback.');
process.umask(0o077);
const configuration = JSON.parse(fs.readFileSync(new URL('../ansible/vars/qbittorrent.json', import.meta.url), 'utf8'));
for (const image of [configuration.image, configuration.gateway_image]) assert.match(image, /@sha256:[a-f0-9]{64}$/);
if (!['plan', 'verify', 'isolation'].includes(phase)) {
  const deployment = spawnSync('kubectl', ['-n', 'qbittorrent', 'get', 'deployment', 'qbittorrent', '--ignore-not-found', '-o', 'json'], { encoding: 'utf8' });
  const pods = spawnSync('kubectl', ['-n', 'qbittorrent', 'get', 'pods', '-l', 'app.kubernetes.io/name=qbittorrent', '-o', 'json'], { encoding: 'utf8' });
  assert.ok(deployment.status === 0 && pods.status === 0, 'Cluster state must be available before mutating the NAS fallback.');
  assert.ok((!deployment.stdout.trim() || JSON.parse(deployment.stdout).spec.replicas === 0) && JSON.parse(pods.stdout).items.length === 0, 'Pause Fleet and remove cluster application pods before starting or mutating the NAS fallback.');
}
const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
$phase='PHASE';$configuration=json_decode(base64_decode('CONFIG_BASE64'),true,512,JSON_THROW_ON_ERROR);
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native container operation failed');return trim($output);}
function docker($route,$method='GET',$body=null){$handle=curl_init('http://localhost/v1.45'.$route);curl_setopt_array($handle,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_TIMEOUT=>180,CURLOPT_HTTPHEADER=>['Content-Type: application/json']]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body,JSON_THROW_ON_ERROR));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Docker API failed: '.$method.' '.$route.' (HTTP '.$status.')');return $output!==''?json_decode($output):null;}
function inspect($name){global $configuration;$all=docker('/containers/json?all=true');foreach($all as $container)if(in_array('/'.$name,$container->Names,true))return docker('/containers/'.$container->Id.'/json');return null;}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private state write failed');check(chmod($file,0600),'Private state permissions failed');}
function api($container,$route,$method='GET',$body=null){$args=['docker','exec',$container,'curl','--fail','--silent','--max-time','15','-X',$method];if($body!==null)array_push($args,'--data-urlencode','json='.json_encode($body,JSON_THROW_ON_ERROR));$args[]='http://127.0.0.1:8080/api/v2'.$route;$output=run($args);if($route==='/app/version')return $output;return $output!==''?json_decode($output,true,512,JSON_THROW_ON_ERROR):null;}
function identity($container){$torrents=api($container,'/torrents/info');$identity=[];foreach($torrents as $torrent)$identity[$torrent['hash']]=array_intersect_key($torrent,array_flip(['save_path','category','tags','name','size']));ksort($identity);return ['torrents'=>$identity,'categories'=>api($container,'/torrents/categories'),'preferences'=>api($container,'/app/preferences')];}
function authentication($profile){$values=[];foreach(file($profile,FILE_IGNORE_NEW_LINES) as $line)if(preg_match('/^(Username|Password[^=]*)=|^WebUI\\\\(Username|Password[^=]*)=/',$line))$values[]=$line;sort($values);check(count($values)>=2,'Existing username and password hash required');return hash('sha256',implode("\n",$values));}
function ensureOwned($name){$container=inspect($name);if($container!==null)check(($container->Config->Labels->{'owl.red.migration'}??'')==='qbittorrent-gluetun','Refusing an unowned replacement container');return $container;}
function forwardingEnvironment(){return ['VPN_PORT_FORWARDING_UP_COMMAND=/bin/sh -c \'wget -qO /dev/null --retry-connrefused --tries=30 --waitretry=1 --timeout=2 --post-data "json={\\"listen_port\\":{{PORT}},\\"current_network_interface\\":\\"{{VPN_INTERFACE}}\\",\\"current_interface_address\\":\\"\\",\\"random_port\\":false,\\"upnp\\":false}" http://127.0.0.1:8080/api/v2/app/setPreferences\'','VPN_PORT_FORWARDING_DOWN_COMMAND=/bin/sh -c \'wget -qO /dev/null --timeout=3 --post-data "json={\\"listen_port\\":0,\\"current_network_interface\\":\\"lo\\"}" http://127.0.0.1:8080/api/v2/app/setPreferences\''];}
$directory=$configuration['private_directory'];$root=$configuration['config_directory'];$profile=$root.'/qBittorrent/config/qBittorrent.conf';
$source=inspect($configuration['source_container'])??inspect($configuration['rollback_container']);check($source!==null,'Original container missing');check($source->Image===$configuration['source_image_id'],'Original image changed; review required');
if($phase==='metadata'){
 check(!$source->State->Running,'Original must remain stopped');$templateDirectory='/boot/config/plugins/dockerMan/templates-user';check(is_dir($templateDirectory),'Native Unraid template directory missing');
 foreach([$configuration['gateway_container'],$configuration['container']] as $name){
  $actual=ensureOwned($name);check($actual!==null&&$actual->State->Running,'Owned live replacement required');$gateway=$name===$configuration['gateway_container'];$file=$templateDirectory.'/my-'.$name.'.xml';
  if(is_file($file)){check(is_file($directory.'/my-'.$name.'.xml')||str_contains(file_get_contents($file),'owl.red.migration=qbittorrent-gluetun'),'Unmanaged target template exists');if(!is_file($directory.'/my-'.$name.'.xml'))privateFile($directory.'/my-'.$name.'.xml',file_get_contents($file));}
  $xml=new SimpleXMLElement('<Container version="2"/>');
  $fields=['Name'=>$name,'Repository'=>$actual->Config->Image,'Registry'=>'https://hub.docker.com/r/'.($gateway?'qmcgaw/gluetun':'binhex/arch-qbittorrent'),'Network'=>$gateway?$configuration['network']:'container:'.$configuration['gateway_container'],'Shell'=>$gateway?'sh':'bash','Privileged'=>'false','WebUI'=>$gateway?'':$configuration['webui'],'Icon'=>$actual->Config->Labels->{'net.unraid.docker.icon'},'ExtraParams'=>'--restart=unless-stopped --label owl.red.migration=qbittorrent-gluetun '.($gateway?'--cap-add=NET_ADMIN --device=/dev/net/tun --network-alias=qbittorrent --network-alias=qbittorrentvpn':'--stop-timeout=120')];
  foreach($fields as $key=>$value){$child=$xml->addChild($key);$child[0]=$value;}
  $add=function($name,$target,$type,$mode,$value)use($xml){$entry=$xml->addChild('Config');foreach(['Name'=>$name,'Target'=>$target,'Default'=>$value,'Mode'=>$mode,'Description'=>$name,'Type'=>$type,'Display'=>'always','Required'=>'true','Mask'=>'false'] as $key=>$attribute)$entry->addAttribute($key,$attribute);$entry[0]=$value;};
  foreach($actual->HostConfig->Binds as $bind){$parts=explode(':',$bind);$add($parts[1],$parts[1],'Path',$parts[2]??'rw',$parts[0]);}
  foreach($actual->Config->Env as $entry){[$key,$value]=explode('=',$entry,2);if($gateway?preg_match('/^(VPN_|HTTP_CONTROL_SERVER_|FIREWALL_INPUT_PORTS$|HTTPPROXY$|SHADOWSOCKS$)/',$key):in_array($key,['PUID','PGID','UMASK','TZ','WEBUI_PORT','GLUETUN_INCOMING_PORT','DEBUG','ENABLE_STARTUP_SCRIPTS'],true))$add($key,$key,'Variable','',$value);}
  if($gateway)foreach($actual->HostConfig->PortBindings as $port=>$mappings){[$target,$protocol]=explode('/',$port);foreach($mappings as $mapping)$add($port,$target,'Port',$protocol,$mapping->HostPort);}
  check($xml->asXML($file)!==false,'Native template write failed');check(simplexml_load_file($file)!==false,'Native template validation failed');
 }
 $old=$templateDirectory.'/my-'.$configuration['source_container'].'.xml';if(is_file($old)){if(!is_file($directory.'/original-unraid-template.xml'))privateFile($directory.'/original-unraid-template.xml',file_get_contents($old));check(unlink($old),'Old template retirement failed');}
 echo json_encode(['nativeUnraidTemplatesUpdated'=>true,'obsoleteBundledTemplateArchivedPrivately'=>true,'qBittorrentWebui'=>$configuration['webui'],'gatewayWebui'=>false,'dataDeleted'=>false]).PHP_EOL;exit(0);
}
if($phase==='repair-integration'){
 $current=ensureOwned($configuration['container']);$gateway=ensureOwned($configuration['gateway_container']);
 if($current===null&&$gateway!==null&&$gateway->State->Status==='created'&&is_file($directory.'/replacement-before-repair.json')){
  check(!$source->State->Running,'Original writer must remain stopped');$saved=json_decode(file_get_contents($directory.'/replacement-before-repair.json'));$clientConfig=$saved->current->Config;$clientConfig->HostConfig=$saved->current->HostConfig;$clientConfig->HostConfig->NetworkMode='container:'.$configuration['gateway_container'];unset($clientConfig->Hostname,$clientConfig->Domainname);$clientConfig->Env=array_map(fn($entry)=>str_starts_with($entry,'GLUETUN_INCOMING_PORT=')?'GLUETUN_INCOMING_PORT=no':$entry,$clientConfig->Env);
  docker('/containers/create?name='.$configuration['container'],'POST',$clientConfig);docker('/containers/'.$configuration['gateway_container'].'/start','POST');docker('/containers/'.$configuration['container'].'/start','POST');echo json_encode(['repairResumed'=>true,'nativeGluetunHooks'=>true,'dataDeleted'=>false,'verificationRequired'=>true]).PHP_EOL;exit(0);
 }
 check($current!==null&&$gateway!==null&&!$source->State->Running,'Owned replacements and stopped original required');
 privateFile($directory.'/replacement-before-repair.json',json_encode(['current'=>$current,'gateway'=>$gateway],JSON_THROW_ON_ERROR));
 if($current->State->Running)docker('/containers/'.$current->Id.'/stop?t=120','POST');
 if($gateway->State->Running)docker('/containers/'.$gateway->Id.'/stop?t=30','POST');
 $baseline=json_decode(file_get_contents($directory.'/baseline.json'),true,512,JSON_THROW_ON_ERROR);
 $clean=preg_replace('/^WebUI\\\\(?:Username|Password[^=]*)=.*\R?/m','',file_get_contents($profile));check(file_put_contents($profile,$clean)!==false,'Legacy field cleanup failed');check(authentication($profile)===$baseline['authentication'],'Original auth fields must remain unchanged');
 $clientConfig=$current->Config;$clientConfig->HostConfig=$current->HostConfig;$clientConfig->HostConfig->NetworkMode='container:'.$configuration['gateway_container'];unset($clientConfig->Hostname,$clientConfig->Domainname);$clientConfig->Env=array_map(fn($entry)=>str_starts_with($entry,'GLUETUN_INCOMING_PORT=')?'GLUETUN_INCOMING_PORT=no':$entry,$clientConfig->Env);
 $gatewayConfig=$gateway->Config;$gatewayConfig->HostConfig=$gateway->HostConfig;$gatewayConfig->Env=array_values(array_filter($gatewayConfig->Env,fn($entry)=>!str_starts_with($entry,'VPN_PORT_FORWARDING_UP_COMMAND=')&&!str_starts_with($entry,'VPN_PORT_FORWARDING_DOWN_COMMAND=')));$gatewayConfig->Env=array_merge($gatewayConfig->Env,forwardingEnvironment());
 $endpoints=new stdClass();$endpoints->{$configuration['network']}=['Aliases'=>[$configuration['container'],$configuration['source_container']]];$gatewayConfig->NetworkingConfig=['EndpointsConfig'=>$endpoints];
 docker('/containers/'.$current->Id,'DELETE');docker('/containers/'.$gateway->Id,'DELETE');
 docker('/containers/create?name='.$configuration['gateway_container'],'POST',$gatewayConfig);docker('/containers/create?name='.$configuration['container'],'POST',$clientConfig);
 docker('/containers/'.$configuration['gateway_container'].'/start','POST');docker('/containers/'.$configuration['container'].'/start','POST');
 echo json_encode(['nativeGluetunHooks'=>true,'legacyUpdaterDisabled'=>true,'originalAuthenticationRestored'=>true,'dataDeleted'=>false,'verificationRequired'=>true]).PHP_EOL;exit(0);
}
if($phase==='configure'){
 $current=ensureOwned($configuration['container']);$gateway=ensureOwned($configuration['gateway_container']);check($current!==null&&$gateway!==null&&$current->State->Running&&$gateway->State->Running&&!$source->State->Running,'Replacement-only running state required');
 api($configuration['container'],'/app/setPreferences','POST',['current_network_interface'=>'wg0','current_interface_address'=>'','upnp'=>false,'random_port'=>false]);
 echo json_encode(['boundToWireGuard'=>api($configuration['container'],'/app/preferences')['current_network_interface']==='wg0','upnpDisabled'=>true,'otherSettingsUnchanged'=>true]).PHP_EOL;exit(0);
}
if($phase==='rollback'){
 $current=ensureOwned($configuration['container']);$gateway=ensureOwned($configuration['gateway_container']);
 if($current!==null&&$current->State->Running)docker('/containers/'.$current->Id.'/stop?t=120','POST');
 if($gateway!==null&&$gateway->State->Running)docker('/containers/'.$gateway->Id.'/stop?t=30','POST');
 if($current!==null)docker('/containers/'.$current->Id.'/json');
 if($source->Name==='/'.$configuration['rollback_container'])docker('/containers/'.$source->Id.'/rename?name='.$configuration['source_container'],'POST');
 check(is_file($directory.'/container-before.json'),'Original container preimage required');$before=json_decode(file_get_contents($directory.'/container-before.json'));
 docker('/containers/'.$source->Id.'/update','POST',['RestartPolicy'=>$before->HostConfig->RestartPolicy]);
 if(!$source->State->Running)docker('/containers/'.$source->Id.'/start','POST');
 echo json_encode(['originalContainerStarted'=>true,'replacementContainersStopped'=>true,'currentTorrentStateRetained'=>true,'dataDeleted'=>false]).PHP_EOL;exit(0);
}
if(in_array($phase,['verify','isolation'],true)){
 $current=ensureOwned($configuration['container']);$gateway=ensureOwned($configuration['gateway_container']);check($current!==null&&$gateway!==null&&$current->State->Running&&$gateway->State->Running,'Both replacements must be running');check(!$source->State->Running,'Old writer is still running');
 check($current->HostConfig->NetworkMode==='container:'.$gateway->Id||$current->HostConfig->NetworkMode==='container:'.$configuration['gateway_container'],'qBittorrent must share the gateway network');check(!$current->HostConfig->Privileged&&empty($current->HostConfig->CapAdd),'qBittorrent has unexpected elevated capabilities');check(!$gateway->HostConfig->Privileged,'Gateway must not be privileged');
 $baseline=json_decode(file_get_contents($directory.'/baseline.json'),true,512,JSON_THROW_ON_ERROR);$actual=identity($configuration['container']);check($actual['torrents']===$baseline['torrents'],'Torrent identities, paths or categories changed');check($actual['categories']===$baseline['categories'],'Saved categories changed');check(authentication($profile)===$baseline['authentication'],'WebUI authentication changed');
 foreach(['save_path','temp_path','temp_path_enabled','auto_tmm_enabled','queueing_enabled','dl_limit','up_limit','max_ratio','max_seeding_time','web_ui_username','bypass_local_auth','proxy_type'] as $key)check(($actual['preferences'][$key]??null)===($baseline['preferences'][$key]??null),'Saved preference changed: '.$key);
 check(api($configuration['container'],'/app/version')===$configuration['version'],'Application version changed');
 $port=(int)run(['docker','exec',$configuration['gateway_container'],'cat','/tmp/gluetun/forwarded_port']);check($port>0&&$port===$actual['preferences']['listen_port'],'Forwarded port does not match qBittorrent');
 check(($actual['preferences']['current_network_interface']??'')==='wg0','qBittorrent must bind to the WireGuard interface');
 $dns=run(['docker','exec',$configuration['container'],'cat','/etc/resolv.conf']);check(preg_match('/^nameserver 127\.0\.0\.1$/m',$dns)===1,'Application DNS must use Gluetun, not the host resolver');
 $routes=run(['docker','exec',$configuration['container'],'ip','route','get','1.1.1.1']);check(str_contains($routes,'dev wg0'),'Internet route bypasses WireGuard');
 if($phase==='isolation'){
  $stopped=false;
  try{
   run(['docker','exec',$configuration['container'],'curl','--fail','--silent','--max-time','15','-X','PUT','-H','Content-Type: application/json','-d','{"status":"stopped"}','http://127.0.0.1:8000/v1/vpn/status']);$stopped=true;
   $process=proc_open(['docker','exec',$configuration['container'],'curl','--fail','--silent','--noproxy','*','--connect-timeout','3','--max-time','5','https://1.1.1.1/cdn-cgi/trace'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)!==0,'VPN-down internet leak detected');
  }finally{if($stopped)run(['docker','exec',$configuration['container'],'curl','--fail','--silent','--max-time','15','-X','PUT','-H','Content-Type: application/json','-d','{"status":"running"}','http://127.0.0.1:8000/v1/vpn/status']);}
  echo json_encode(['vpnDownInternetBlocked'=>true,'vpnRestartRequested'=>true,'torrentsPreserved'=>count($actual['torrents'])]).PHP_EOL;exit(0);
 }
 $external=run(['docker','exec',$configuration['container'],'curl','--fail','--silent','--max-time','20','https://api.ipify.org']);check(filter_var($external,FILTER_VALIDATE_IP)!==false,'VPN internet check failed');
 check(!isset($gateway->HostConfig->PortBindings->{'8118/tcp'})&&!isset($gateway->HostConfig->PortBindings->{'9118/tcp'}),'Proxy ports must not be exposed');
 echo json_encode(['qBittorrent'=>$configuration['version'],'torrentsPreserved'=>count($actual['torrents']),'categoriesAndAuthenticationPreserved'=>true,'vpnRoute'=>'wg0','forwardedPortSynchronized'=>true,'dnsThroughGateway'=>true,'qBittorrentPrivileged'=>false,'oldWriterStopped'=>true,'privoxyEnabled'=>false,'webui'=>$configuration['webui']]).PHP_EOL;exit(0);
}
$container=json_decode(json_encode($source),true,512,JSON_THROW_ON_ERROR);
$roots=array_values(array_filter($container['Mounts'],fn($mount)=>$mount['Destination']==='/config'));
check(count($roots)===1,'Unique existing config mount required');$root=$roots[0]['Source'];
$profiles=array_values(array_filter(array_merge(glob($root.'/qBittorrent/config/qBittorrent.conf'),glob($root.'/qBittorrent/qBittorrent.conf')),fn($file)=>is_file($file)));
check(count($profiles)===1,'Unique existing qBittorrent profile required');
$profile=$profiles[0];$settings=[];
foreach(file($profile,FILE_IGNORE_NEW_LINES) as $line){if(!str_contains($line,'='))continue;[$key,$value]=explode('=',$line,2);if(in_array($key,['Session\\Interface','Session\\InterfaceName','Session\\Port','Session\\ResumeDataStorageType','Connection\\PortRangeMin','WebUI\\Port','WebUI\\LocalHostAuth','WebUI\\AuthSubnetWhitelistEnabled','Connection\\ProxyType','Proxy\\Type'],true))$settings[$key]=$value;}
$counts=['torrentFiles'=>0,'resumeFiles'=>0,'sqliteFiles'=>0];$iterator=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root.'/qBittorrent',FilesystemIterator::SKIP_DOTS));foreach($iterator as $entry){if(!$entry->isFile()||$entry->isLink())continue;$extension=$entry->getExtension();if($extension==='torrent')$counts['torrentFiles']++;if($extension==='fastresume')$counts['resumeFiles']++;if(in_array($extension,['db','sqlite','sqlite3'],true))$counts['sqliteFiles']++;}
$wireguard=glob($root.'/wireguard/*.conf');check(count($wireguard)===1,'Unique existing WireGuard configuration required');
check($root===$configuration['config_directory'],'Existing config root differs from registry');
if($phase==='prepare'){
 check($source->Name==='/'.$configuration['source_container']&&$source->State->Running,'Original must be the only active writer before cutover');
 check(isset($source->NetworkSettings->Networks->{$configuration['network']}),'Original Docker network differs');
 foreach([$configuration['image'],$configuration['gateway_image']] as $image)docker('/images/'.rawurlencode($image).'/json');
 check(run(['docker','run','--rm','--network','none','--entrypoint','/usr/bin/qbittorrent-nox',$configuration['image'],'--version'])==='qBittorrent '.$configuration['version'],'Replacement image version differs');
 if(!is_dir($directory))check(mkdir($directory,0700,true),'Private state directory creation failed');
 if(!is_file($directory.'/container-before.json'))privateFile($directory.'/container-before.json',json_encode($source,JSON_THROW_ON_ERROR));
 $baseline=identity($configuration['source_container']);$baseline['authentication']=authentication($profile);privateFile($directory.'/baseline.json',json_encode($baseline,JSON_THROW_ON_ERROR));
 $gatewayDirectory=$configuration['gateway_directory'];check(!file_exists($gatewayDirectory)||is_file($gatewayDirectory.'/.owl-red-qbittorrent'),'Refusing an unowned gateway directory');
 if(!is_dir($gatewayDirectory.'/wireguard'))check(mkdir($gatewayDirectory.'/wireguard',0700,true),'Gateway directory creation failed');
 privateFile($gatewayDirectory.'/.owl-red-qbittorrent','qbittorrent-gluetun');
 $wireguardText=preg_replace('/^(?:PostUp|PostDown|PreUp|PreDown)\s*=.*$/m','',file_get_contents($wireguard[0]));check(preg_match('/^PrivateKey\s*=/m',$wireguardText)===1&&preg_match('/^Endpoint\s*=/m',$wireguardText)===1,'Existing WireGuard fields missing');
 privateFile($gatewayDirectory.'/wireguard/wg0.conf',$wireguardText);
 privateFile($gatewayDirectory.'/control.toml',"[[roles]]\nname = \"local-qbittorrent\"\nroutes = [\"GET /v1/portforward\", \"GET /v1/vpn/status\", \"PUT /v1/vpn/status\", \"GET /v1/publicip/ip\"]\nauth = \"none\"\n");
 $gateway=ensureOwned($configuration['gateway_container']);$current=ensureOwned($configuration['container']);check($gateway===null&&$current===null,'Replacements already exist; inspect before retrying');
 $environment=array_merge(['VPN_SERVICE_PROVIDER=custom','VPN_TYPE=wireguard','VPN_INTERFACE=wg0','VPN_PORT_FORWARDING=on','VPN_PORT_FORWARDING_PROVIDER=protonvpn','HTTP_CONTROL_SERVER_ADDRESS=127.0.0.1:8000','HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH=/gluetun/control.toml','FIREWALL_INPUT_PORTS=8080','HTTPPROXY=off','SHADOWSOCKS=off'],forwardingEnvironment());
 $bindings=new stdClass();$ports=new stdClass();foreach($source->HostConfig->PortBindings as $name=>$mapping)if(!in_array($name,['8118/tcp','9118/tcp'],true)){$bindings->$name=$mapping;$ports->$name=new stdClass();}
 $endpoint=new stdClass();$endpoint->{$configuration['network']}=['Aliases'=>[$configuration['container'],$configuration['source_container']]];
 docker('/containers/create?name='.$configuration['gateway_container'],'POST',['Image'=>$configuration['gateway_image'],'Env'=>$environment,'Labels'=>['owl.red.migration'=>'qbittorrent-gluetun','net.unraid.docker.icon'=>'https://raw.githubusercontent.com/qdm12/gluetun/master/doc/logo_256.png'],'ExposedPorts'=>$ports,'HostConfig'=>['NetworkMode'=>$configuration['network'],'Binds'=>[$gatewayDirectory.':/gluetun'],'CapAdd'=>['NET_ADMIN'],'Devices'=>[['PathOnHost'=>'/dev/net/tun','PathInContainer'=>'/dev/net/tun','CgroupPermissions'=>'rwm']],'PortBindings'=>$bindings,'RestartPolicy'=>['Name'=>'unless-stopped']],'NetworkingConfig'=>['EndpointsConfig'=>$endpoint]]);
 $oldEnv=[];foreach($source->Config->Env as $entry){[$key,$value]=explode('=',$entry,2);$oldEnv[$key]=$value;}
 $environment=['GLUETUN_INCOMING_PORT=no','DEBUG=false','ENABLE_STARTUP_SCRIPTS=no','WEBUI_PORT=8080'];foreach(['PUID','PGID','UMASK','TZ'] as $key)if(isset($oldEnv[$key]))$environment[]=$key.'='.$oldEnv[$key];
 $labels=$source->Config->Labels;$labels->{'owl.red.migration'}='qbittorrent-gluetun';$labels->{'net.unraid.docker.webui'}=$configuration['webui'];
 docker('/containers/create?name='.$configuration['container'],'POST',['Image'=>$configuration['image'],'Env'=>$environment,'Labels'=>$labels,'StopTimeout'=>120,'HostConfig'=>['NetworkMode'=>'container:'.$configuration['gateway_container'],'Binds'=>$source->HostConfig->Binds,'RestartPolicy'=>['Name'=>'unless-stopped']]]);
 if($phase==='prepare'){echo json_encode(['prepared'=>true,'replacementContainersRunning'=>false,'originalStillRunning'=>true,'configAndWireGuardPreserved'=>true]).PHP_EOL;exit(0);}
}
if($phase==='apply'){
 check(is_file($directory.'/baseline.json'),'Prepared private baseline required');
 $gateway=ensureOwned($configuration['gateway_container']);$current=ensureOwned($configuration['container']);check($gateway!==null&&$current!==null&&!$gateway->State->Running&&!$current->State->Running,'Both replacements must be prepared and stopped');check($source->State->Running&&$source->Name==='/'.$configuration['source_container'],'Original writer must still be running');
 check(hash_file('sha256',$configuration['gateway_directory'].'/wireguard/wg0.conf')===hash('sha256',preg_replace('/^(?:PostUp|PostDown|PreUp|PreDown)\s*=.*$/m','',file_get_contents($wireguard[0]))),'WireGuard source changed after staging');
 $baseline=identity($configuration['source_container']);$baseline['authentication']=authentication($profile);privateFile($directory.'/baseline.json',json_encode($baseline,JSON_THROW_ON_ERROR));
 docker('/containers/'.$source->Id.'/stop?t=120','POST');check(!inspect($configuration['source_container'])->State->Running,'Original failed to stop');
 run(['tar','-C',$root,'-czf',$directory.'/qBittorrent-before.tgz','qBittorrent']);chmod($directory.'/qBittorrent-before.tgz',0600);
 docker('/containers/'.$source->Id.'/update','POST',['RestartPolicy'=>['Name'=>'no']]);docker('/containers/'.$source->Id.'/rename?name='.$configuration['rollback_container'],'POST');
 docker('/containers/'.$configuration['gateway_container'].'/start','POST');docker('/containers/'.$configuration['container'].'/start','POST');
 echo json_encode(['cutoverStarted'=>true,'originalStopped'=>true,'oldConfigAndDataRetained'=>true,'verificationRequired'=>true]).PHP_EOL;exit(0);
}
echo json_encode(['phase'=>'plan','container'=>$container['Name'],'image'=>$container['Config']['Image'],'imageId'=>$container['Image'],'sourceRunning'=>$source->State->Running,'expectedVersion'=>$configuration['version'],'configRoot'=>$root,'profile'=>substr($profile,strlen($root)+1),'settings'=>$settings,'stateCounts'=>$counts,'mounts'=>array_map(fn($mount)=>['source'=>$mount['Source'],'destination'=>$mount['Destination'],'readWrite'=>$mount['RW']],$container['Mounts']),'wireguardConfigFound'=>true,'changed'=>false],JSON_UNESCAPED_SLASHES).PHP_EOL;
`;
const home = os.homedir();
const result = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], { input: php.replace('PHASE', phase).replace('CONFIG_BASE64', Buffer.from(JSON.stringify(configuration)).toString('base64')), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
if (result.status !== 0) {
  const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/qbittorrent-migration-'));
  fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
  console.error('Migration operation failed; private diagnostics: ' + directory);
  process.exitCode = 1;
} else console.log(result.stdout.trim());