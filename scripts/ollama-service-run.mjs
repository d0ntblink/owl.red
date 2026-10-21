import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const home = os.homedir();
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] || 'plan';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: repository, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/ollama-service-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Service operation failed; private diagnostics: ' + directory);
  }
  return result.stdout.trim();
}
async function secretWorker() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  const request = JSON.parse(text);
  const require = createRequire(import.meta.url);
  const sdk = require(path.join(home, '.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi'));
  const client = new sdk.BitwardenClient(undefined, 4);
  await client.auth().loginAccessToken(request.token);
  const organization = '202b0b27-b135-44cd-a969-b43a003ad670';
  const project = '89090d54-807a-4168-b063-b43a004ba0c1';
  const existing = (await client.secrets().list(organization)).data;
  async function entry(key, value) {
    const matches = existing.filter(secret => secret.key === key);
    ensure(matches.length <= 1, 'Duplicate service credential.');
    if (matches.length) return client.secrets().get(matches[0].id);
    ensure(request.create, 'Service credentials have not been prepared.');
    return client.secrets().create(organization, key, value(), 'Open WebUI / Ollama private service credential; preserve existing value.', [project]);
  }
  const backend = await entry('ollama__api-token', () => randomBytes(32).toString('hex'));
  const session = await entry('open-webui__secret-key', () => randomBytes(32).toString('hex'));
  const admin = await entry('open-webui__admin-password', () => randomBytes(24).toString('base64url'));
  const apiConfigs = await entry('open-webui__ollama-api-configs', () => JSON.stringify({ 0: { enable: true, key: backend.value, auth_type: 'bearer' } }));
  ensure(JSON.parse(apiConfigs.value)['0'].key === backend.value, 'Stored backend API config differs; rotation refused.');
  process.stdout.write(JSON.stringify({ backend, session, admin, apiConfigs }));
}
async function combined(config) {
  const service = config.service;
  ensure(service?.image?.startsWith('d0ntblink/open-webui-ollama:') && /@sha256:[a-f0-9]{64}$/.test(service.image), 'A pinned combined image is required.');
  ensure(service.configuration_directory === '/mnt/ssd/appdata/open-webui-service' && service.https_port === 11436, 'Unexpected combined service target.');
  const deployment = JSON.parse(execute('kubectl', ['-n', 'open-webui', 'get', 'deployment', 'open-webui', '-o', 'json']));
  const claim = JSON.parse(execute('kubectl', ['-n', 'open-webui', 'get', 'pvc', 'data', '-o', 'json']));
  const volume = JSON.parse(execute('kubectl', ['get', 'pv', claim.spec.volumeName, '-o', 'json']));
  ensure(volume.spec.csi.volumeAttributes.source === '//nas.owl.red/appdata' && service.data_directory === '/mnt/ssd/appdata/' + volume.spec.csi.volumeAttributes.subDir, 'The retained WebUI volume does not match.');
  if (phase === 'combined-apply') {
    const pods = JSON.parse(execute('kubectl', ['-n', 'open-webui', 'get', 'pods', '-l', 'app.kubernetes.io/name=open-webui', '-o', 'json']));
    ensure(deployment.spec.replicas === 0 && pods.items.length === 0, 'Stop the Fleet-managed WebUI writer before cutover.');
  }
  const runtime = JSON.parse(execute('kubectl', ['-n', 'open-webui', 'get', 'secret', 'open-webui-runtime', '-o', 'json']));
  const environment = Object.fromEntries(deployment.spec.template.spec.containers[0].env.map(entry => [entry.name, entry.value]));
  for (const [key, value] of Object.entries(runtime.data)) environment[key] = Buffer.from(value, 'base64').toString();
  Object.assign(environment, { OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_BASE_URLS: 'http://127.0.0.1:11434', OLLAMA_API_CONFIGS: '{"0":{"enable":true}}', OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: '/root/.ollama/models', OLLAMA_KEEP_ALIVE: '0', OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_CONTEXT_LENGTH: '4096', OLLAMA_MAX_QUEUE: '8', OLLAMA_NO_CLOUD: '1', USE_OLLAMA_DOCKER: 'true', FORWARDED_ALLOW_IPS: '*', HF_HOME: '/tmp/huggingface' });
  ensure(Object.values(environment).every(value => typeof value === 'string' && !/[\r\n]/.test(value)), 'Unsupported multiline runtime value.');
  const tls = JSON.parse(execute('kubectl', ['-n', 'home-assistant', 'get', 'secret', 'frigate-tls', '-o', 'json']));
  const certificate = Buffer.from(tls.data['tls.crt'], 'base64').toString();
  const privateKey = Buffer.from(tls.data['tls.key'], 'base64').toString();
  const identity = new X509Certificate(certificate);
  ensure(identity.checkHost('nas.owl.red') && identity.checkPrivateKey(createPrivateKey(privateKey)) && Date.parse(identity.validTo) > Date.now() + 7 * 86400000, 'Valid NAS TLS material is required.');
  if (['combined-configure', 'combined-verify', 'combined-restore-connection'].includes(phase)) {
    const endpoint = 'https://nas.owl.red:' + service.https_port;
    async function api(route, method = 'GET', token, body) {
      const response = await fetch(endpoint + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
      ensure(response.ok, 'Native WebUI operation failed: ' + route + ' (HTTP ' + response.status + ').');
      return response.json();
    }
    const login = await api('/api/v1/auths/signin', 'POST', undefined, { email: environment.WEBUI_ADMIN_EMAIL, password: environment.WEBUI_ADMIN_PASSWORD });
    ensure(login.token && login.role === 'admin', 'Existing owner login failed.');
    const connection = await api('/ollama/config', 'GET', login.token);
    const localUrl = 'http://127.0.0.1:11434';
    if (['combined-configure', 'combined-restore-connection'].includes(phase)) {
      const snapshot = path.join(home, '.local/state/owl-red/open-webui-connection-before.json');
      if (!fs.existsSync(snapshot)) fs.writeFileSync(snapshot, JSON.stringify(connection), { mode: 0o600 });
      const desired = phase === 'combined-configure' ? { ENABLE_OLLAMA_API: true, OLLAMA_BASE_URLS: [localUrl], OLLAMA_API_CONFIGS: { 0: { enable: true } } } : JSON.parse(fs.readFileSync(snapshot, 'utf8'));
      await api('/ollama/config/update', 'POST', login.token, desired);
      console.log(JSON.stringify({ existingOwnerVerified: true, savedConnectionUpdatedThroughNativeApi: true, originalConnectionRestored: phase === 'combined-restore-connection' }));
      return;
    }
    ensure(connection.OLLAMA_BASE_URLS.length === 1 && connection.OLLAMA_BASE_URLS[0] === localUrl, 'WebUI is not using its bundled model server.');
    const models = await api('/api/models', 'GET', login.token);
    ensure(Object.values(config.profiles).every(profile => models.data.some(model => model.id === profile.model)), 'Pinned model choices unavailable.');
    const unauthenticated = await fetch(endpoint + '/api/models', { signal: AbortSignal.timeout(10000) });
    ensure([401, 403].includes(unauthenticated.status), 'Unauthenticated API access was not denied.');
    const existingKey = await fetch(endpoint + '/api/v1/auths/api_key', { headers: { Authorization: 'Bearer ' + login.token }, signal: AbortSignal.timeout(10000) });
    ensure(existingKey.ok || existingKey.status === 404, 'Native API key inspection failed.');
    const created = existingKey.status === 404;
    const key = created ? (await api('/api/v1/auths/api_key', 'POST', login.token)).api_key : (await existingKey.json()).api_key;
    const ssh = command => execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', command]);
    try {
      const before = Number(ssh('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits'));
      const application = JSON.parse(ssh("docker inspect --format '{{json .State}}' open-webui"));
      const generation = await fetch(endpoint + '/api/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Explain why event retention in days does not impose a fixed disk quota. Use one short paragraph.' }], stream: true, params: { num_ctx: 4096, num_predict: 160, keep_alive: 0, temperature: 0.1 } }), signal: AbortSignal.timeout(180000) });
      ensure(generation.ok, 'Combined native API inference failed.');
      const during = JSON.parse(ssh('docker exec open-webui curl --fail --silent http://127.0.0.1:11434/api/ps'));
      ensure(during.models.some(model => model.size_vram > 0), 'Actual bundled GPU inference was not observed.');
      let stream = '';
      for await (const chunk of generation.body) stream += Buffer.from(chunk).toString();
      const events = stream.split('\n').filter(line => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]').map(line => JSON.parse(line.slice(5).trim()));
      ensure(events.some(event => event.choices?.[0]?.delta?.content?.trim()), 'Combined WebUI returned no generated text.');
      const loaded = JSON.parse(ssh('docker exec open-webui curl --fail --silent http://127.0.0.1:11434/api/ps'));
      const after = Number(ssh('nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits'));
      const current = JSON.parse(ssh("docker inspect --format '{{json .State}}' open-webui"));
      ensure(loaded.models.length === 0 && after <= before + 32 && current.Running && current.Pid === application.Pid, 'Combined idle GPU release failed.');
      console.log(JSON.stringify({ existingOwnerVerified: true, nativeApiKeyVerified: true, bundledGpuInferenceVerified: true, beforeMiB: before, afterMiB: after, loadedModelsAfter: 0, applicationStayedRunning: true, unauthenticatedDenied: true }));
    } finally { if (created) await api('/api/v1/auths/api_key', 'DELETE', login.token); }
    return;
  }
  const nginx = `events {}\nhttp {\n access_log off;\n map $http_upgrade $connection_upgrade { default upgrade; '' close; }\n server {\n  listen 8443 ssl;\n  ssl_certificate /tls/fullchain.pem;\n  ssl_certificate_key /tls/privkey.pem;\n  client_max_body_size 1m;\n  location / {\n   proxy_pass http://open-webui:8080;\n   proxy_http_version 1.1;\n   proxy_set_header Host $host;\n   proxy_set_header X-Forwarded-Proto https;\n   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n   proxy_set_header Upgrade $http_upgrade;\n   proxy_set_header Connection $connection_upgrade;\n   proxy_buffering off;\n   proxy_read_timeout 600s;\n  }\n }\n}\n`;
  const payload = { phase, config, files: { 'runtime.env': Object.entries(environment).map(([key, value]) => key + '=' + value).join('\n') + '\n', 'nginx.conf': nginx, 'fullchain.pem': certificate, 'privkey.pem': privateKey } };
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Combined service operation failed: '.$error->getMessage().PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$config=$request['config'];$service=$config['service'];$base=$service['configuration_directory'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native command failed: '.($args[0]??'unknown'));return trim($output);}
function container($name,$component){$found=run(['docker','ps','-a','--filter','name=^/'.$name.'$','--format','{{.Names}}']);if(!$found)return null;$actual=json_decode(run(['docker','inspect',$name]),true)[0];check(($actual['Config']['Labels']['owl.red.component']??'')===$component,'Unmanaged container: '.$name);return $actual;}
check(run(['findmnt','-n','-o','TARGET','--target','/mnt/ssd'])==='/mnt/ssd','SSD not mounted');check(realpath($service['data_directory'])===$service['data_directory'],'Existing WebUI directory is required');check(is_file($config['model_directory'].'/.owl-red-llm'),'Model ownership marker missing');
$lock=fopen('/var/run/owl-red-llm.lock','c');check(flock($lock,LOCK_EX|LOCK_NB),'A diagnostic job is running');
$old=container('ollama','ollama');$application=container('open-webui','open-webui-ollama');$proxy=container('open-webui-https','open-webui-proxy');
if($application)check($application['Config']['Image']===$service['image'],'Combined application image differs; reviewed update required');
if(file_exists($base))check(is_dir($base)&&!is_link($base)&&is_file($base.'/.owl-red-open-webui'),'Unmanaged service directory');
if($request['phase']==='combined-plan'){echo json_encode(['image'=>$service['image'],'existingDataReused'=>true,'combinedExists'=>(bool)$application,'oldBackendRunning'=>$old['State']['Running']??false,'changed'=>false]).PHP_EOL;exit(0);}
if($request['phase']==='combined-prepare'){
 run(['docker','pull',$service['image']]);
 if(!is_dir($base)){mkdir($base,0700,true);file_put_contents($base.'/.owl-red-open-webui','open-webui-service');}
 foreach($request['files'] as $filename=>$value){$destination=$base.'/'.$filename;if(is_file($destination))check(file_get_contents($destination)===$value,'Prepared runtime changed; review required');else{file_put_contents($destination,$value);chmod($destination,0600);}}
 check((json_decode(run(['docker','network','inspect','owl-llm-proxy']),true)[0]['Labels']['owl.red.component']??'')==='llm-proxy-network','Owned proxy network required');
 run(['docker','run','--rm','--network','none','--entrypoint','/bin/ollama',$service['image'],'--version']);
 echo json_encode(['imagePulled'=>true,'privateRuntimePrepared'=>true,'liveServicesChanged'=>false]).PHP_EOL;exit(0);
}
if($request['phase']==='combined-apply'){
 foreach($request['files'] as $filename=>$value)check(is_file($base.'/'.$filename)&&file_get_contents($base.'/'.$filename)===$value,'Run combined-prepare with matching runtime first');
 if($old&&$old['State']['Running'])run(['docker','stop','--time','30','ollama']);
 try{
  if(!$application)run(['docker','run','-d','--name','open-webui','--restart','unless-stopped','--label','owl.red.component=open-webui-ollama','--network','owl-llm-proxy','--runtime','nvidia','--gpus','all','--user','0:100','--cpus',(string)$config['cpus'],'--memory',$config['memory_limit_mib'].'m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=268435456,mode=1777','--log-opt','max-size=10m','--log-opt','max-file=2','--env-file',$base.'/runtime.env','-v',$config['model_directory'].':/root/.ollama','-v',$service['data_directory'].':/app/backend/data',$service['image']]);
  elseif(!$application['State']['Running'])run(['docker','start','open-webui']);
  if(!$proxy)run(['docker','run','-d','--name','open-webui-https','--restart','unless-stopped','--label','owl.red.component=open-webui-proxy','--network','owl-llm-proxy','--cpus','0.25','--memory','128m','--security-opt','no-new-privileges:true','--cap-drop','NET_RAW','--log-opt','max-size=10m','--log-opt','max-file=2','-v',$base.'/nginx.conf:/etc/nginx/nginx.conf:ro','-v',$base.'/fullchain.pem:/tls/fullchain.pem:ro','-v',$base.'/privkey.pem:/tls/privkey.pem:ro','-p','10.0.10.5:'.$service['https_port'].':8443','nginx:1.28.1-alpine@sha256:52e3ada4d978443601f286cc2f9e7b95c82aa3ad5a78ce9c6b94ce00258e68cc']);
  elseif(!$proxy['State']['Running'])run(['docker','start','open-webui-https']);
 }catch(Throwable $error){if($application=container('open-webui','open-webui-ollama'))if($application['State']['Running'])run(['docker','stop','open-webui']);if($old)run(['docker','start','ollama']);throw $error;}
 echo json_encode(['combinedStarted'=>true,'oldBackendStopped'=>true,'endpoint'=>'https://nas.owl.red:'.$service['https_port'],'existingDataReused'=>true]).PHP_EOL;exit(0);
}
if($request['phase']==='combined-rollback'){
 if($proxy&&$proxy['State']['Running'])run(['docker','stop','open-webui-https']);
 if($application&&$application['State']['Running'])run(['docker','stop','--time','30','open-webui']);
 if($old&&!$old['State']['Running'])run(['docker','start','ollama']);
 echo json_encode(['combinedStopped'=>true,'oldBackendRestored'=>true,'dataDeleted'=>false]).PHP_EOL;
}
`;
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'root@10.0.10.5', 'php'], { input: php.replace('REQUEST', Buffer.from(JSON.stringify(payload)).toString('base64')) }));
}
async function main() {
  ensure(['prepare', 'plan', 'apply', 'verify', 'combined-plan', 'combined-prepare', 'combined-apply', 'combined-rollback', 'combined-configure', 'combined-verify', 'combined-restore-connection'].includes(phase), 'Unknown service phase.');
  const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/llm.json'), 'utf8'));
  ensure(config.host === '10.0.10.5' && config.model_directory === '/mnt/ssd/appdata/llm-models', 'Unexpected GPU/storage target.');
  ensure(config.image === 'ollama/ollama:0.40.7@sha256:2e6cc92ffa43b4b1a2e70e315407e00ac97ec125afc71277d73c7efe01c4f31b', 'Use the qualified backend image.');
  if (phase.startsWith('combined-')) return combined(config);
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  const secrets = JSON.parse(execute(process.execPath, [fileURLToPath(import.meta.url), '--secret-worker'], { input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, create: ['prepare', 'apply'].includes(phase) }) }));
  if (phase === 'prepare') {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(secrets).map(([name, secret]) => [name, { key: secret.key, id: secret.id }])), null, 2));
    return;
  }
  const tls = JSON.parse(execute('kubectl', ['-n', 'home-assistant', 'get', 'secret', 'frigate-tls', '-o', 'json']));
  const certificate = Buffer.from(tls.data['tls.crt'], 'base64').toString();
  const privateKey = Buffer.from(tls.data['tls.key'], 'base64').toString();
  const identity = new X509Certificate(certificate);
  ensure(identity.checkHost('nas.owl.red') && identity.checkPrivateKey(createPrivateKey(privateKey)) && Date.parse(identity.validTo) > Date.now() + 7 * 86400000, 'A valid NAS TLS identity is required.');
  const nginx = `events {}\nhttp {\n access_log off;\n server {\n  listen 8443 ssl;\n  ssl_certificate /tls/fullchain.pem;\n  ssl_certificate_key /tls/privkey.pem;\n  client_max_body_size 1m;\n  if ($http_authorization != "Bearer ${secrets.backend.value}") { return 401; }\n  location / {\n   proxy_pass http://ollama:11434;\n   proxy_set_header Authorization "";\n   proxy_http_version 1.1;\n   proxy_buffering off;\n   proxy_read_timeout 600s;\n  }\n }\n}\n`;
  const payload = { phase, config, nginx, certificate, privateKey };
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){$directory='/root/.local/state/owl-red/ollama-service-'.bin2hex(random_bytes(6));mkdir($directory,0700,true);file_put_contents($directory.'/failure.log',$error->getMessage());chmod($directory.'/failure.log',0600);file_put_contents('php://stderr','Private NAS diagnostics: '.$directory.PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$config=$request['config'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);check(proc_close($process)===0,'Native command failed: '.($args[0]??'unknown'));return trim($output);}
check(trim(run(['findmnt','-n','-o','TARGET','--target','/mnt/ssd']))==='/mnt/ssd','Model SSD is not mounted');
check(is_file($config['model_directory'].'/.owl-red-llm'),'Existing model ownership marker is required');
$lock=fopen('/var/run/owl-red-llm.lock','c');check(flock($lock,LOCK_EX|LOCK_NB),'An inference job is already running');
check(trim(run(['docker','ps','-a','--filter','label=owl.red.component=llm-ephemeral','--format','{{.Names}}']))==='','Temporary inference workers are still present');
$base='/mnt/ssd/appdata/ollama-service';if(file_exists($base))check(is_dir($base)&&!is_link($base)&&is_file($base.'/.owl-red-ollama'),'Unmanaged service directory; adoption refused');
$expected=['ollama'=>'ollama','ollama-https'=>'ollama-proxy'];$present=[];
foreach($expected as $name=>$component){$raw=run(['docker','ps','-a','--filter','name=^/'.$name.'$','--format','{{json .}}']);if($raw){$actual=json_decode(run(['docker','inspect',$name]),true)[0];check(($actual['Config']['Labels']['owl.red.component']??'')===$component,'Unmanaged container; adoption refused');$present[$name]=$actual;}}
if($request['phase']==='plan'){echo json_encode(['backendExists'=>isset($present['ollama']),'proxyExists'=>isset($present['ollama-https']),'rawBackendPublished'=>false,'keepAlive'=>0]).PHP_EOL;exit(0);}
if($request['phase']==='apply'){
 if(!is_dir($base)){mkdir($base,0700,true);file_put_contents($base.'/.owl-red-ollama','ollama-service');}
 $values=['nginx.conf'=>$request['nginx'],'fullchain.pem'=>$request['certificate'],'privkey.pem'=>$request['privateKey']];
 foreach($values as $filename=>$value){$destination=$base.'/'.$filename;if(is_file($destination))check(file_get_contents($destination)===$value,'Service configuration changed; reviewed update required');else{file_put_contents($destination,$value);chmod($destination,0600);}}
 $network=run(['docker','network','ls','--filter','name=^owl-llm$','--format','{{.Name}}']);if(!$network)run(['docker','network','create','--internal','--label','owl.red.component=llm-network','owl-llm']);
 else check((json_decode(run(['docker','network','inspect','owl-llm']),true)[0]['Labels']['owl.red.component']??'')==='llm-network','Unmanaged network; adoption refused');
 if(!isset($present['ollama']))run(['docker','run','-d','--name','ollama','--restart','unless-stopped','--label','owl.red.component=ollama','--network','owl-llm','--runtime','nvidia','--gpus','all','--cpus','2','--memory','6144m','--cap-drop','ALL','--security-opt','no-new-privileges:true','--log-opt','max-size=10m','--log-opt','max-file=2','-e','OLLAMA_HOST=0.0.0.0:11434','-e','OLLAMA_KEEP_ALIVE=0','-e','OLLAMA_NUM_PARALLEL=1','-e','OLLAMA_MAX_LOADED_MODELS=1','-e','OLLAMA_MAX_QUEUE=8','-e','OLLAMA_CONTEXT_LENGTH=4096','-e','OLLAMA_NO_CLOUD=1','-v',$config['model_directory'].':/root/.ollama',$config['image']]);
 if(!isset($present['ollama-https'])){
  check(trim(run(['docker','ps','--filter','publish=11434','--format','{{.Names}}']))==='','HTTPS backend port is in use');
  run(['docker','run','--rm','--network','owl-llm','-v',$base.'/nginx.conf:/etc/nginx/nginx.conf:ro','-v',$base.':/tls:ro','nginx:1.28.1-alpine@sha256:52e3ada4d978443601f286cc2f9e7b95c82aa3ad5a78ce9c6b94ce00258e68cc','nginx','-t']);
  run(['docker','run','-d','--name','ollama-https','--restart','unless-stopped','--label','owl.red.component=ollama-proxy','--network','owl-llm','--cpus','0.25','--memory','128m','--cap-drop','NET_RAW','--security-opt','no-new-privileges:true','--log-opt','max-size=10m','--log-opt','max-file=2','-v',$base.'/nginx.conf:/etc/nginx/nginx.conf:ro','-v',$base.':/tls:ro','-p','10.0.10.5:11434:8443','nginx:1.28.1-alpine@sha256:52e3ada4d978443601f286cc2f9e7b95c82aa3ad5a78ce9c6b94ce00258e68cc']);
 }
 $proxyNetwork=run(['docker','network','ls','--filter','name=^owl-llm-proxy$','--format','{{.Name}}']);
 if(!$proxyNetwork)run(['docker','network','create','--label','owl.red.component=llm-proxy-network','owl-llm-proxy']);
 else check((json_decode(run(['docker','network','inspect','owl-llm-proxy']),true)[0]['Labels']['owl.red.component']??'')==='llm-proxy-network','Unmanaged proxy network; adoption refused');
 $proxy=json_decode(run(['docker','inspect','ollama-https']),true)[0];
 if(!isset($proxy['NetworkSettings']['Networks']['owl-llm-proxy']))run(['docker','network','connect','owl-llm-proxy','ollama-https']);
 echo json_encode(['backendStarted'=>true,'rawBackendPublished'=>false,'httpsProxy'=>'https://nas.owl.red:11434','keepAlive'=>0]).PHP_EOL;
}
`;
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'root@10.0.10.5', 'php'], { input: php.replace('REQUEST', Buffer.from(JSON.stringify(payload)).toString('base64')) }));
  if (phase === 'apply' || phase === 'verify') {
    const endpoint = 'https://nas.owl.red:11434';
    const unauthenticated = await fetch(endpoint + '/api/tags', { signal: AbortSignal.timeout(15000) });
    ensure(unauthenticated.status === 401, 'Unauthenticated backend access was not denied.');
    const response = await fetch(endpoint + '/api/tags', { headers: { Authorization: 'Bearer ' + secrets.backend.value }, signal: AbortSignal.timeout(15000) });
    ensure(response.ok, 'Authenticated backend request failed.');
    const models = await response.json();
    ensure(Object.values(config.profiles).every(profile => models.models.some(model => model.name === profile.model && model.digest === profile.digest)), 'Expected pinned models are missing.');
    console.log(JSON.stringify({ httpsVerified: true, unauthenticatedDenied: true, pinnedModelsAvailable: true }));
    if (phase === 'verify') {
      const headers = { Authorization: 'Bearer ' + secrets.backend.value, 'Content-Type': 'application/json' };
      const gpu = () => Number(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits']));
      const inspect = () => JSON.parse(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'docker inspect --format \'{{json .State}}\' ollama']));
      const before = gpu();
      const daemon = inspect();
      const generation = await fetch(endpoint + '/api/generate', { method: 'POST', headers, body: JSON.stringify({ model: config.model, prompt: 'Explain why a three-day event recording retention policy is not a hard storage quota. Use a concise paragraph.', stream: true, keep_alive: 0, options: { num_ctx: 4096, num_predict: 160, temperature: 0.1 } }), signal: AbortSignal.timeout(180000) });
      ensure(generation.ok, 'Persistent model inference failed.');
      const during = await fetch(endpoint + '/api/ps', { headers, signal: AbortSignal.timeout(10000) }).then(response => response.json());
      ensure(during.models.some(model => model.size_vram > 0), 'GPU model loading was not observed.');
      let output = '';
      for await (const chunk of generation.body) output += Buffer.from(chunk).toString();
      const completion = output.trim().split('\n').map(line => JSON.parse(line));
      ensure(completion.at(-1)?.done && completion.some(item => item.response?.trim()), 'Inference did not complete.');
      const loaded = await fetch(endpoint + '/api/ps', { headers, signal: AbortSignal.timeout(10000) }).then(response => response.json());
      const after = gpu();
      const current = inspect();
      ensure(loaded.models.length === 0 && after <= before + 32 && current.Running && daemon.Pid === current.Pid, 'Persistent-daemon GPU release check failed.');
      console.log(JSON.stringify({ inferenceCompleted: true, gpuInferenceObserved: true, beforeMiB: before, afterMiB: after, loadedModelsAfter: 0, daemonStayedRunning: true }));
    }
  }
}
try {
  if (phase === '--secret-worker') await secretWorker();
  else await main();
} catch (error) { console.error(phase === '--secret-worker' ? 'Private service credential operation failed; output withheld.' : error.message); process.exitCode = 1; }