import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const phase = process.argv[2] || 'plan';
const home = os.homedir();
let diagnostics;
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: repository, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    diagnostics ??= fs.mkdtempSync(path.join(home, '.local/state/owl-red/frigate-'));
    fs.writeFileSync(path.join(diagnostics, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Frigate operation failed; private diagnostics: ' + diagnostics);
  }
  return result.stdout.trim();
}

async function main() {
  ensure(['plan', 'qualify', 'apply', 'status', 'enable-foyer', 'qualify-ptz', 'enable-ptz', 'repair-yaml'].includes(phase), 'Use plan, qualify, apply, status, enable-foyer, qualify-ptz, enable-ptz or repair-yaml.');
  const target = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/frigate.json'), 'utf8'));
  ensure(target.host === '10.0.10.5' && target.container_name === 'frigate', 'Unexpected deployment target.');
  ensure(target.config_directory === '/mnt/ssd/appdata/frigate' && target.recordings_directory === '/mnt/cache/frigate', 'Use only the declared SSD paths.');
  ensure(/^ghcr.io\/blakeblackshear\/frigate:0\.18\.2-tensorrt@sha256:[a-f0-9]{64}$/.test(target.image), 'A reviewed immutable image is required.');
  ensure(target.retention_days === 3 && target.detector === 'openvino_cpu', 'Retention/detector changes require qualification.');
  ensure(target.recording_cache_mib === 512 && target.shared_memory_mib === 512 && target.memory_limit_mib === 3072 && target.cpus === 3, 'Preserve the bounded resource profile.');
  ensure(target.authenticated_port === 8971 && target.tls_hostname === 'nas.owl.red' && target.tls_secret === 'frigate-tls', 'Use authenticated, verified HTTPS only.');
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  if (phase === 'status') {
    const logs = execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@' + target.host, 'docker logs frigate']);
    const password = logs.match(/Password:\s+(\S+)\s+\*{3}/)?.[1];
    const secret = JSON.parse(execute(process.execPath, [fileURLToPath(import.meta.url), '--admin-worker'], { input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, password, key: target.admin_password_secret_key }) }));
    const endpoint = 'https://' + target.tls_hostname + ':' + target.authenticated_port;
    const response = await fetch(endpoint + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: secret.value }), signal: AbortSignal.timeout(15000) });
    ensure(response.ok, 'Verified HTTPS Frigate login failed: ' + response.status);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    ensure(cookie, 'Authenticated Frigate session is missing.');
    const statsResponse = await fetch(endpoint + '/api/stats', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
    ensure(statsResponse.ok, 'Authenticated Frigate metrics request failed.');
    const stats = await statsResponse.json();
    const ptz = {};
    for (const [name, camera] of Object.entries(target.cameras)) {
      if (!camera.onvif_enabled) continue;
      const infoResponse = await fetch(endpoint + '/api/' + name + '/ptz/info', { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) });
      ensure(infoResponse.ok, 'Authenticated PTZ capability request failed for ' + name);
      const info = await infoResponse.json();
      ensure(info.features?.includes('pt'), 'Frigate pan/tilt initialization failed for ' + name);
      ptz[name] = { features: info.features, presetCount: info.presets?.length || 0 };
    }
    console.log(JSON.stringify({ endpoint, username: 'admin', passwordSecretId: secret.id, passwordSecretKey: target.admin_password_secret_key, httpsVerified: true,
      cameras: Object.fromEntries(Object.entries(stats.cameras || {}).map(([name, camera]) => [name, { cameraFps: camera.camera_fps, processFps: camera.process_fps, skippedFps: camera.skipped_fps }])),
      detectors: Object.fromEntries(Object.entries(stats.detectors || {}).map(([name, detector]) => [name, { inferenceSpeed: detector.inference_speed }])), ptz }, null, 2));
    return;
  }
  if (phase === 'repair-yaml') {
    const yamlRepair = [
      'import json,os,uuid,yaml',
      'from pathlib import Path',
      'from frigate.config import FrigateConfig',
      "path=Path('/config/config.yml')",
      'original=path.read_text()',
      'before=yaml.safe_load(original)',
      "desired=yaml.safe_dump(before,sort_keys=False,default_flow_style=False)",
      "assert yaml.safe_load(desired)==before, 'All configuration values must be preserved'",
      'FrigateConfig.parse(desired)',
      'changed=original!=desired',
      'backup=None',
      'if changed:',
      "    backup=path.with_name('config.before-yaml-'+uuid.uuid4().hex+'.json')",
      '    backup.write_text(original); backup.chmod(0o600)',
      "    temporary=path.with_name('config.yaml-new.yml')",
      '    temporary.write_text(desired); temporary.chmod(0o600); os.replace(temporary,path)',
      'FrigateConfig.parse(path.read_text())',
      "print(json.dumps({'yamlEncodingRepaired':changed,'settingsPreserved':True,'uiStringParserValid':True,'faceRecognitionEnabled':before.get('face_recognition',{}).get('enabled',False),'privatePreimage':str(backup) if backup else None,'restartRequired':False}))",
    ].join('\n');
    const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
$request=json_decode(base64_decode('YAML_REQUEST'),true,512,JSON_THROW_ON_ERROR);
$inspect=[];$status=0;exec('docker inspect frigate',$inspect,$status);$container=json_decode(implode("\n",$inspect),true)[0]??null;
if($status||!$container['State']['Running']||$container['Config']['Image']!==$request['image']){file_put_contents('php://stderr','Existing qualified Frigate image required'.PHP_EOL);exit(1);}
$process=proc_open(['docker','exec','-i','frigate','python3','-c',$request['update']],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);
if(proc_close($process)!==0){$directory='/root/.local/state/owl-red/yaml-repair-'.bin2hex(random_bytes(4));mkdir($directory,0700,true);file_put_contents($directory.'/error.log',$output.$error);chmod($directory.'/error.log',0600);file_put_contents('php://stderr','YAML repair failed; private diagnostics: '.$directory.PHP_EOL);exit(1);}echo $output;
`;
    const request = Buffer.from(JSON.stringify({ image: target.image, update: yamlRepair })).toString('base64');
    console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@' + target.host, 'php'], { input: php.replace('YAML_REQUEST', request) }));
    return;
  }
  const credentials = id => JSON.parse(execute('bws', ['secret', 'get', id, '--output', 'json'], {
    env: { ...process.env, BWS_ACCESS_TOKEN: stored.BWS_ACCESS_TOKEN }
  })).value;
  if (['qualify-ptz', 'enable-ptz'].includes(phase)) {
    const cameras = {};
    for (const [name, camera] of Object.entries(target.cameras)) {
      ensure(camera.enabled && camera.host === ({ foyer: '10.0.40.12', office: '10.0.40.13' })[name] && camera.onvif_port === 80, 'Use only the two declared local ONVIF cameras.');
      const login = JSON.parse(credentials(camera.credential_secret_id));
      cameras[name] = { host: camera.host, port: camera.onvif_port, user: login.username, password: login.password };
    }
    const ptzUpdate = [
      'import asyncio,copy,json,os,sys,uuid,yaml',
      'from pathlib import Path',
      'from importlib.util import find_spec',
      'from onvif import ONVIFCamera',
      'from frigate.config import FrigateConfig',
      'request=json.load(sys.stdin)',
      'qualified={}',
      'async def qualify():',
      "    for name,camera in request['cameras'].items():",
      "        client=ONVIFCamera(camera['host'],camera['port'],camera['user'],camera['password'],wsdl_dir=str(Path(find_spec('onvif').origin).parent/'wsdl'),adjust_time=False,encrypt=True)",
      '        try:',
      '            await client.update_xaddrs()',
      "            client.get_definition('ptz')",
      '            media=await client.create_media_service()',
      '            profiles=await media.GetProfiles()',
      "            valid=[profile for profile in profiles if profile.VideoEncoderConfiguration and profile.PTZConfiguration and profile.PTZConfiguration.DefaultContinuousPanTiltVelocitySpace is not None]",
      "            assert valid, 'Continuous pan/tilt profile required'",
      '            ptz=await client.create_ptz_service()',
      "            await ptz.GetConfigurationOptions({'ConfigurationToken':valid[0].PTZConfiguration.token})",
      "            qualified[name]={'continuousPanTilt':True,'profileCount':len(valid),'timeAdjustment':False}",
      '        finally:',
      '            await client.close()',
      'asyncio.run(asyncio.wait_for(qualify(),timeout=60))',
      'changed=False',
      'backup=None',
      "if request['apply']:",
      "    path=Path('/config/config.yml')",
      '    before=yaml.safe_load(path.read_text())',
      '    after=copy.deepcopy(before)',
      "    for name,camera in request['cameras'].items():",
      "        assert before['cameras'][name].get('enabled',True), 'Expected enabled camera'",
      "        assert not before['cameras'][name].get('onvif',{}).get('autotracking',{}).get('enabled',False), 'Review existing autotracking before replacing ONVIF settings'",
      "        after['cameras'][name]['onvif']={**camera,'autotracking':{'enabled':False,'calibrate_on_startup':False}}",
      '    serialized=yaml.safe_dump(after,sort_keys=False,default_flow_style=False)',
      '    FrigateConfig.parse(serialized)',
      '    changed=after!=before',
      '    if changed:',
      "        backup=path.with_name('config.before-ptz-'+uuid.uuid4().hex+'.json')",
      '        backup.write_text(json.dumps(before,indent=2)); backup.chmod(0o600)',
      "        temporary=path.with_name('config.ptz-new.json')",
      '        temporary.write_text(serialized); temporary.chmod(0o600); os.replace(temporary,path)',
      "print(json.dumps({'qualified':qualified,'configChanged':changed,'autotracking':False,'motorCommandsSent':False,'privatePreimage':str(backup) if backup else None}))",
    ].join('\n');
    const request = Buffer.from(JSON.stringify({ cameras, update: ptzUpdate, image: target.image, apply: phase === 'enable-ptz' })).toString('base64');
    const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','ONVIF operation failed; private diagnostics required'.PHP_EOL);exit(1);});
$request=json_decode(base64_decode('PTZ_REQUEST'),true,512,JSON_THROW_ON_ERROR);
function run($args,$input=''){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fwrite($pipes[0],$input);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);if(proc_close($process)!==0){$directory='/root/.local/state/owl-red/ptz-enable-'.bin2hex(random_bytes(4));mkdir($directory,0700,true);file_put_contents($directory.'/error.log',$output.$error);chmod($directory.'/error.log',0600);throw new RuntimeException('Native ONVIF operation failed');}return trim($output);}
$container=json_decode(run(['docker','inspect','frigate']),true)[0];if(!$container['State']['Running']||$container['Config']['Image']!==$request['image'])throw new RuntimeException('Existing qualified Frigate image required');
$result=json_decode(run(['docker','exec','-i','frigate','python3','-c',$request['update']],json_encode(['cameras'=>$request['cameras'],'apply'=>$request['apply']])),true,512,JSON_THROW_ON_ERROR);echo json_encode($result).PHP_EOL;
if($result['configChanged']){run(['docker','restart','--time','30','frigate']);echo json_encode(['frigateRestartRequested'=>true]).PHP_EOL;}
`;
    console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@' + target.host, 'php'], { input: php.replace('PTZ_REQUEST', request) }));
    return;
  }
  if (phase === 'enable-foyer') {
    const camera = target.cameras.foyer;
    ensure(camera.host === '10.0.40.12', 'Unexpected foyer camera identity.');
    const login = JSON.parse(credentials(camera.credential_secret_id));
    const prefix = 'rtsp://' + encodeURIComponent(login.username) + ':' + encodeURIComponent(login.password) + '@' + camera.host + ':554/';
    const update = [
      'import copy,glob,json,os,subprocess,sys,uuid,yaml',
      'from pathlib import Path',
      'from frigate.config import FrigateConfig',
      'request=json.load(sys.stdin)',
      "path=Path('/config/config.yml')",
      'before=yaml.safe_load(path.read_text())',
      "assert 'office' in before['cameras'], 'Existing office camera required'",
      "assert not before['cameras'].get('foyer',{}).get('enabled',False), 'Foyer already enabled; inspect rather than overwrite'",
      "ffmpeg=sorted(glob.glob('/usr/lib/ffmpeg/*/bin/ffmpeg'))[-1]",
      "ffprobe=str(Path(ffmpeg).with_name('ffprobe'))",
      'profiles={}',
      "for channel in ['ch0','ch1']:",
      '    playlist="ffconcat version 1.0\\nfile \'"+request["prefix"]+channel+"\'\\noption rtsp_transport tcp\\noption timeout 5000000\\n"',
      "    common=['-v','error','-protocol_whitelist','file,pipe,tcp,udp,rtsp','-f','concat','-safe','0']",
      "    probe=subprocess.run([ffprobe,*common,'-i','pipe:0','-show_entries','stream=codec_name,width,height','-of','json'],input=playlist,text=True,capture_output=True,timeout=20)",
      "    if probe.returncode: raise RuntimeError('Private foyer stream probe failed; URL withheld')",
      "    video=next(stream for stream in json.loads(probe.stdout)['streams'] if stream.get('width'))",
      "    assert video['codec_name']=='h264', 'Expected qualified H264 stream'",
      "    decoded=subprocess.run([ffmpeg,'-hwaccel','cuda','-hwaccel_output_format','cuda',*common,'-i','pipe:0','-map','0:v:0','-vf','hwdownload,format=nv12','-frames:v','5','-an','-sn','-f','null','-'],input=playlist,text=True,capture_output=True,timeout=25)",
      "    if decoded.returncode: raise RuntimeError('Private foyer decode qualification failed; URL withheld')",
      '    profiles[channel]=video',
      'after=copy.deepcopy(before)',
      "after['cameras']['foyer']={'enabled':True,'ffmpeg':{'hwaccel_args':'preset-nvidia','inputs':[{'path':request['prefix']+'ch0','input_args':'preset-rtsp-generic','roles':['record']},{'path':request['prefix']+'ch1','input_args':'preset-rtsp-generic','roles':['detect']}]},'detect':{'enabled':True,'width':profiles['ch1']['width'],'height':profiles['ch1']['height'],'fps':5},'objects':{'track':['person']}}",
      "streams=after.setdefault('go2rtc',{}).setdefault('streams',{})",
      "assert 'foyer' not in streams and 'foyer_sub' not in streams, 'Review existing foyer restreams before replacing them'",
      "streams['foyer']=request['prefix']+'ch0'",
      "streams['foyer_sub']=request['prefix']+'ch1'",
      "assert after['cameras']['office']==before['cameras']['office'], 'Office configuration must remain unchanged'",
      'serialized=yaml.safe_dump(after,sort_keys=False,default_flow_style=False)',
      'FrigateConfig.parse(serialized)',
      "backup=path.with_name('config.before-foyer-'+uuid.uuid4().hex+'.json')",
      'backup.write_text(json.dumps(before,indent=2)); backup.chmod(0o600)',
      "temporary=path.with_name('config.foyer-new.json')",
      'temporary.write_text(serialized); temporary.chmod(0o600); os.replace(temporary,path)',
      "print(json.dumps({'foyerEnabled':True,'profiles':profiles,'officeConfigurationPreserved':True,'otherSettingsPreserved':True,'privatePreimage':str(backup)}))",
    ].join('\n');
    const request = Buffer.from(JSON.stringify({ prefix, update, image: target.image })).toString('base64');
    const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){file_put_contents('php://stderr','Foyer enable failed; private diagnostics required'.PHP_EOL);exit(1);});
$request=json_decode(base64_decode('FOYER_REQUEST'),true,512,JSON_THROW_ON_ERROR);
function run($args,$input=''){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fwrite($pipes[0],$input);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);if(proc_close($process)!==0){$directory='/root/.local/state/owl-red/foyer-enable-'.bin2hex(random_bytes(4));mkdir($directory,0700,true);file_put_contents($directory.'/error.log',$output.$error);chmod($directory.'/error.log',0600);throw new RuntimeException('Native operation failed');}return trim($output);}
$container=json_decode(run(['docker','inspect','frigate']),true)[0];if(!$container['State']['Running']||$container['Config']['Image']!==$request['image'])throw new RuntimeException('Existing qualified Frigate image required');
$protected=[];foreach(['/boot/config/shares/media.cfg','/boot/config/disk.cfg','/boot/config/super.dat','/boot/config/network.cfg'] as $file)$protected[$file]=hash_file('sha256',$file);
echo run(['docker','exec','-i','frigate','python3','-c',$request['update']],json_encode(['prefix'=>$request['prefix']])).PHP_EOL;
run(['docker','restart','--time','30','frigate']);foreach($protected as $file=>$hash)if(hash_file('sha256',$file)!==$hash)throw new RuntimeException('Protected NAS settings changed');echo json_encode(['frigateRestartRequested'=>true,'protectedNasSettingsPreserved'=>true]).PHP_EOL;
`;
    console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@' + target.host, 'php'], { input: php.replace('FOYER_REQUEST', request) }));
    return;
  }
  const cameras = {};
  const streams = {};
  for (const [name, camera] of Object.entries(target.cameras)) {
    ensure(['foyer', 'office'].includes(name) && ['10.0.40.12', '10.0.40.13'].includes(camera.host), 'Unexpected camera identity.');
    if (!camera.enabled) continue;
    ensure(camera.host === '10.0.40.13' || camera.stream_qualified === true, 'Qualify the foyer stream before enabling it.');
    const login = JSON.parse(credentials(camera.credential_secret_id));
    const prefix = 'rtsp://' + encodeURIComponent(login.username) + ':' + encodeURIComponent(login.password) + '@' + camera.host + ':554/';
    streams[name] = prefix + 'ch1';
    cameras[name] = {
      enabled: true,
      ffmpeg: { hwaccel_args: 'preset-nvidia', inputs: [
        { path: prefix + 'ch0', input_args: 'preset-rtsp-generic', roles: ['record'] },
        { path: prefix + 'ch1', input_args: 'preset-rtsp-generic', roles: ['detect'] }
      ] },
      detect: { enabled: true, width: 768, height: 432, fps: 5 },
      objects: { track: ['person'] }
    };
    if (camera.onvif_enabled) cameras[name].onvif = {
      host: camera.host, port: camera.onvif_port, user: login.username, password: login.password,
      autotracking: { enabled: false, calibrate_on_startup: false }
    };
  }
  ensure(Object.keys(cameras).length > 0, 'No qualified enabled cameras.');
  const config = {
    mqtt: { enabled: false }, auth: { enabled: true, cookie_secure: true }, tls: { enabled: true },
    detectors: { cpu: { type: 'openvino', device: 'CPU' } },
    model: { path: '/openvino-model/ssdlite_mobilenet_v2.xml', labelmap_path: '/openvino-model/coco_91cl_bkgr.txt', width: 300, height: 300, input_tensor: 'nhwc', input_pixel_format: 'bgr' },
    record: { enabled: true, continuous: { days: 0 }, motion: { days: 0 }, alerts: { pre_capture: 5, post_capture: 5, retain: { days: 3, mode: 'all' } }, detections: { pre_capture: 5, post_capture: 5, retain: { days: 3, mode: 'all' } } },
    snapshots: { enabled: true, retain: { default: 3 } }, birdseye: { enabled: false }, cameras
  };
  const configYaml = execute(path.join(repository, '.venv/bin/python'), ['-c', 'import sys,json,yaml; print(yaml.safe_dump(json.load(sys.stdin),sort_keys=False,default_flow_style=False),end="")'], { input: JSON.stringify(config) });
  const secret = JSON.parse(execute('kubectl', ['-n', 'home-assistant', 'get', 'secret', target.tls_secret, '-o', 'json']));
  const certificate = Buffer.from(secret.data['tls.crt'], 'base64').toString();
  const privateKey = Buffer.from(secret.data['tls.key'], 'base64').toString();
  const identity = new X509Certificate(certificate);
  ensure(identity.checkHost(target.tls_hostname) && identity.checkPrivateKey(createPrivateKey(privateKey)), 'TLS identity mismatch.');
  ensure(Date.parse(identity.validTo) > Date.now() + 7 * 86400000, 'TLS certificate needs renewal.');
  const qualification = String.raw`import json,sys,subprocess,glob
from pathlib import Path
from frigate.config import FrigateConfig
request=json.load(sys.stdin)
FrigateConfig.parse(request['config_yaml'])
ffmpeg=sorted(glob.glob('/usr/lib/ffmpeg/*/bin/ffmpeg'))[-1]
ffprobe=str(Path(ffmpeg).with_name('ffprobe'))
results=[]
for name,uri in request['streams'].items():
 playlist="ffconcat version 1.0\nfile '"+uri+"'\noption rtsp_transport tcp\noption timeout 5000000\n"
 common=['-v','error','-protocol_whitelist','file,pipe,tcp,udp,rtsp','-f','concat','-safe','0']
 result=subprocess.run([ffprobe,*common,'-i','pipe:0','-show_entries','stream=codec_name,width,height','-of','json'],input=playlist,text=True,capture_output=True,timeout=20)
 if result.returncode:raise RuntimeError('Private stream probe failed; URL withheld')
 video=next(stream for stream in json.loads(result.stdout)['streams'] if stream.get('width'))
 decoded=subprocess.run([ffmpeg,'-hwaccel','cuda','-hwaccel_output_format','cuda',*common,'-i','pipe:0','-map','0:v:0','-vf','hwdownload,format=nv12','-frames:v','5','-an','-sn','-f','null','-'],input=playlist,text=True,capture_output=True,timeout=25)
 if decoded.returncode:raise RuntimeError('GPU decode qualification failed; private details withheld')
 results.append({'camera':name,'width':video['width'],'height':video['height'],'gpuDecode':True})
print(json.dumps({'schemaValid':True,'streams':results}))
`;
  const request = { phase, target, config, config_yaml: configYaml, streams, qualification, certificate, privateKey, nonce: randomBytes(8).toString('hex') };
  const php = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){$directory='/root/.local/state/owl-red/frigate-failure-'.bin2hex(random_bytes(6));mkdir($directory,0700,true);file_put_contents($directory.'/failure.log',$error->getMessage()."\n".$error->getTraceAsString());chmod($directory.'/failure.log',0600);file_put_contents('php://stderr','Private NAS diagnostics: '.$directory.PHP_EOL);exit(1);});
set_error_handler(function($number,$message){throw new RuntimeException($message);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$target=$request['target'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args,$input=''){
 $process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);
 fwrite($pipes[0],$input);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);$code=proc_close($process);
 if($code){$directory='/root/.local/state/owl-red/frigate-failure-'.bin2hex(random_bytes(6));mkdir($directory,0700,true);file_put_contents($directory.'/failure.log',$output.$error);chmod($directory.'/failure.log',0600);throw new RuntimeException('Private NAS diagnostics: '.$directory);}
 return trim($output);
}
check(trim(run(['findmnt','-n','-o','TARGET','--target','/mnt/ssd']))==='/mnt/ssd','SSD pool is not mounted');
check(trim(run(['findmnt','-n','-o','TARGET','--target','/mnt/cache']))==='/mnt/cache','Cache SSD is not mounted');
check(disk_free_space('/mnt/cache')>$target['minimum_recordings_free_gib']*1073741824,'Recording SSD headroom is too low');
$existing=json_decode(run(['docker','ps','-a','--filter','name=^/frigate$','--format','{{json .}}'])?:'null',true);
if($existing){$container=json_decode(run(['docker','inspect','frigate']),true)[0];check(($container['Config']['Labels']['owl.red.component']??'')==='frigate','Unmanaged container; adoption refused');}
foreach([$target['config_directory'],$target['recordings_directory']] as $directory){if(file_exists($directory))check(is_dir($directory)&&!is_link($directory)&&is_file($directory.'/.owl-red-frigate'),'Unmanaged data directory; overwrite refused');}
$validation=json_decode(run(['docker','run','--rm','-i','--runtime','nvidia','--gpus','all','-e','NVIDIA_DRIVER_CAPABILITIES=compute,video,utility','--cpus','2','--memory','2g','--security-opt','no-new-privileges:true','--entrypoint','python3',$target['image'],'-c',$request['qualification']],json_encode(['config'=>$request['config'],'config_yaml'=>$request['config_yaml'],'streams'=>$request['streams']])),true);
echo json_encode($validation).PHP_EOL;
if($request['phase']!=='apply')exit(0);
if($existing){
 check($container['Config']['Image']===$target['image'],'Image replacement requires a reviewed migration');
 $filename=$target['config_directory'].'/config.yml';$previous=file_get_contents($filename);
 check(run(['docker','exec','-i','frigate','python3','-c','import json,sys,yaml; request=json.load(sys.stdin); print("true" if yaml.safe_load(request["current"])==request["desired"] else "false")'],json_encode(['current'=>$previous,'desired'=>$request['config']]))==='true','Existing Frigate settings differ; overwrite refused');
 $desired=$request['config_yaml'];
 if($previous!==$desired){copy($filename,$filename.'.before-'.$request['nonce']);file_put_contents($filename.'.new',$desired);chmod($filename.'.new',0600);rename($filename.'.new',$filename);run(['docker','restart','frigate']);}
 echo json_encode(['configurationEncodingReconciled'=>true,'changed'=>$previous!==$desired]).PHP_EOL;
 exit(0);
}
check(trim(run(['docker','ps','--filter','publish=8971','--format','{{.Names}}']))==='','HTTPS port is already in use');
$protected=[];foreach(['/boot/config/shares/media.cfg','/boot/config/disk.cfg','/boot/config/super.dat','/boot/config/network.cfg'] as $file)$protected[$file]=hash_file('sha256',$file);
$plex=json_decode(run(['docker','inspect','plex']),true)[0]['Id'];
foreach([$target['config_directory'],$target['recordings_directory']] as $directory){if(!is_dir($directory)){check(mkdir($directory,0700,true),'Cannot create owned data directory');file_put_contents($directory.'/.owl-red-frigate','frigate');}}
$base=$target['config_directory'];mkdir($base.'/tls',0700);
file_put_contents($base.'/config.yml',$request['config_yaml']);chmod($base.'/config.yml',0600);
file_put_contents($base.'/tls/fullchain.pem',$request['certificate']);chmod($base.'/tls/fullchain.pem',0600);
file_put_contents($base.'/tls/privkey.pem',$request['privateKey']);chmod($base.'/tls/privkey.pem',0600);
$name=run(['docker','run','-d','--name','frigate','--restart','unless-stopped','--stop-timeout','30','--label','owl.red.component=frigate','--label','net.unraid.docker.webui='.$target['webui'],'--label','net.unraid.docker.icon=https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/frigate.png','--runtime','nvidia','--gpus','all','-e','NVIDIA_DRIVER_CAPABILITIES=compute,video,utility','--security-opt','no-new-privileges:true','--cap-drop','NET_RAW','--cpus',(string)$target['cpus'],'--memory',$target['memory_limit_mib'].'m','--shm-size',$target['shared_memory_mib'].'m','--tmpfs','/tmp/cache:rw,noexec,nosuid,size='.$target['recording_cache_mib'].'m','--log-opt','max-size=10m','--log-opt','max-file=3','-v',$base.':/config','-v',$target['recordings_directory'].':/media/frigate','-v',$base.'/tls:/etc/letsencrypt/live/frigate:ro','-p','10.0.10.5:8971:8971',$target['image']]);
foreach($protected as $file=>$hash)check(hash_file('sha256',$file)===$hash,'Protected NAS configuration changed');
check(json_decode(run(['docker','inspect','plex']),true)[0]['Id']===$plex,'Plex identity changed');
echo json_encode(['containerStarted'=>true,'cameras'=>array_keys($request['config']['cameras']),'https'=>'https://nas.owl.red:8971','protectedConfigurationPreserved'=>true,'plexIdentityPreserved'=>true]).PHP_EOL;
`;
  console.log(execute('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'root@' + target.host, 'php'], {
    input: php.replace('REQUEST', Buffer.from(JSON.stringify(request)).toString('base64'))
  }));
}

async function adminWorker() {
  let text = '';
  for await (const part of process.stdin) text += part;
  const input = JSON.parse(text);
  const require = createRequire(import.meta.url);
  const sdk = require(path.join(home, '.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi'));
  const client = new sdk.BitwardenClient(undefined, 4);
  await client.auth().loginAccessToken(input.token);
  const organization = '202b0b27-b135-44cd-a969-b43a003ad670';
  ensure(input.key === 'frigate__admin-password', 'Unexpected private credential key.');
  const matches = (await client.secrets().list(organization)).data.filter(secret => secret.key === input.key);
  ensure(matches.length <= 1, 'Ambiguous admin credential reference.');
  let secret;
  if (matches.length) secret = await client.secrets().get(matches[0].id);
  else {
    ensure(typeof input.password === 'string' && input.password.length >= 8, 'Initial admin credential is not available yet.');
    secret = await client.secrets().create(organization, input.key, input.password, 'Native Frigate admin password; username admin. Preserve existing identity.', ['89090d54-807a-4168-b063-b43a004ba0c1']);
  }
  process.stdout.write(JSON.stringify({ id: secret.id, value: secret.value }));
}

try {
  if (phase === '--admin-worker') await adminWorker();
  else await main();
} catch (error) { console.error(phase === '--admin-worker' ? 'Private admin credential bootstrap failed; details withheld.' : error.message); process.exitCode = 1; }