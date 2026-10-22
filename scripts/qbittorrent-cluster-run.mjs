import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const phase = process.argv[2] || 'media-access';
assert.ok(['media-access', 'case-access', 'prepare', 'stop', 'verify', 'peers', 'rollback'].includes(phase), 'Use media-access, case-access, prepare, stop, verify, peers or rollback.');
process.umask(0o077);
const configuration = JSON.parse(fs.readFileSync(new URL('../ansible/vars/qbittorrent.json', import.meta.url), 'utf8'));
const home = os.homedir();
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/qbittorrent-cluster-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Cluster migration failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
const namespace = configuration.cluster.namespace;
const deployment = configuration.cluster.deployment;
const workload = JSON.parse(execute('kubectl', ['-n', namespace, 'get', 'deployment', deployment, '--ignore-not-found', '-o', 'json']) || 'null');
const pods = JSON.parse(execute('kubectl', ['-n', namespace, 'get', 'pods', '-l', 'app.kubernetes.io/name=qbittorrent', '-o', 'json'])).items;
if (['case-access', 'prepare', 'stop', 'rollback'].includes(phase)) {
  assert.ok(!workload || (workload.spec.replicas === 0 && pods.length === 0), 'Pause the Fleet deployment and wait for all cluster application pods to disappear first.');
}
const request = { phase, configuration };
if (phase === 'verify') {
  assert.ok(workload?.spec.replicas === 1 && pods.length === 1, 'Exactly one cluster pod required.');
  const pod = pods[0];
  assert.ok(pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Cluster pod must be Ready.');
  const app = route => execute('kubectl', ['-n', namespace, 'exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', '--max-time', '15', 'http://127.0.0.1:8080/api/v2' + route]);
  const torrents = JSON.parse(app('/torrents/info'));
  const identities = {};
  for (const torrent of torrents.sort((first, second) => first.hash.localeCompare(second.hash))) identities[torrent.hash] = Object.fromEntries(['save_path', 'category', 'tags', 'name', 'size'].map(key => [key, torrent[key]]));
  const preferences = JSON.parse(app('/app/preferences'));
  assert.equal(app('/app/version'), configuration.version);
  assert.equal(preferences.current_network_interface, 'wg0');
  const forwarding = JSON.parse(execute('kubectl', ['-n', namespace, 'exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', 'http://127.0.0.1:8000/v1/portforward']));
  const ports = forwarding.ports || [forwarding.port];
  const sharedSoulseek = workload.spec.template.spec.containers.some(container => container.name === 'slskd');
  assert.equal(preferences.listen_port, ports[sharedSoulseek ? 1 : 0]);
  const route = execute('kubectl', ['-n', namespace, 'exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'ip', 'route', 'get', '1.1.1.1']);
  assert.ok(route.includes('dev wg0'), 'Public internet must route through WireGuard.');
  const dns = execute('kubectl', ['-n', namespace, 'exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'cat', '/etc/resolv.conf']);
  assert.match(dns, /^nameserver 127\.0\.0\.1$/m);
  execute('kubectl', ['-n', namespace, 'exec', pod.metadata.name, '-c', 'qbittorrent', '--', 'curl', '--fail', '--silent', '--max-time', '20', 'https://api.ipify.org']);
  request.actual = { torrents: identities, categories: JSON.parse(app('/torrents/categories')), preferences };
  request.node = pod.spec.nodeName;
}
const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Cluster migration failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST_BASE64'),true,512,JSON_THROW_ON_ERROR);$phase=$request['phase'];$configuration=$request['configuration'];$directory=$configuration['cluster']['private_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed');return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private state write failed');check(chmod($file,0600),'Private state permissions failed');}
function container($name){$container=json_decode(run(['docker','inspect',$name]),true,512,JSON_THROW_ON_ERROR)[0];check(($container['Config']['Labels']['owl.red.migration']??'')==='qbittorrent-gluetun','Unowned NAS container');return $container;}
function retired($name){return run(['docker','ps','--quiet','--filter','name=^/'.$name.'$'])==='';}
function api($route){return json_decode(run(['docker','exec','qbittorrent','curl','--fail','--silent','--max-time','15','http://127.0.0.1:8080/api/v2'.$route]),true,512,JSON_THROW_ON_ERROR);}
function authentication(){global $configuration;$fields=[];foreach(file($configuration['config_directory'].'/qBittorrent/config/qBittorrent.conf',FILE_IGNORE_NEW_LINES) as $line)if(preg_match('/^(Username|Password[^=]*)=|^WebUI\\\\(Username|Password[^=]*)=/',$line))$fields[]=$line;sort($fields);check(count($fields)>=2,'Saved authentication missing');return hash('sha256',implode("\n",$fields));}
function baseline(){global $configuration;$torrents=[];foreach(api('/torrents/info') as $torrent)$torrents[$torrent['hash']]=array_intersect_key($torrent,array_flip(['save_path','category','tags','name','size']));ksort($torrents);return ['torrents'=>$torrents,'categories'=>api('/torrents/categories'),'preferences'=>api('/app/preferences'),'authentication'=>authentication()];}
function grantConfig($root){global $directory;check(is_dir($root)&&!is_link($root),'Expected local appdata directory required');$name=basename($root);if(!is_file($directory.'/'.$name.'-acl-before.txt'))privateFile($directory.'/'.$name.'-acl-before.txt',run(['getfacl','-R','-p',$root]));$paths=[$root];foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST) as $entry)if(!$entry->isLink())$paths[]=$entry->getPathname();foreach($paths as $file){run(['setfacl','-m','u:k8s:rwX,u:nobody:rwX',$file]);if(is_dir($file))run(['setfacl','-m','d:u:k8s:rwx,d:u:nobody:rwx',$file]);}}
if(!is_dir($directory))check(mkdir($directory,0700,true),'Private directory creation failed');
if($phase==='case-access'){
 $globalBefore=hash_file('sha256','/boot/config/share.cfg');$global=parse_ini_file('/boot/config/share.cfg',false,INI_SCANNER_RAW);check(in_array(strtolower($global['shareNFSEnabled']??''),['no','false','0'],true),'Global NFS must remain disabled');
 foreach(['appdata','media'] as $name){$file='/boot/config/shares/'.$name.'.cfg';$original=parse_ini_file($file,false,INI_SCANNER_RAW);check(in_array($original['shareCaseSensitive']??'',['forced','yes'],true),'Unexpected existing case policy');$snapshot=$directory.'/'.$name.'-before-case.cfg';if(!is_file($snapshot))privateFile($snapshot,file_get_contents($file));
  if($original['shareCaseSensitive']!=='yes')update(['changeShareSecurity'=>'Apply','shareName'=>$name,'shareExport'=>$original['shareExport'],'shareSecurity'=>$original['shareSecurity'],'shareCaseSensitive'=>'yes','shareVolsizelimit'=>$original['shareVolsizelimit']??'']);
  $actual=parse_ini_file($file,false,INI_SCANNER_RAW);check($actual['shareCaseSensitive']==='yes','Case handling change did not persist');foreach($original as $key=>$value)if($key!=='shareCaseSensitive')check(($actual[$key]??null)===$value,'Unapproved share setting changed: '.$key);
 }
 check(hash_file('sha256','/boot/config/share.cfg')===$globalBefore,'Global share policy changed');
 $root=$configuration['gateway_directory'];check(is_dir($root)&&!is_link($root)&&is_file($root.'/.owl-red-qbittorrent'),'Owned Gluetun directory required');$paths=[$root];foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::SELF_FIRST) as $entry)if(!$entry->isLink())$paths[]=$entry->getPathname();foreach($paths as $file)check(chown($file,'k8s'),'Scoped Gluetun ownership update failed');
 echo json_encode(['caseMode'=>'ordinary-case-sensitive','shares'=>['appdata','media'],'existingFilenamesAndGrantsPreserved'=>true,'privateGluetunOwner'=>'k8s','mediaAndQbittorrentOwnershipChanged'=>false,'globalNfsStillDisabled'=>true]).PHP_EOL;exit(0);
}
if(in_array($phase,['prepare','stop'],true)){
 $current=container('qbittorrent');$gateway=container('gluetun');check($current['Config']['Image']===$configuration['image']&&$gateway['Config']['Image']===$configuration['gateway_image'],'Pinned NAS images differ');check($current['State']['Running']&&$gateway['State']['Running'],'NAS source pair must be running');
 if(!is_file($directory.'/containers-before.json'))privateFile($directory.'/containers-before.json',json_encode(['qbittorrent'=>$current,'gluetun'=>$gateway],JSON_THROW_ON_ERROR));
 if($phase==='stop'){
  privateFile($directory.'/baseline.json',json_encode(baseline(),JSON_THROW_ON_ERROR));
  run(['docker','stop','--time','120','qbittorrent']);run(['docker','stop','--time','30','gluetun']);run(['docker','update','--restart','no','qbittorrent','gluetun']);
  check(!container('qbittorrent')['State']['Running']&&!container('gluetun')['State']['Running'],'NAS pair failed to stop');
  run(['tar','-C',$configuration['config_directory'],'-czf',$directory.'/qBittorrent-before.tgz','qBittorrent']);chmod($directory.'/qBittorrent-before.tgz',0600);
 }
 $shared=$configuration['cluster']['shared_directory'];check(!file_exists($shared)||is_file($shared.'/.owl-red-shared'),'Unowned shared target directory');
 if(!is_dir($shared))check(mkdir($shared,0770,true),'Shared appdata creation failed');privateFile($shared.'/.owl-red-shared','qbittorrent-cluster');run(['cp','-a','/var/lib/docker/volumes/binhex-shared/_data/.',$shared.'/']);check(chown($shared,'k8s'),'Owned shared directory access failed');
 foreach([$configuration['config_directory'],$configuration['gateway_directory'],$shared] as $root)grantConfig($root);
 echo json_encode(['phase'=>$phase,'nasPairStopped'=>$phase==='stop','scopedConfigAclPrepared'=>true,'sharedPathPreserved'=>true,'mediaOwnershipChanged'=>false]).PHP_EOL;exit(0);
}
if($phase==='verify'){
 check(retired('qbittorrent')&&retired('gluetun'),'NAS pair must remain absent or stopped');
 $baseline=json_decode(file_get_contents($directory.'/baseline.json'),true,512,JSON_THROW_ON_ERROR);$actual=$request['actual'];check($actual['torrents']==$baseline['torrents'],'Torrent identities or paths changed');check($actual['categories']==$baseline['categories'],'Saved categories changed');check(authentication()===$baseline['authentication'],'Saved username or password hash changed');
 foreach(['save_path','temp_path','temp_path_enabled','auto_tmm_enabled','queueing_enabled','dl_limit','up_limit','max_ratio','max_seeding_time','web_ui_username','bypass_local_auth','proxy_type'] as $key)check(($actual['preferences'][$key]??null)===($baseline['preferences'][$key]??null),'Saved preference changed: '.$key);
 echo json_encode(['clusterReady'=>true,'node'=>$request['node'],'torrentsPreserved'=>count($actual['torrents']),'credentialsCategoriesAndPathsPreserved'=>true,'vpnAndDnsVerified'=>true,'forwardedPortSynchronized'=>true,'nasWritersStopped'=>true,'webui'=>$configuration['cluster']['webui']]).PHP_EOL;exit(0);
}
if($phase==='rollback'){
 $saved=json_decode(file_get_contents($directory.'/containers-before.json'),true,512,JSON_THROW_ON_ERROR);foreach([$configuration['config_directory'],$configuration['gateway_directory']] as $root)grantConfig($root);
 foreach(['gluetun','qbittorrent'] as $name){$current=container($name);if(!$current['State']['Running'])run(['docker','start',$name]);$restart=$saved[$name]['HostConfig']['RestartPolicy']['Name'];run(['docker','update','--restart',$restart,$name]);}
 echo json_encode(['nasPairStarted'=>true,'currentProfileAndResumeStateRetained'=>true,'restorePeerPreimagesManually'=>true]).PHP_EOL;exit(0);
}
if($phase==='peers'){
 function peerRequest($url,$key,$method='GET',$body=null){global $directory;$handle=curl_init($url);curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Api-Key: '.$key]]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);if($output===false||$status<200||$status>=300){privateFile($directory.'/peer-failure-response.json',$output===false?'null':$output);throw new RuntimeException('Native peer API failed: '.$method.' '.parse_url($url,PHP_URL_PATH).' (HTTP '.$status.')');}return $output!==''?json_decode($output,true):null;}
 $apps=[['sonarr_fhd','/mnt/user/appdata/binhex-sonarr/config.xml',8989,'v3'],['sonarr_uhd','/mnt/user/appdata/sonarr-uhd/config.xml',18989,'v3'],['radarr_fhd','/mnt/user/appdata/binhex-radarr/config.xml',7878,'v3'],['radarr_uhd','/mnt/user/appdata/radarr_uhd/config.xml',17878,'v3'],['lidarr','/mnt/user/appdata/binhex-lidarr/config.xml',8686,'v1'],['prowlarr','/mnt/user/appdata/binhex-prowlarr/prowlarr/config.xml',9696,'v1']];
 $referenceCredentials=[];
 foreach($apps as [$name,$file,$port,$version]){
  $xml=simplexml_load_file($file);$key=(string)$xml->ApiKey;$url='http://10.0.10.5:'.$port.'/api/'.$version.'/downloadclient';$clients=peerRequest($url,$key);$snapshot=$directory.'/'.$name.'-clients-before.json';if(!is_file($snapshot))privateFile($snapshot,json_encode($clients,JSON_THROW_ON_ERROR));$updated=0;$already=0;$credentialsSupplied=false;
  foreach($clients as $client){
   if(!preg_match('/qbittorrent/i',$client['implementation']??'')||($client['enable']??true)===false)continue;
   $fields=array_column($client['fields'],'value','name');
  if($name==='sonarr_fhd'){$database=new SQLite3(dirname($file).'/sonarr.db',SQLITE3_OPEN_READONLY);$statement=$database->prepare('SELECT Settings FROM DownloadClients WHERE Id=:id');$statement->bindValue(':id',$client['id'],SQLITE3_INTEGER);$settings=json_decode($statement->execute()->fetchArray(SQLITE3_ASSOC)['Settings'],true,512,JSON_THROW_ON_ERROR);$database->close();$referenceCredentials=array_intersect_key($settings,array_flip(['username','password']));}
   if(($fields['host']??'')===$configuration['cluster']['api_host']){$already++;continue;}
   check(in_array($fields['host']??'',['qbittorrentvpn','qbittorrent','nas.owl.red','10.0.10.5'],true),'Unexpected existing download-client hostname');
   foreach($client['fields'] as &$field){if($field['name']==='host')$field['value']=$configuration['cluster']['api_host'];if(in_array($field['name'],['username','password'],true)&&empty($field['value'])){check(!empty($referenceCredentials[$field['name']]),'Known existing qBittorrent credentials required');$field['value']=$referenceCredentials[$field['name']];$credentialsSupplied=true;}}unset($field);
   peerRequest($url.'/test',$key,'POST',$client);peerRequest($url.'/'.$client['id'],$key,'PUT',$client);$updated++;
  }
  echo json_encode(['consumer'=>$name,'downloadClientsUpdated'=>$updated,'alreadyAtClusterEndpoint'=>$already,'nativeConnectionTestsPassed'=>true,'existingAccountCredentialsSupplied'=>$credentialsSupplied]).PHP_EOL;
 }
 exit(0);
}
function share(){return parse_ini_file('/boot/config/shares/media.cfg',false,INI_SCANNER_RAW);}
function users(){return parse_ini_file('/var/local/emhttp/users.ini',true,INI_SCANNER_RAW);}
function update($fields){$variables=parse_ini_file('/var/local/emhttp/var.ini',false,INI_SCANNER_RAW);check(!empty($variables['csrf_token']),'Native CSRF token unavailable');$fields['csrf_token']=$variables['csrf_token'];$handle=curl_init('http://localhost/update');curl_setopt_array($handle,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/emhttpd.socket',CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($fields),CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30]);$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Native Unraid update failed');}
$original=share();check(($original['shareExport']??'')==='e'&&($original['shareSecurity']??'')==='secure','Reviewed media share policy differs');
$accounts=users();check(count(array_filter($accounts,fn($user)=>($user['name']??'')==='k8s'))===1,'Existing k8s account required');
$global=parse_ini_file('/boot/config/share.cfg',false,INI_SCANNER_RAW);check(in_array(strtolower($global['shareNFSEnabled']??''),['no','false','0'],true),'NFS must remain globally disabled');
$protected=[];foreach(['/boot/config/share.cfg','/boot/config/shares/appdata.cfg','/boot/config/disk.cfg','/boot/config/super.dat','/boot/config/network.cfg'] as $file)$protected[$file]=hash_file('sha256',$file);
$directory='/root/.local/state/owl-red/qbittorrent-cluster';if(!is_dir($directory))check(mkdir($directory,0700,true),'Private state directory failed');
if(!is_file($directory.'/media-share-before.cfg')){check(copy('/boot/config/shares/media.cfg',$directory.'/media-share-before.cfg'),'Share preimage failed');chmod($directory.'/media-share-before.cfg',0600);}
$write=array_values(array_filter(explode(',',$original['shareWriteList']??'')));$read=array_values(array_filter(explode(',',$original['shareReadList']??'')));
if(!in_array('k8s',$write,true)){
 $fields=['changeShareAccess'=>'Apply','shareName'=>'media','userAccess.0'=>'no-access'];
 foreach($accounts as $user){$name=$user['name']??'';if($name==='root')continue;$fields['userAccess.'.$user['idx']]=($name==='k8s'||in_array($name,$write,true))?'read-write':'read-only';}
 update($fields);
}
$actual=share();foreach($original as $key=>$value)if(!in_array($key,['shareWriteList','shareReadList'],true))check(($actual[$key]??null)===$value,'Unapproved media share field changed: '.$key);
check(in_array('k8s',explode(',',$actual['shareWriteList']??''),true),'k8s write grant missing');foreach($write as $name)check(in_array($name,explode(',',$actual['shareWriteList']??''),true),'Original write grant lost');
foreach($protected as $file=>$hash)check(hash_file('sha256',$file)===$hash,'Protected NAS settings changed');
echo json_encode(['share'=>'media','identity'=>'k8s','writeGranted'=>true,'existingSharePolicyPreserved'=>true,'existingWriteGrantsPreserved'=>true,'globalNfsStillDisabled'=>true,'mediaOwnershipChanged'=>false]).PHP_EOL;
`;
try {
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], php.replace('REQUEST_BASE64', Buffer.from(JSON.stringify(request)).toString('base64'))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}