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
assert(['prepare-secrets', 'preflight'].includes(phase), 'Use prepare-secrets or preflight.');
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