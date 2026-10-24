import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'stop', 'seed', 'verify', 'peers', 'retire', 'inspect-integrations', 'repair-downloaders', 'repair-prowlarr', 'repair-access', 'update-access-urls', 'sync-indexers', 'verify-integrations', 'verify-app-connections'].includes(phase), 'Unknown Arr operation.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const registry = JSON.parse(fs.readFileSync(path.join(repository, 'gitops/arr/chart/apps.json'), 'utf8'));
const home = os.homedir();
function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/arr-batch-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw Error('Arr batch failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
function kubectl(args, input) { return execute('kubectl', ['-n', registry.namespace, ...args], input); }
function ssh(code) { return execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], code); }
function accessVault() {
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
  const environment = { ...process.env, BW_SECRET: stored.BW_SECRET, BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0') };
  const call = (args, input) => {
    const result = spawnSync(binary, args, { input, encoding: 'utf8', env: environment, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Vault operation failed; sensitive output suppressed');
    return result.stdout.trim();
  };
  environment.BW_SESSION = call(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
  call(['sync']);
  const item = JSON.parse(call(['get', 'item', '6fbf8cf7-3871-4cfa-9a71-af7f00009fa4']));
  assert(item.name === 'ARR Access' && item.login?.username && item.login?.password, 'Expected Arr vault credentials missing');
  return { item, call };
}
const common = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Arr batch failed: '.$error->getMessage().PHP_EOL);exit(1);});
$registry=json_decode(base64_decode('REGISTRY'),true,512,JSON_THROW_ON_ERROR);$directory=$registry['private_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native operation failed');return trim($output);}
function privateFile($file,$contents){check(file_put_contents($file,$contents)!==false,'Private write failed');check(chmod($file,0600),'Private mode failed');}
function source($app){$container=json_decode(run(['docker','inspect',$app['container']]),true,512,JSON_THROW_ON_ERROR)[0];check($container['Image']===$app['image_id'],'Source image changed');return $container;}
function summary($database){$result=$database->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");$tables=[];while($row=$result->fetchArray(SQLITE3_ASSOC)){$name=str_replace('"','""',$row['name']);$tables[$row['name']]=$database->querySingle('SELECT count(*) FROM "'.$name.'"');}return $tables;}
function request($url,$key,$method='GET',$body=null){$handle=curl_init($url);curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>45,CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Api-Key: '.$key]]);if($body!==null)curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($body));$output=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($output!==false&&$status>=200&&$status<300,'Native API failed: '.parse_url($url,PHP_URL_PATH).' (HTTP '.$status.')');return $output!==''?json_decode($output,true):null;}
`.replace('REGISTRY', Buffer.from(JSON.stringify(registry)).toString('base64'));
function paused(allowSeeder = false) {
  const deployments = JSON.parse(kubectl(['get', 'deployments', '-o', 'json'])).items;
  assert.equal(deployments.length, 7);
  assert.ok(deployments.every(deployment => deployment.spec.replicas === 0), 'All seven workloads must be paused.');
  const pods = JSON.parse(kubectl(['get', 'pods', '-o', 'json'])).items;
  assert.ok(pods.every(pod => allowSeeder && pod.metadata.name === 'arr-batch-data-seed' && pod.metadata.labels['owl.red/migration'] === 'arr-batch'), 'No cluster application writer may remain.');
}
function bazarrSettings(yaml) {
  return JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', 'import json,sys,yaml; settings=yaml.safe_load(sys.stdin); print(json.dumps({"apiKey":settings["auth"]["apikey"]}))'], yaml));
}
function bazarrPeers(yaml) {
  return execute(path.join(repository, '.venv/bin/python'), ['-c', [
    'import sys,yaml',
    'settings=yaml.safe_load(sys.stdin)',
    "for kind,port,uhd in [('sonarr',8989,18989),('radarr',7878,17878)]:",
    '    server=settings[kind]',
    "    previous=str(server.get('ip',''))",
    "    if previous in ['sonarr_fhd','sonarr_uhd','radarr_fhd','radarr_uhd','nas.owl.red','10.0.10.5',kind+'-fhd',kind+'-uhd']:",
    "        selected='uhd' if int(server.get('port',port))==uhd or 'uhd' in previous else 'fhd'",
    "        server['ip']=kind+'-'+selected+'.arr.svc.cluster.local'",
    "        server['port']=port",
    'print(yaml.safe_dump(settings,sort_keys=False))',
  ].join('\n')], yaml);
}
async function main() {
  if (phase === 'update-access-urls') {
    assert.equal(process.env.ARR_REPAIR_ALLOWED, 'true', 'Explicit Arr repair approval required');
    const { item, call } = accessVault();
    const before = fs.mkdtempSync(path.join(home, '.local/state/owl-red/arr-vault-'));
    fs.writeFileSync(path.join(before, 'arr-access-before.json'), JSON.stringify(item), { mode: 0o600 });
    const uris = Object.values(registry.applications).filter(app => app.kind !== 'bazarr').map(app => ({ uri: 'https://' + app.hostname, match: null }));
    const updated = { ...item, login: { ...item.login, uris } };
    call(['edit', 'item', item.id], Buffer.from(JSON.stringify(updated)).toString('base64') + '\n');
    const verified = JSON.parse(call(['get', 'item', item.id]));
    assert.equal(verified.login.password, item.login.password);
    assert.equal(verified.login.username, item.login.username);
    assert.deepEqual(verified.login.uris.map(entry => entry.uri), uris.map(entry => entry.uri));
    console.log(JSON.stringify({ vaultItem: item.name, credentialsUnchanged: true, urls: uris.map(entry => entry.uri) }));
    return;
  }
  if (['inspect-integrations', 'repair-downloaders', 'repair-prowlarr', 'repair-access', 'sync-indexers', 'verify-integrations', 'verify-app-connections'].includes(phase)) {
    const repairing = !['inspect-integrations', 'verify-integrations', 'verify-app-connections'].includes(phase);
    if (repairing) assert.equal(process.env.ARR_REPAIR_ALLOWED, 'true', 'Explicit Arr repair approval required');
    const recovery = repairing ? fs.mkdtempSync(path.join(home, '.local/state/owl-red/arr-integrations-')) : null;
    const access = phase === 'repair-access' ? accessVault().item.login : null;
    const safeFields = fields => (fields || []).filter(field => /^(host|port|useSsl|urlBase|baseUrl|proxyType|proxyHost|proxyPort)$/.test(field.name)).map(field => ({ name: field.name, value: field.value }));
    for (const [name, app] of Object.entries(registry.applications)) {
      if (app.kind === 'bazarr') continue;
      if (['repair-prowlarr', 'sync-indexers'].includes(phase) && app.kind !== 'prowlarr') continue;
      const xml = kubectl(['exec', 'deployment/' + name, '-c', name, '--', 'cat', app.mount + '/config.xml']);
      const config = JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', 'import json,sys,xml.etree.ElementTree as ET; root=ET.fromstring(sys.stdin.read()); print(json.dumps({name:root.findtext(name) for name in ["ApiKey","UrlBase","Port","AuthenticationMethod","AuthenticationRequired"]}))'], xml));
      const native = (route, method = 'GET', body) => {
        const settings = ['url = "http://127.0.0.1:' + app.port + (config.UrlBase || '') + '/api/' + app.api + route + '"', 'header = "X-Api-Key: ' + config.ApiKey + '"', 'header = "Content-Type: application/json"', 'request = "' + method + '"'];
        if (body !== undefined) settings.push('data = ' + JSON.stringify(JSON.stringify(body)));
        const output = kubectl(['exec', '-i', 'deployment/' + name, '-c', name, '--', 'curl', '--fail-with-body', '--silent', '--max-time', '120', '--config', '-'], settings.join('\n'));
        return output ? JSON.parse(output) : null;
      };
      if (phase === 'sync-indexers') {
        const peers = native('/applications');
        fs.writeFileSync(path.join(recovery, 'prowlarr-applications-before-sync.json'), JSON.stringify(peers), { mode: 0o600 });
        for (const peer of peers) native('/applications/test', 'POST', peer);
        const command = native('/command', 'POST', { name: 'ApplicationIndexerSync', forceSync: true });
        console.log(JSON.stringify({ application: name, applicationPeersTested: peers.length, syncCommandId: command.id, syncStatus: command.status }));
        continue;
      }
      if (phase === 'repair-access') {
        const loginWorks = () => {
          const settings = ['url = "http://127.0.0.1:' + app.port + (config.UrlBase || '') + '/login"', 'header = "Content-Type: application/x-www-form-urlencoded"', 'data = ' + JSON.stringify(new URLSearchParams({ username: access.username, password: access.password, rememberMe: 'on' }).toString())];
          const headers = kubectl(['exec', '-i', 'deployment/' + name, '-c', name, '--', 'curl', '--silent', '--max-time', '20', '--dump-header', '-', '--output', '/dev/null', '--config', '-'], settings.join('\n'));
          return /^set-cookie:.*(?:Auth|AspNetCore)/im.test(headers) && !/loginFailed=true/i.test(headers);
        };
        const before = loginWorks();
        if (!before) {
          const host = native('/config/host');
          assert('username' in host && 'password' in host, 'Native host settings do not expose supported credential fields');
          fs.writeFileSync(path.join(recovery, name + '-host-before.json'), JSON.stringify(host), { mode: 0o600 });
          host.username = access.username;
          host.password = access.password;
          host.passwordConfirmation = access.password;
          if (host.allowedHosts === '') host.allowedHosts = [app.hostname, name, name + '.arr.svc.cluster.local', 'localhost', '127.0.0.1'].join(',');
          native('/config/host', 'PUT', host);
          assert(loginWorks(), name + ' vault login verification failed');
        }
        console.log(JSON.stringify({ application: name, vaultLoginVerified: true, existingLoginPreserved: before }));
        continue;
      }
      if (phase === 'repair-prowlarr') {
        const host = native('/config/host');
        fs.writeFileSync(path.join(recovery, 'prowlarr-host-before.json'), JSON.stringify(host), { mode: 0o600 });
        Object.assign(host, { proxyEnabled: true, proxyType: 'http', proxyHostname: 'gluetun-proxy.qbittorrent.svc.cluster.local', proxyPort: 8888, proxyUsername: '', proxyPassword: '', proxyBypassFilter: '\\.svc\\.cluster\\.local', proxyBypassLocalAddresses: true });
        if (host.allowedHosts === '') host.allowedHosts = [app.hostname, name, name + '.arr.svc.cluster.local', 'localhost', '127.0.0.1'].join(',');
        native('/config/host', 'PUT', host);
        for (const proxy of native('/indexerproxy').filter(proxy => proxy.implementation === 'FlareSolverr')) {
          fs.writeFileSync(path.join(recovery, 'prowlarr-proxy-' + proxy.id + '-before.json'), JSON.stringify(proxy), { mode: 0o600 });
          proxy.fields.find(field => field.name === 'host').value = 'http://flaresolverr.flaresolverr.svc.cluster.local:8191';
          native('/indexerproxy/test', 'POST', proxy);
          native('/indexerproxy/' + proxy.id, 'PUT', proxy);
        }
        console.log(JSON.stringify({ application: name, gluetunProxyEnabled: true, solverNativeTestPassed: true, internalServiceBypass: true }));
        continue;
      }
      const clients = native('/downloadclient');
      if (['verify-integrations', 'verify-app-connections'].includes(phase)) {
        for (const client of clients.filter(client => client.implementation === 'QBittorrent' && client.enable)) {
          native('/downloadclient/test', 'POST', client);
          console.log(JSON.stringify({ application: name, qBittorrentNativeTestPassed: true }));
        }
        if (phase === 'verify-app-connections' && app.kind !== 'prowlarr') {
          const indexer = native('/indexer').find(indexer => /The Pirate Bay|YTS/.test(indexer.name));
          assert(indexer, name + ' has no known-working synced indexer to verify');
          native('/indexer/test', 'POST', indexer);
          console.log(JSON.stringify({ application: name, indexer: indexer.name, downstreamNativeIndexerTestPassed: true }));
        }
        if (phase === 'verify-integrations' && app.kind === 'prowlarr') {
          let failures = 0;
          for (const indexer of native('/indexer').filter(indexer => indexer.enable)) {
            try {
              native('/indexer/test', 'POST', indexer);
              console.log(JSON.stringify({ application: name, indexer: indexer.name, nativeTestPassed: true }));
            } catch (error) {
              failures++;
              console.log(JSON.stringify({ application: name, indexer: indexer.name, nativeTestPassed: false, diagnostics: error.message }));
            }
          }
          if (failures) process.exitCode = 1;
        }
        continue;
      }
      if (phase === 'repair-downloaders') {
        fs.writeFileSync(path.join(recovery, name + '-downloadclients.json'), JSON.stringify(clients), { mode: 0o600 });
        for (const client of clients.filter(client => client.implementation === 'QBittorrent' && client.enable)) {
          const host = client.fields.find(field => field.name === 'host');
          assert(host, 'qBittorrent host field missing');
          host.value = 'qbittorrent.qbittorrent.svc.cluster.local';
          await native('/downloadclient/test', 'POST', client);
          await native('/downloadclient/' + client.id, 'PUT', client);
          console.log(JSON.stringify({ application: name, qBittorrentNativeTestPassed: true, endpoint: host.value, credentialsAndCategoriesPreserved: true }));
        }
        continue;
      }
      console.log(JSON.stringify({ application: name, authenticationMethod: config.AuthenticationMethod, health: native('/health').map(item => ({ source: item.source, message: item.message })), downloadClients: clients.map(client => ({ id: client.id, name: client.name, implementation: client.implementation, enable: client.enable, fields: safeFields(client.fields) })) }));
      if (app.kind !== 'prowlarr') console.log(JSON.stringify({ application: name, indexers: native('/indexer').map(indexer => ({ id: indexer.id, name: indexer.name, fields: safeFields(indexer.fields) })) }));
      if (app.kind === 'prowlarr') {
        const host = native('/config/host');
        console.log(JSON.stringify({ application: name, applicationPeers: native('/applications').map(peer => ({ name: peer.name, syncLevel: peer.syncLevel, tags: peer.tags, fields: safeFields(peer.fields), categories: peer.fields.find(field => field.name === 'syncCategories')?.value })), publicIndexerUrlFields: native('/indexer').filter(indexer => ['1337x', 'Nyaa.si', 'RuTracker'].includes(indexer.name)).map(indexer => ({ name: indexer.name, tags: indexer.tags, fields: indexer.fields.filter(field => field.name === 'baseUrl') })) }));
        console.log(JSON.stringify({ application: name, proxySettings: Object.fromEntries(Object.entries(host).filter(([key]) => /^proxy/.test(key) && !/password|username/i.test(key))), indexers: native('/indexer').map(indexer => ({ id: indexer.id, name: indexer.name, enable: indexer.enable, fields: safeFields(indexer.fields), advertisedBaseUrls: indexer.fields.find(field => field.name === 'baseUrl')?.selectOptions })), proxies: native('/indexerproxy').map(proxy => ({ id: proxy.id, name: proxy.name, implementation: proxy.implementation, fields: safeFields(proxy.fields) })), indexerStatus: native('/indexerstatus') }));
      }
    }
    return;
  }
  if (phase === 'retire') {
    const deployments = JSON.parse(kubectl(['get', 'deployments', '-o', 'json'])).items;
    assert.equal(deployments.length, 7);
    assert.ok(deployments.every(app => app.status.availableReplicas === 1), 'Accept all seven cluster workloads before retiring boot entries.');
    console.log(ssh(common + String.raw`
foreach($registry['applications'] as $app)check(!source($app)['State']['Running'],'NAS writer must be stopped');$file='/boot/config/plugins/dockerMan/autostart';$removed=0;if(is_file($file)){$before=file_get_contents($file);if(!is_file($directory.'/autostart-before.txt'))privateFile($directory.'/autostart-before.txt',$before);$names=array_column($registry['applications'],'container');$lines=explode("\n",$before);$keep=[];foreach($lines as $line){$name=preg_split('/\s+/',trim($line))[0]??'';if(in_array($name,$names,true))$removed++;else $keep[]=$line;}if($removed)check(file_put_contents($file,implode("\n",$keep))!==false,'Boot autostart retirement failed');}echo json_encode(['retiredNasBootEntriesRemoved'=>$removed,'originalContainersAndFilesRetained'=>true]).PHP_EOL;
`));
    return;
  }
  if (phase === 'plan') {
    console.log(ssh(common + String.raw`
$summary=[];foreach($registry['applications'] as $name=>$app){$current=source($app);foreach($app['databases'] as $file)check(is_file($app['source'].'/'.$file),'Expected database missing: '.$name.'/'.$file);foreach($app['directories'] as $path)check(is_dir($app['source'].'/'.$path),'Expected config directory missing');$summary[]=['application'=>$name,'sourceRunning'=>$current['State']['Running'],'databases'=>count($app['databases']),'schemaConversion'=>false];}echo json_encode($summary).PHP_EOL;
`));
    return;
  }
  if (phase === 'stop') {
    paused();
    const originalBazarr = ssh(common + "echo file_get_contents($registry['applications']['bazarr']['source'].'/config/config.yaml');\n");
    const bazarr = bazarrSettings(originalBazarr);
    const preparedBazarr = bazarrPeers(originalBazarr);
    console.log(ssh(common + String.raw`
if(!is_dir($directory))mkdir($directory,0700,true);check(!is_file($directory.'/baseline.json'),'Final batch baseline already exists; inspect before retry');$baseline=[];
foreach($registry['applications'] as $app)check(source($app)['State']['Running'],'Expected all NAS sources running before batch stop');
foreach($registry['applications'] as $name=>$app){$current=source($app);privateFile($directory.'/'.$name.'-container-before.json',json_encode($current));run(['docker','stop','--time','60',$app['container']]);run(['docker','update','--restart','no',$app['container']]);}
foreach($registry['applications'] as $name=>$app){
 check(!source($app)['State']['Running'],'NAS writer failed to stop');$stage=$directory.'/'.$name.'/data';check(!file_exists($stage),'Data stage exists');mkdir($stage,0700,true);$baseline[$name]=['hashes'=>[],'tables'=>[]];
 if($app['kind']!=='bazarr'){$xml=simplexml_load_file($app['source'].'/config.xml');check((string)$xml->PostgresHost==='','Unexpected existing PostgreSQL configuration');$baseline[$name]['apiKey']=(string)$xml->ApiKey;$baseline[$name]['urlBase']=(string)$xml->UrlBase;privateFile($directory.'/'.$name.'-config-before.xml',file_get_contents($app['source'].'/config.xml'));}
 foreach($app['databases'] as $file){$target=$stage.'/'.$file;if(!is_dir(dirname($target)))mkdir(dirname($target),0700,true);$database=new SQLite3($app['source'].'/'.$file,SQLITE3_OPEN_READONLY);$copy=new SQLite3($target);check($database->backup($copy),'Native SQLite backup failed');check($copy->querySingle('PRAGMA quick_check')==='ok','Database integrity failed');$baseline[$name]['tables'][$file]=summary($copy);$copy->close();$database->close();chmod($target,0600);$baseline[$name]['hashes'][$file]=hash_file('sha256',$target);}
 if($app['kind']!=='bazarr'){$database=new SQLite3($stage.'/'.$app['databases'][0],SQLITE3_OPEN_READONLY);$users=$database->query('SELECT * FROM "Users" ORDER BY "Id"');$identities=[];while($user=$users->fetchArray(SQLITE3_ASSOC))$identities[]=array_intersect_key($user,array_flip(['Id','Username','Password','Salt']));$database->close();$baseline[$name]['users']=$identities;}
 run(['tar','-C',$stage,'-czf',$directory.'/'.$name.'/data.tgz','.']);chmod($directory.'/'.$name.'/data.tgz',0600);
 $root=$app['source'];privateFile($directory.'/'.$name.'-root-mode.json',json_encode(['uid'=>fileowner($root),'gid'=>filegroup($root),'mode'=>fileperms($root)&0777]));$paths=[$root];$iterator=new RecursiveIteratorIterator(new RecursiveCallbackFilterIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),function($entry)use($root,$app){if($entry->isLink())return false;if($app['kind']==='bazarr'&&$entry->getPathname()===$root.'/db')return false;return !preg_match('/\.(?:db|sqlite)(?:-wal|-shm)?$/',$entry->getFilename());}),RecursiveIteratorIterator::SELF_FIRST);foreach($iterator as $entry)$paths[]=$entry->getPathname();check(count($paths)<150000,'Permission scope too large');privateFile($directory.'/'.$name.'-acl-before.txt',run(['getfacl','-R','-p',$root]));foreach($paths as $file){$mode=fileperms($file)&0777;$required=is_dir($file)?0070:0060;if(filegroup($file)!==100)check(chgrp($file,'users'),'Config group failed');if(($mode&$required)!==$required)check(chmod($file,$mode|$required),'Config access failed');}
}
$file=$registry['applications']['bazarr']['source'].'/config/config.yaml';privateFile($directory.'/bazarr-before-peers.yaml',file_get_contents($file));check(file_put_contents($file,base64_decode('BAZARR_YAML'))!==false,'Bazarr endpoint update failed');
$baseline['bazarr']['apiKey']=base64_decode('BAZARR_KEY');privateFile($directory.'/baseline.json',json_encode($baseline,JSON_THROW_ON_ERROR));echo json_encode(['nasWritersStopped'=>7,'nativeDatabasesBackedUp'=>13,'sqliteIntegrityPassed'=>true,'ordinaryConfigsRemainOnNas'=>true]).PHP_EOL;
`.replace('BAZARR_KEY', Buffer.from(bazarr.apiKey).toString('base64')).replace('BAZARR_YAML', Buffer.from(preparedBazarr).toString('base64'))));
    return;
  }
  if (phase === 'seed') {
    paused(true);
    const baseline = JSON.parse(ssh(common + "echo file_get_contents($directory.'/baseline.json');\n"));
    const name = 'arr-batch-data-seed';
    const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: registry.namespace, labels: { 'owl.red/migration': 'arr-batch' } }, spec: { restartPolicy: 'Never', activeDeadlineSeconds: 900, automountServiceAccountToken: false, tolerations: [{ key: 'node-role.kubernetes.io/control-plane', operator: 'Exists', effect: 'NoSchedule' }], securityContext: { seccompProfile: { type: 'RuntimeDefault' } }, containers: [{ name: 'seed', image: 'tautulli/tautulli@sha256:a4323bc09b27e265e269d79421ed3eb795083ef988bb84788eba89e5738c8005', command: ['/bin/sh', '-ec', 'exec tail -f /dev/null'], securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'], add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER'] } }, volumeMounts: Object.keys(registry.applications).map(name => ({ name, mountPath: '/seed/' + name })) }], volumes: Object.keys(registry.applications).map(name => ({ name, persistentVolumeClaim: { claimName: name + '-data' } })) } };
    const existing = kubectl(['get', 'pod', name, '--ignore-not-found', '-o', 'json']);
    if (existing) assert.equal(JSON.parse(existing).metadata.labels['owl.red/migration'], 'arr-batch');
    else kubectl(['create', '-f', '-'], JSON.stringify(pod));
    kubectl(['wait', '--for=condition=Ready', 'pod/' + name, '--timeout=240s']);
    for (const [appName, app] of Object.entries(registry.applications)) {
      const marker = execute('kubectl', ['-n', registry.namespace, 'exec', name, '-c', 'seed', '--', '/bin/sh', '-c', 'if test -e /seed/' + appName + '/.owl-red-seeded; then echo seeded; else echo pending; fi']);
      if (marker !== 'seeded') {
        assert.match(appName, /^[a-z0-9-]+$/);
        const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/arr-transfer-'));
        const archive = path.join(directory, 'data.tgz');
        const output = fs.openSync(archive, 'wx', 0o600);
        let copied;
        try {
          copied = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'cat ' + registry.private_directory + '/' + appName + '/data.tgz'], { stdio: ['ignore', output, 'pipe'], encoding: 'utf8' });
        } finally { fs.closeSync(output); }
        assert.equal(copied.status, 0, 'Archive download failed: ' + appName);
        const input = fs.openSync(archive, 'r');
        let restored;
        try {
          restored = spawnSync('kubectl', ['-n', registry.namespace, 'exec', '-i', name, '-c', 'seed', '--', '/bin/sh', '-ec', 'tar --no-same-owner -xzf - -C /seed/' + appName + '; chown -R 99:100 /seed/' + appName], { stdio: [input, 'pipe', 'pipe'], encoding: 'utf8' });
        } finally { fs.closeSync(input); }
        assert.equal(restored.status, 0, 'Database restore failed: ' + appName);
        fs.unlinkSync(archive);
        fs.rmdirSync(directory);
      }
      for (const [file, expected] of Object.entries(baseline[appName].hashes)) {
        assert.ok(app.databases.includes(file));
        const actual = kubectl(['exec', name, '-c', 'seed', '--', 'sha256sum', '/seed/' + appName + '/' + file]).split(/\s+/)[0];
        assert.equal(actual, expected, 'Transferred database mismatch: ' + appName);
      }
      kubectl(['exec', name, '-c', 'seed', '--', 'touch', '/seed/' + appName + '/.owl-red-seeded']);
      console.log(JSON.stringify({ application: appName, databaseChecksumsMatch: true }));
    }
    kubectl(['delete', 'pod', name, '--wait=true']);
    return;
  }
  if (phase === 'verify') {
    const baseline = JSON.parse(ssh(common + "echo file_get_contents($directory.'/baseline.json');\n"));
    for (const [name, app] of Object.entries(registry.applications)) {
      const pods = JSON.parse(kubectl(['get', 'pods', '-l', 'app.kubernetes.io/name=' + name, '-o', 'json'])).items;
      assert.equal(pods.length, 1);
      const pod = pods[0];
      assert.ok(pod.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'), name + ' not ready');
      const apiPath = app.kind === 'bazarr' ? '/api/system/status' : (baseline[name].urlBase || '') + '/api/' + app.api + '/system/status';
      const response = kubectl(['exec', '-i', pod.metadata.name, '-c', name, '--', 'curl', '--fail', '--silent', '--max-time', '20', '--config', '-'], 'url = "http://127.0.0.1:' + app.port + apiPath + '"\nheader = "X-Api-Key: ' + baseline[name].apiKey + '"\n');
      assert.ok(JSON.parse(response), 'Native status endpoint did not return JSON.');
      console.log(JSON.stringify({ application: name, ready: true, existingApiKeyVerified: true, databaseStorage: 'longhorn-appdata' }));
    }
    console.log(ssh(common + "foreach($registry['applications'] as $app)check(run(['docker','ps','--quiet','--filter','name=^/'.$app['container'].'$'])==='','NAS writer restarted');echo json_encode(['allNasWritersStopped'=>true]).PHP_EOL;\n"));
    return;
  }
  if (phase === 'peers') {
    console.log(ssh(common + String.raw`
$baseline=json_decode(file_get_contents($directory.'/baseline.json'),true,512,JSON_THROW_ON_ERROR);
$seerr=json_decode(file_get_contents('/mnt/user/appdata/seerr/settings.json'),true);$seerrKey=$seerr['main']['apiKey'];
foreach(['sonarr','radarr'] as $kind){$url='https://seerr.owl.red/api/v1/settings/'.$kind;$servers=request($url,$seerrKey);if(!is_file($directory.'/seerr-'.$kind.'-before.json'))privateFile($directory.'/seerr-'.$kind.'-before.json',json_encode($servers));foreach($servers as $server){$id=$server['id'];check(in_array($id,[0,1],true),'Unexpected Seerr peer id');$name=$kind.($id===0?'-fhd':'-uhd');$server['hostname']=$name.'.arr.svc.cluster.local';$server['port']=$registry['applications'][$name]['port'];$server['useSsl']=false;unset($server['id']);request($url.'/test',$seerrKey,'POST',$server);request($url.'/'.$id,$seerrKey,'PUT',$server);}}
$file='/mnt/user/appdata/soularr/config.ini';if(!is_file($directory.'/soularr-before-peers.ini'))privateFile($directory.'/soularr-before-peers.ini',file_get_contents($file));echo json_encode(['seerrPeersUpdated'=>4,'integrationKeysPreserved'=>true]).PHP_EOL;
`));
    const baseline = JSON.parse(ssh(common + "echo file_get_contents($directory.'/baseline.json');\n"));
    const native = (name, route, method = 'GET', body) => {
      const app = registry.applications[name];
      const settings = ['url = "http://127.0.0.1:' + app.port + (baseline[name].urlBase || '') + '/api/' + app.api + route + '"', 'header = "X-Api-Key: ' + baseline[name].apiKey + '"', 'header = "Content-Type: application/json"', 'request = "' + method + '"'];
      if (body !== undefined) settings.push('data = ' + JSON.stringify(JSON.stringify(body)));
      const output = kubectl(['exec', '-i', 'deployment/' + name, '-c', name, '--', 'curl', '--fail', '--silent', '--max-time', '45', '--config', '-'], settings.join('\n'));
      return output ? JSON.parse(output) : null;
    };
    const clients = native('prowlarr', '/applications');
    console.log(ssh(common + "if(!is_file($directory.'/prowlarr-applications-before.json'))privateFile($directory.'/prowlarr-applications-before.json',base64_decode('" + Buffer.from(JSON.stringify(clients)).toString('base64') + "'));echo json_encode(['prowlarrPeerPreimageSaved'=>true]).PHP_EOL;\n"));
    for (const client of clients) {
      for (const field of client.fields) {
        if (field.name === 'prowlarrUrl') field.value = 'http://prowlarr.arr.svc.cluster.local:9696';
        if (field.name !== 'baseUrl') continue;
        const previous = new URL(field.value);
        const target = Object.entries(registry.applications).find(([, app]) => previous.hostname === app.container || (['nas.owl.red', '10.0.10.5'].includes(previous.hostname) && Number(previous.port) === (app.source_port || app.port)));
        if (target) field.value = 'http://' + target[0] + '.arr.svc.cluster.local:' + target[1].port;
      }
      native('prowlarr', '/applications/test', 'POST', client);
      native('prowlarr', '/applications/' + client.id, 'PUT', client);
    }
    const soularr = ssh(common + "echo file_get_contents('/mnt/user/appdata/soularr/config.ini');\n");
    const patched = execute(path.join(repository, '.venv/bin/python'), ['-c', "import sys,configparser; settings=configparser.ConfigParser(interpolation=None); settings.read_string(sys.stdin.read()); settings['Lidarr']['host_url']='http://lidarr.arr.svc.cluster.local:8686'; settings.write(sys.stdout)"], soularr);
    console.log(ssh(common + "check(file_put_contents('/mnt/user/appdata/soularr/config.ini',base64_decode('" + Buffer.from(patched).toString('base64') + "'))!==false,'Soularr endpoint write failed');echo json_encode(['prowlarrApplicationPeersUpdated'=>" + clients.length + ",'soularrLidarrEndpointUpdated'=>true]).PHP_EOL;\n"));
    const service = JSON.parse(kubectl(['get', 'service', 'lidarr', '-o', 'json']));
    console.log(JSON.stringify({ soularrHostAliasRequired: { ip: service.spec.clusterIP, hostnames: ['lidarr.arr.svc.cluster.local'] } }));
    return;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });