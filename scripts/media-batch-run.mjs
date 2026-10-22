import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'stop', 'seed', 'verify', 'peers', 'rollback'].includes(phase), 'Use plan, stop, seed, verify, peers or rollback.');
const registry = JSON.parse(fs.readFileSync(new URL('../ansible/vars/media-batch.json', import.meta.url), 'utf8'));
const home = os.homedir();
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/media-batch-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Media batch failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function kubectl(args, input) { return execute('kubectl', ['-n', registry.namespace, ...args], input); }
function ssh(code) { return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], code); }
const common = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Media batch failed: '.$error->getMessage().PHP_EOL);exit(1);});
$registry=json_decode(base64_decode('REGISTRY'),true,512,JSON_THROW_ON_ERROR);$directory=$registry['private_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed: '.$args[0]);return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private write failed');check(chmod($file,0600),'Private mode failed');}
function container($app){$container=json_decode(run(['docker','inspect',$app['container']]),true,512,JSON_THROW_ON_ERROR)[0];check($container['Image']===$app['image_id'],'Source image changed; review required');return $container;}
function counts($database){$tables=$database->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");$counts=[];while($table=$tables->fetchArray(SQLITE3_ASSOC)){$name=str_replace('"','""',$table['name']);$counts[$table['name']]=$database->querySingle('SELECT count(*) FROM "'.$name.'"');}return $counts;}
function access($root,$excluded){global $directory;check(is_dir($root)&&!is_link($root),'Expected existing appdata directory');$paths=[$root];$iterator=new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),function($entry)use($excluded){if($entry->isLink())return false;foreach($excluded as $path)if($entry->getPathname()===$path)return false;return !preg_match('/\.(?:db|sqlite3?)(?:-wal|-shm)?$/',$entry->getFilename());}),RecursiveIteratorIterator::SELF_FIRST);foreach($iterator as $entry)$paths[]=$entry->getPathname();check(count($paths)<25000,'Config permission scope exceeds reviewed limit');if(!is_file($directory.'/'.basename($root).'-acl-before.txt'))privateFile($directory.'/'.basename($root).'-acl-before.txt',run(array_merge(['getfacl','-p'],$paths)));foreach($paths as $file){check(chgrp($file,'users'),'Config group access failed');$mode=fileperms($file)&0777;check(chmod($file,$mode|(is_dir($file)?0070:0060)),'Config access failed');}}
`.replace('REGISTRY', Buffer.from(JSON.stringify(registry)).toString('base64'));
function assertPaused() {
  for (const name of Object.keys(registry.applications)) {
    const deployment = JSON.parse(kubectl(['get', 'deployment', name, '-o', 'json']));
    const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=' + name, '-o', 'json'])).items;
    assert.equal(deployment.spec.replicas, 0, 'Publish replicas zero before touching NAS source state.');
    assert.equal(pods.length, 0, 'Wait for all cluster app pods to disappear first.');
  }
}
async function main() {
  if (phase === 'plan') {
    console.log(ssh(common + String.raw`
$summary=[];foreach($registry['applications'] as $name=>$app){$current=container($app);$databases=[];foreach($app['databases'] as $file){$path=$app['source_directory'].'/'.$file;check(is_file($path),'Expected database missing');$databases[]=['file'=>$file,'bytes'=>filesize($path)];}$summary[]=['application'=>$name,'nasRunning'=>$current['State']['Running'],'databases'=>$databases,'ordinaryConfig'=>'NAS appdata','databaseStorage'=>'longhorn-appdata'];}echo json_encode($summary,JSON_UNESCAPED_SLASHES).PHP_EOL;
`));
    return;
  }
  if (phase === 'stop') {
    assertPaused();
    console.log(ssh(common + String.raw`
