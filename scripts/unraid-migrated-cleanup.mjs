import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'apply'].includes(phase), 'Use plan or apply.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = os.homedir();
const targets = {};
const arr = JSON.parse(fs.readFileSync(path.join(repository, 'gitops/arr/chart/apps.json'), 'utf8'));
for (const app of Object.values(arr.applications)) targets[app.container] = app.image_id;
const media = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/media-batch.json'), 'utf8'));
for (const app of Object.values(media.applications)) targets[app.container] = app.image_id;
const soularr = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/soularr.json'), 'utf8'));
for (const app of [soularr.slskd, soularr.soularr]) targets[app.container] = app.image_id;
Object.assign(targets, {
  qbittorrent: 'sha256:ef219f7e7ddfb07156a2b7639a181ecba92202e1c7924b707febf150e9d9e812',
  gluetun: 'sha256:cbd6e98498925a2e9529ec49841c8a2cc789e41f1c2e8a968e81dc949cbb3f6b',
  'qbittorrentvpn-rollback': 'sha256:ad0f1ecf8b9971251b9e9ed0702eee257b1e9deb094ace336efc7f60682f5c0d',
  Seerr: 'sha256:c1673c6c7835e21540cacbf517abb7c4a80d2893b3484bec1b1a11212ac247fb',
  'Seerr-sqlite-rollback': 'sha256:c1673c6c7835e21540cacbf517abb7c4a80d2893b3484bec1b1a11212ac247fb',
  flaresolverr: 'sha256:ed7b6d5ab3ff3faa846e03ea54765d1b85089da5a04b81131f9a376fa34f7470',
});
const replacements = { arr: Object.keys(arr.applications), 'media-apps': Object.keys(media.applications), qbittorrent: ['qbittorrent'], seerr: ['seerr'], flaresolverr: ['flaresolverr'], speedtest: ['speedtest'] };
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/unraid-cleanup-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Cleanup failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
async function main() {
  for (const [namespace, names] of Object.entries(replacements)) {
    const deployments = JSON.parse(execute('kubectl', ['-n', namespace, 'get', 'deployments', '-o', 'json'])).items;
    const pods = JSON.parse(execute('kubectl', ['-n', namespace, 'get', 'pods', '-o', 'json'])).items;
    for (const name of names) {
      const deployment = deployments.find(item => item.metadata.name === name);
      assert.ok(deployment?.spec.replicas === 1 && deployment.status.availableReplicas === 1, 'Replacement must be available: ' + namespace + '/' + name);
      assert.ok(pods.some(pod => pod.metadata.labels?.['app.kubernetes.io/name'] === name && pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')), 'Replacement pod must be ready: ' + name);
    }
  }
  const request = { phase, targets };
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Cleanup failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$targets=$request['targets'];$phase=$request['phase'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function docker($path,$method='GET'){$handle=curl_init('http://localhost/v1.45'.$path);curl_setopt_array($handle,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_TIMEOUT=>120]);$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Docker operation failed: '.$method.' '.$path.' (HTTP '.$status.')');return $output!==''?json_decode($output,true,512,JSON_THROW_ON_ERROR):null;}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private archive write failed');check(chmod($file,0600),'Private archive permissions failed');}
$containers=[];foreach(docker('/containers/json?all=true') as $container){$actual=docker('/containers/'.$container['Id'].'/json');$containers[ltrim($actual['Name'],'/')]=$actual;}
$remove=[];$keepers=[];$mountRoots=[];$images=[];
foreach($containers as $name=>$container){if(!isset($targets[$name])){$keepers[$name]=['id'=>$container['Id'],'running'=>$container['State']['Running'],'restart'=>$container['HostConfig']['RestartPolicy']];continue;}check(!$container['State']['Running']&&!$container['State']['Paused'],'Refusing to remove a live NAS container: '.$name);check($container['Image']===$targets[$name],'Retired image differs from reviewed source: '.$name);$remove[$name]=$container;$images[$container['Image']]=true;foreach($container['Mounts'] as $mount)if(($mount['Type']??'')==='bind')$mountRoots[$mount['Source']]=true;}
$templates=[];$aliases=array_fill_keys(array_merge(array_keys($targets),['qbittorrentvpn','speedtest-tracker','binhex-overseerr']),true);
foreach(glob('/boot/config/plugins/dockerMan/templates-user/*.xml') as $file){check(!is_link($file),'Unexpected symlink in native templates');$xml=@simplexml_load_file($file);if($xml!==false&&isset($aliases[(string)$xml->Name]))$templates[$file]=(string)$xml->Name;}
$autostart='/boot/config/plugins/dockerMan/autostart';$beforeAutostart=is_file($autostart)?file_get_contents($autostart):null;$remainingLines=[];$bootRemoved=[];
foreach(explode("\n",$beforeAutostart??'') as $line){$name=preg_split('/\s+/',trim($line))[0]??'';if(isset($aliases[$name]))$bootRemoved[]=$name;else $remainingLines[]=$line;}
if($phase==='plan'){echo json_encode(['containersToRemove'=>array_keys($remove),'templatesToArchive'=>array_values($templates),'bootEntriesToRemove'=>$bootRemoved,'keeperContainers'=>array_keys($keepers),'candidateUnusedImages'=>count($images),'dataAndVolumesDeleted'=>false]).PHP_EOL;exit(0);}
$base='/root/.local/state/owl-red/migrated-cleanup';if(!is_dir($base))check(mkdir($base,0700,true),'Archive base creation failed');$directory=$base.'/'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(3));check(mkdir($directory,0700),'Private cleanup archive failed');
privateFile($directory.'/containers.json',json_encode($remove,JSON_THROW_ON_ERROR));privateFile($directory.'/keepers-before.json',json_encode($keepers,JSON_THROW_ON_ERROR));privateFile($directory.'/template-identities.json',json_encode($templates,JSON_THROW_ON_ERROR));$imageMetadata=[];foreach(array_keys($images) as $image)$imageMetadata[$image]=docker('/images/'.$image.'/json');privateFile($directory.'/images.json',json_encode($imageMetadata,JSON_THROW_ON_ERROR));if($beforeAutostart!==null)privateFile($directory.'/autostart-before.txt',$beforeAutostart);
foreach($templates as $file=>$name){privateFile($directory.'/'.basename($file),file_get_contents($file));check(unlink($file),'Template retirement failed');}
if($beforeAutostart!==null&&$bootRemoved)check(file_put_contents($autostart,implode("\n",$remainingLines))!==false,'Autostart update failed');
foreach($remove as $name=>$container){$actual=docker('/containers/'.$container['Id'].'/json');check(!$actual['State']['Running']&&$actual['Image']===$targets[$name],'Retired container changed during cleanup');docker('/containers/'.$container['Id'],'DELETE');}
$imageCount=0;$imageBytes=0;$keptImages=[];foreach(docker('/containers/json?all=true') as $container)$keptImages[$container['ImageID']]=true;
foreach(array_keys($images) as $image){if(isset($keptImages[$image]))continue;$metadata=$imageMetadata[$image];$references=array_values(array_unique(array_merge($metadata['RepoTags']??[],$metadata['RepoDigests']??[])));if(!$references)$references=[$image];foreach($references as $reference){$handle=curl_init('http://localhost/v1.45/images/'.rawurlencode($reference).'?noprune=true');curl_setopt_array($handle,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>'DELETE',CURLOPT_TIMEOUT=>120]);$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check(in_array($status,[200,404],true),'Unused image retirement failed');}$imageCount++;$imageBytes+=$metadata['Size'];}
$after=[];foreach(docker('/containers/json?all=true') as $container){$actual=docker('/containers/'.$container['Id'].'/json');$after[ltrim($actual['Name'],'/')]=$actual;}
foreach($keepers as $name=>$before){check(isset($after[$name])&&$after[$name]['Id']===$before['id']&&$after[$name]['State']['Running']===$before['running']&&$after[$name]['HostConfig']['RestartPolicy']===$before['restart'],'Keeper state changed: '.$name);}
foreach($targets as $name=>$image)check(!isset($after[$name]),'Retired container remains');foreach(array_keys($mountRoots) as $root)check(file_exists($root),'Existing appdata or media root disappeared');
echo json_encode(['containersRemoved'=>count($remove),'templatesArchived'=>count($templates),'autostartEntriesRemoved'=>count($bootRemoved),'unusedImagesRemoved'=>$imageCount,'imageLogicalBytes'=>$imageBytes,'keepersPreserved'=>array_keys($keepers),'privateDefinitionArchive'=>$directory,'appdataMediaAndVolumesDeleted'=>false],JSON_UNESCAPED_SLASHES).PHP_EOL;
`;
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], php.replace('REQUEST', Buffer.from(JSON.stringify(request)).toString('base64'))));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });