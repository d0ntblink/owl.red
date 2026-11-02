import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/plex-maintenance.json'), 'utf8'));
const phase = process.argv[2];
assert(['prepare-secrets', 'preflight', 'imagemaid-report'].includes(phase), 'Use prepare-secrets, preflight or imagemaid-report.');
function execute(command, args, input) {
    const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Private maintenance preparation failed; response details suppressed.');
    return result.stdout.trim();
}
if (phase === 'preflight') {
    try {
        const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
        const worker = String.raw`
const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.accessToken);const result={};for(const name of ['plex_token','tmdb_key','tmdb_read_token','mdblist_key']){const secret=await client.secrets().get(request.config[name+'_id']);if(!secret.value)throw Error('Missing credential');result[name]=secret.value;}process.stdout.write(JSON.stringify(result));})().catch(()=>{process.stderr.write('Private credential read failed');process.exitCode=1;});`;
        const credentials = JSON.parse(execute(process.execPath, ['-e', worker], JSON.stringify({ config, accessToken: stored.BWS_ACCESS_TOKEN })));
        const calls = { tmdb: 0, mdblist: 0, omdb: 0 };
        async function request(provider, address, parameters = {}, headers = {}) {
            const url = new URL(address);
            for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
            if (provider) calls[provider] += 1;
            const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
            assert(response.ok, `${provider ?? 'plex'} preflight returned HTTP ${response.status}; no automatic retry.`);
            return response.json();
        }
        const tmdb = await request('tmdb', 'https://api.themoviedb.org/3/configuration', { api_key: credentials.tmdb_key });
        assert(tmdb.images?.secure_base_url, 'TMDb key validation failed.');
        const token = await request('tmdb', 'https://api.themoviedb.org/3/authentication', {}, { Authorization: `Bearer ${credentials.tmdb_read_token}` });
        assert(token.success === true, 'TMDb read-token validation failed.');
        const mdblist = await request('mdblist', 'https://api.mdblist.com/user', { apikey: credentials.mdblist_key });
        assert(Number.isInteger(mdblist.api_requests_count), 'MDBList usage counter unavailable.');
        assert(mdblist.api_requests_count < 800, 'MDBList budget has insufficient headroom; defer until reset.');
        const plexHeaders = { Accept: 'application/json', 'X-Plex-Token': credentials.plex_token };
        const sections = await request(null, `${config.plex_url}/library/sections`, {}, plexHeaders);
        const library = sections.MediaContainer.Directory.find(item => item.title === '4K Movies' && item.type === 'movie');
        assert(library, 'Expected 4K Movies library missing.');
        const media = await request(null, `${config.plex_url}/library/sections/${library.key}/all`, { includeGuids: '1' }, plexHeaders);
        const items = media.MediaContainer.Metadata ?? [];
        assert(items.length > 0 && items.length <= 40, 'Trial exceeds its bounded movie count.');
        const directory = path.join(os.homedir(), '.local/state/owl-red/plex-maintenance');
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        const report = { checkedAt: new Date().toISOString(), apiCalls: calls, dailyLimitPerProvider: 1000, mdblistUsedToday: mdblist.api_requests_count, mdblistReportedLimit: mdblist.api_requests, omdbEnabled: false, trialLibrary: library.title, trialItems: items.length, artworkChanges: false };
        fs.writeFileSync(path.join(directory, 'preflight.json'), JSON.stringify({ ...report, library, items }, null, 2), { mode: 0o600 });
        console.log(JSON.stringify(report));
    } catch (error) {
        console.error(error instanceof assert.AssertionError ? error.message : 'Private API preflight failed; no automatic retry and response details suppressed.');
        process.exitCode = 1;
    }
} else if (phase === 'imagemaid-report') {
    const jobs = JSON.parse(execute('kubectl', ['-n', config.namespace, 'get', 'jobs', '-o', 'json'])).items;
    assert(!jobs.some(job => job.status.active), 'Artwork writer active; do not overlap ImageMaid.');
    const runtime = JSON.parse(execute('kubectl', ['-n', config.namespace, 'get', 'secret', 'plex-maintenance-runtime', '-o', 'json']));
    const token = Buffer.from(runtime.data.PLEX_TOKEN, 'base64').toString();
    assert(/^[A-Za-z0-9_-]+$/.test(token), 'Unexpected credential format.');
    const environment = {
        PLEX_PATH: '/plex', MODE: 'report', SCHEDULE: '', PLEX_URL: config.plex_url,
        PLEX_TOKEN: token, OVERLAYS_ONLY: 'False', LOCAL_DB: 'False', IGNORE_RUNNING: 'False',
        USE_EXISTING: 'False', PHOTO_TRANSCODER: 'False', EMPTY_TRASH: 'False',
        CLEAN_BUNDLES: 'False', OPTIMIZE_DB: 'False', TRACE: 'False', LOG_REQUESTS: 'False',
        GOTIFY_ENABLED: 'False', TIMEOUT: '600', TZ: config.timezone
    };
    const encoded = Buffer.from(JSON.stringify({ config, environment })).toString('base64');
    const program = String.raw`<?php
set_exception_handler(function($error){file_put_contents('php://stderr','Private ImageMaid report preparation failed');exit(1);});
$input=json_decode(base64_decode('__INPUT__'),true,512,JSON_THROW_ON_ERROR);
$config=$input['config'];
if($config['plex_profile']!='/mnt/user/appdata/plex'||$config['imagemaid_config']!='/mnt/cache/appdata/imagemaid')throw new Exception('Unexpected paths');
function docker($method,$path,$data=null,$allowMissing=false){$curl=curl_init('http://localhost'.$path);curl_setopt_array($curl,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>60]);if($data!==null){curl_setopt($curl,CURLOPT_POSTFIELDS,json_encode($data));curl_setopt($curl,CURLOPT_HTTPHEADER,['Content-Type: application/json']);}$body=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_HTTP_CODE);curl_close($curl);if($allowMissing&&$status==404)return null;if($status<200||$status>=300)throw new Exception('Docker request failed');return json_decode($body,true);}
if(docker('GET','/containers/imagemaid/json',null,true)!==null)throw new Exception('Existing container requires inspection; no automatic repeat');
if(!is_dir($config['plex_profile'].'/Metadata')||!is_dir($config['plex_profile'].'/Plug-in Support'))throw new Exception('Wrong Plex profile');
$directory=$config['imagemaid_config'];
if(file_exists($directory)&&(!is_dir($directory)||count(array_diff(scandir($directory),['.','..']))))throw new Exception('Unreviewed existing config');
if(!is_dir($directory)&&!mkdir($directory,0770,true))throw new Exception('Config creation failed');
chown($directory,99);chgrp($directory,100);chmod($directory,0770);
$env='';foreach($input['environment'] as $name=>$value)$env.=$name.'='.$value.PHP_EOL;
file_put_contents($directory.'/.env',$env,LOCK_EX);chown($directory.'/.env',99);chgrp($directory.'/.env',100);chmod($directory.'/.env',0600);
$icon='https://raw.githubusercontent.com/Kometa-Team/ImageMaid/v1.2.2/.github/logo.png';
$definition=['Image'=>$config['imagemaid_image'],'User'=>'99:100','Env'=>['TZ='.$config['timezone'],'HOME=/config'],'Cmd'=>['--mode','report'],'Labels'=>['owl.red.component'=>'imagemaid','net.unraid.docker.icon'=>$icon],'HostConfig'=>['Binds'=>[$directory.':/config:rw',$config['plex_profile'].':/plex:ro'],'NetworkMode'=>'bridge','RestartPolicy'=>['Name'=>'no'],'Memory'=>1073741824,'NanoCpus'=>1000000000,'CapDrop'=>['ALL'],'SecurityOpt'=>['no-new-privileges:true'],'ReadonlyRootfs'=>true,'Tmpfs'=>['/tmp'=>'rw,nosuid,nodev,size=64m,mode=1777']]];
docker('POST','/containers/create?name=imagemaid',$definition);
$xml=new SimpleXMLElement('<Container version="2"/>');
foreach(['Name'=>'imagemaid','Repository'=>$config['imagemaid_image'],'Registry'=>'https://hub.docker.com/r/kometateam/imagemaid','Network'=>'bridge','Shell'=>'sh','Privileged'=>'false','Support'=>'https://github.com/Kometa-Team/ImageMaid','Project'=>'https://github.com/Kometa-Team/ImageMaid','Overview'=>'Headless Plex metadata image report. Permanent deletion requires separate review.','Category'=>'Tools:','Icon'=>$icon,'ExtraParams'=>'--user 99:100 --memory=1g --cpus=1 --cap-drop=ALL --security-opt=no-new-privileges:true --read-only --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777','PostArgs'=>'--mode report'] as $name=>$value)$xml->addChild($name,htmlspecialchars($value,ENT_XML1));
foreach([['Name'=>'Config','Target'=>'/config','Default'=>$directory,'Mode'=>'rw'],['Name'=>'Plex profile','Target'=>'/plex','Default'=>$config['plex_profile'],'Mode'=>'ro']] as $mount){$child=$xml->addChild('Config',$mount['Default']);foreach($mount+['Type'=>'Path','Display'=>'always','Required'=>'true','Mask'=>'false'] as $name=>$value)$child->addAttribute($name,$value);}
$template='/boot/config/plugins/dockerMan/templates-user/my-imagemaid.xml';
if(file_exists($template))throw new Exception('Existing template requires inspection');
if(!is_dir(dirname($template)))throw new Exception('Unraid template directory absent');
file_put_contents($template,$xml->asXML());
$actual=docker('GET','/containers/imagemaid/json');
if($actual['HostConfig']['Binds']!==$definition['HostConfig']['Binds']||$actual['Config']['Cmd']!==['--mode','report'])throw new Exception('Container mismatch');
file_put_contents($directory.'/.owl-red-report-created',gmdate('c'));
docker('POST','/containers/imagemaid/start');
echo json_encode(['container'=>'imagemaid','mode'=>'report','plexProfileReadOnly'=>true,'otherOperations'=>false,'restartPolicy'=>'no','templateCreated'=>true]);
`;
    console.log(execute('ssh', ['-T', '-i', path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'root@10.0.10.5', 'php'], program.replace('__INPUT__', encoded)));
} else {
const pods = JSON.parse(execute('kubectl', ['-n', config.tautulli_namespace, 'get', 'pods', '-o', 'json'])).items
    .filter(pod => pod.metadata.name.startsWith('tautulli-') && pod.status.phase === 'Running');
assert.equal(pods.length, 1, 'Expected one running Tautulli pod.');
const program = 'import sys; sys.path[:0]=["/app/tautulli/lib","/app/Tautulli/lib","/app/lib","/tautulli/lib"]; from configobj import ConfigObj; config=ConfigObj("/config/config.ini"); token=config.get("PMS",{}).get("pms_token"); assert token; print(token)';
const plexToken = execute('kubectl', ['-n', config.tautulli_namespace, 'exec', pods[0].metadata.name, '--', 'python3', '-c', program]);
assert(plexToken && !plexToken.startsWith('claim-'), 'A reusable Plex API token is required.');
const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
const worker = String.raw`
const sdk=require(require('node:os').homedir()+'/.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi');
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;const request=JSON.parse(input);const client=new sdk.BitwardenClient(undefined,4);await client.auth().loginAccessToken(request.accessToken);const entries=(await client.secrets().list(request.config.organization_id)).data;const matches=entries.filter(secret=>secret.key===request.config.plex_secret_key);if(matches.length>1)throw Error('Ambiguous maintenance token');const secret=matches.length?await client.secrets().get(matches[0].id):await client.secrets().create(request.config.organization_id,request.config.plex_secret_key,request.plexToken,'Plex API credential reused from the existing Tautulli connection; do not rotate independently',[request.config.project_id]);if(secret.value!==request.plexToken)throw Error('Existing maintenance token differs; do not overwrite');for(const id of [request.config.tmdb_key_id,request.config.tmdb_read_token_id])if(!(await client.secrets().get(id)).value)throw Error('Required TMDb credential missing');process.stdout.write(JSON.stringify({plexTokenSecretId:secret.id,tmdbKeyPresent:true,tmdbReadTokenPresent:true,secretValuesPrinted:false}));})().catch(()=>{process.stderr.write('Private maintenance secret preparation failed');process.exitCode=1;});`;
const summary = execute(process.execPath, ['-e', worker], JSON.stringify({ config, accessToken: stored.BWS_ACCESS_TOKEN, plexToken }));
console.log(summary);
}