if(!is_dir($directory))mkdir($directory,0700,true);check(!is_file($directory.'/baseline.json'),'Final snapshot already exists; inspect before retrying');
$parser='import sys,json;sys.path.insert(0,"/app/lib");from configobj import ConfigObj;print(json.dumps(ConfigObj("/config/config.ini")))';$tautulli=json_decode(run(['docker','exec','tautulli','python','-c',$parser]),true,512,JSON_THROW_ON_ERROR);privateFile($directory.'/tautulli-settings-before.json',json_encode($tautulli));
foreach($registry['applications'] as $name=>$app){$current=container($app);check($current['State']['Running'],'Expected NAS source already stopped');privateFile($directory.'/'.$name.'-container-before.json',json_encode($current));run(['docker','stop','--time','60',$app['container']]);run(['docker','update','--restart','no',$app['container']]);}
$baseline=[];
foreach($registry['applications'] as $name=>$app){
 check(!container($app)['State']['Running'],'NAS writer failed to stop');$stage=$directory.'/'.$name.'/data';check(!file_exists($stage),'Owned data stage already exists');mkdir($stage,0700,true);$baseline[$name]=['databases'=>[],'hashes'=>[]];
 foreach($app['databases'] as $file){$source=new SQLite3($app['source_directory'].'/'.$file,SQLITE3_OPEN_READONLY);$targetPath=$stage.'/'.$file;if(!is_dir(dirname($targetPath)))mkdir(dirname($targetPath),0700,true);$target=new SQLite3($targetPath);check($source->backup($target),'Native SQLite backup failed');check($target->querySingle('PRAGMA quick_check')==='ok','SQLite integrity failed');$baseline[$name]['databases'][$file]=counts($target);$target->close();$source->close();chmod($targetPath,0600);$baseline[$name]['hashes'][$file]=hash_file('sha256',$targetPath);}
 if($name==='tautulli'){foreach(['version.lock','release.lock'] as $file)if(is_file($app['source_directory'].'/'.$file))copy($app['source_directory'].'/'.$file,$stage.'/'.$file);$baseline[$name]['apiKey']=$tautulli['General']['api_key'];}
 if($name==='reclaimerr')$baseline[$name]['secretsHash']=hash_file('sha256',$app['source_directory'].'/secrets.env');
 run(['tar','-C',$stage,'-czf',$directory.'/'.$name.'/data.tgz','.']);chmod($directory.'/'.$name.'/data.tgz',0600);
 $excluded=$name==='reclaimerr'?[$app['source_directory'].'/database',$app['source_directory'].'/cache']:[];access($app['source_directory'],$excluded);
 $shared='/mnt/user/appdata/'.$app['config_subdirectory'];check(is_file($shared.'/'.($name==='tautulli'?'config.ini':'secrets.env')),'SMB share path differs from current NAS config');
}
privateFile($directory.'/baseline.json',json_encode($baseline,JSON_THROW_ON_ERROR));echo json_encode(['nasWritersStopped'=>true,'nativeSqliteSnapshotsVerified'=>3,'configPathsPreserved'=>true,'originalDatabasesRetained'=>true]).PHP_EOL;
`));
    return;
  }
  if (phase === 'seed') {
    assertPaused();
    const baseline = JSON.parse(ssh(common + "echo file_get_contents($directory.'/baseline.json');\n"));
    for (const [name, app] of Object.entries(registry.applications)) {
      const podName = name + '-data-seed';
      assert.ok(!kubectl(['get', 'pod', podName, '--ignore-not-found', '-o', 'json']), 'Seeder already exists; inspect before retrying.');
      const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: podName, namespace: registry.namespace, labels: { 'owl.red/migration': 'media-batch' } }, spec: { restartPolicy: 'Never', activeDeadlineSeconds: 300, automountServiceAccountToken: false, tolerations: [{ key: 'node-role.kubernetes.io/control-plane', operator: 'Exists', effect: 'NoSchedule' }], securityContext: { seccompProfile: { type: 'RuntimeDefault' } }, containers: [{ name: 'seed', image: app.image, command: ['/bin/sh', '-ec', 'exec tail -f /dev/null'], securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'], add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'] } }, volumeMounts: [{ name: 'data', mountPath: '/seed' }] }], volumes: [{ name: 'data', persistentVolumeClaim: { claimName: name + '-data' } }] } };
      kubectl(['create', '-f', '-'], JSON.stringify(pod));
      kubectl(['wait', '--for=condition=Ready', 'pod/' + podName, '--timeout=180s']);
      const archive = ssh(common + "echo base64_encode(file_get_contents($directory.'/" + name + "/data.tgz'));\n");
      kubectl(['exec', '-i', podName, '-c', 'seed', '--', '/bin/sh', '-ec', 'test ! -e /seed/.owl-red-seeded; tar --no-same-owner -xzf - -C /seed; chown -R 99:100 /seed'], Buffer.from(archive, 'base64'));
      for (const [file, expected] of Object.entries(baseline[name].hashes)) {
        assert.ok(app.databases.includes(file));
        const actual = kubectl(['exec', podName, '-c', 'seed', '--', 'sha256sum', '/seed/' + file]).split(/\s+/)[0];
        assert.equal(actual, expected, 'Transferred database checksum differs.');
      }
      kubectl(['exec', podName, '-c', 'seed', '--', 'touch', '/seed/.owl-red-seeded']);
      kubectl(['delete', 'pod', podName, '--wait=true']);
      console.log(JSON.stringify({ application: name, nativeDatabasesSeeded: app.databases.length, checksumsMatch: true, seederRemoved: true }));
    }
    return;
  }
  if (phase === 'verify') {
    const baseline = JSON.parse(ssh(common + "echo file_get_contents($directory.'/baseline.json');\n"));
    for (const [name, app] of Object.entries(registry.applications)) {
      const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=' + name, '-o', 'json'])).items;
      assert.equal(pods.length, 1);
      const pod = pods[0];
      assert.ok(pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'), 'Application pod must be ready.');
      const probe = [
        'import json,sqlite3,sys',
        'summaries={}',
        'for source in json.load(sys.stdin):',
        '    database=sqlite3.connect("file:"+source+"?mode=ro",uri=True)',
        '    tables=[row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'")]',
        '    summaries[source]={table:database.execute(\'SELECT count(*) FROM "\'+table.replace(\'"\',\'""\')+\'"\').fetchone()[0] for table in tables}',
        '    database.close()',
        'print(json.dumps(summaries))',
      ].join('\n');
      const paths = app.databases.map(file => (name === 'tautulli' ? '/data/' : '/app/data/') + file);
      const actual = JSON.parse(kubectl(['exec', '-i', pod.metadata.name, '-c', name, '--', 'python', '-c', probe], JSON.stringify(paths)));
      for (let index = 0; index < app.databases.length; index++) {
        for (const [table, count] of Object.entries(baseline[name].databases[app.databases[index]])) {
          assert.ok(actual[paths[index]][table] >= count, 'Database rows lost: ' + name + '/' + table);
        }
      }
      if (name === 'tautulli') {
        const api = 'url = "http://127.0.0.1:8181/api/v2?cmd=get_tautulli_info&apikey=' + baseline[name].apiKey + '"\n';
        const code = 'import sys,urllib.request;print(urllib.request.urlopen(sys.stdin.read(),timeout=15).read().decode())';
        const response = JSON.parse(kubectl(['exec', '-i', pod.metadata.name, '-c', name, '--', 'python', '-c', code], 'http://127.0.0.1:8181/api/v2?cmd=get_tautulli_info&apikey=' + baseline[name].apiKey));
        assert.equal(response.response.result, 'success');
      }
      console.log(JSON.stringify({ application: name, ready: true, existingRowsPreserved: true, databaseStorage: 'longhorn-appdata', ordinaryConfig: 'NAS appdata' }));
    }
    console.log(ssh(common + String.raw`
foreach($registry['applications'] as $app)check(!container($app)['State']['Running'],'NAS writer restarted');$baseline=json_decode(file_get_contents($directory.'/baseline.json'),true);check(hash_file('sha256',$registry['applications']['reclaimerr']['source_directory'].'/secrets.env')===$baseline['reclaimerr']['secretsHash'],'Reclaimerr session/encryption secrets changed');echo json_encode(['nasWritersStopped'=>true,'privateSecretsPreserved'=>true]).PHP_EOL;
`));
    return;
  }
  if (phase === 'peers') {
    console.log(ssh(common + String.raw`
$settings=json_decode(file_get_contents('/mnt/user/appdata/seerr/settings.json'),true,512,JSON_THROW_ON_ERROR);$key=$settings['main']['apiKey'];$url='https://seerr.owl.red/api/v1/settings/tautulli';
function request($url,$key,$body=null){$handle=curl_init($url);curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30,CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Api-Key: '.$key]]);if($body!==null){curl_setopt($handle,CURLOPT_POST,true);curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body));}$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Native Seerr Tautulli connection update failed');return json_decode($output,true);}
$original=request($url,$key);check(in_array($original['hostname']??'',['nas.owl.red','tautulli','tautulli.media-apps.svc.cluster.local'],true),'Unexpected current Tautulli peer');if(!is_file($directory.'/seerr-tautulli-before.json'))privateFile($directory.'/seerr-tautulli-before.json',json_encode($original));$original['hostname']='tautulli.media-apps.svc.cluster.local';$original['port']=8181;$original['useSsl']=false;request($url,$key,$original);echo json_encode(['seerrTautulliConnectionUpdated'=>true,'existingApiKeyPreserved'=>true]).PHP_EOL;
`));
    return;
  }
  if (phase === 'rollback') {
    assertPaused();
    throw Error('Export the current Longhorn databases before NAS rollback; never start against stale NAS database snapshots.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });