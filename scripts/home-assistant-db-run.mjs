#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const organization = '202b0b27-b135-44cd-a969-b43a003ad670';
const project = '89090d54-807a-4168-b063-b43a004ba0c1';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

async function secretWorker() {
  let input = '';
  for await (const part of process.stdin) input += part;
  const request = JSON.parse(input);
  const require = createRequire(import.meta.url);
  const sdk = require(path.join(os.homedir(), '.local/share/owl-red/tools/bitwarden-sdk/node_modules/@bitwarden/sdk-napi'));
  const client = new sdk.BitwardenClient(undefined, 4);
  await client.auth().loginAccessToken(request.token);
  const listed = await client.secrets().list(organization);
  const identifiers = listed.data;
  ensure(Array.isArray(identifiers), 'Unexpected secret-list response.');
  async function getOrCreate(key, value) {
    const matches = identifiers.filter(secret => secret.key === key);
    ensure(matches.length <= 1, 'Ambiguous application credential key.');
    return matches.length ? client.secrets().get(matches[0].id) :
      client.secrets().create(organization, key, value(), 'Dedicated Home Assistant recorder; managed by owl.red.', [project]);
  }
  const admin = await getOrCreate('home-assistant__postgres__admin-password', () => randomBytes(32).toString('hex'));
  const application = await getOrCreate('k8s__home-assistant__recorder__password', () => randomBytes(32).toString('hex'));
  ensure(/^[a-f0-9]{64}$/.test(admin.value) && /^[a-f0-9]{64}$/.test(application.value), 'Unexpected credential format; rotation refused.');
  const expectedUrl = 'postgresql://homeassistant:' + application.value + '@10.0.10.5:15432/homeassistant?client_encoding=utf8';
  const url = await getOrCreate('k8s__home-assistant__recorder__db-url', () => expectedUrl);
  ensure(url.value === expectedUrl, 'Existing recorder URL differs; replacement refused.');
  process.stdout.write(JSON.stringify({ admin, application, url }));
}

function execute(program, argumentsList, options = {}) {
  const result = spawnSync(program, argumentsList, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...options
  });
  if (result.status !== 0) {
    const directory = path.join(os.homedir(), '.local/state/owl-red');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const log = fs.mkdtempSync(path.join(directory, 'ha-provisioning-'));
    fs.writeFileSync(path.join(log, 'output.log'), (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
    throw new Error('Operation failed: ' + program + '. Private diagnostic output: ' + log);
  }
  return result.stdout;
}

function main() {
  ensure(process.argv.includes('--apply'), 'Use --apply for the explicitly scoped recorder provisioning.');
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  ensure(stored.BWS_ACCESS_TOKEN, 'Private controller BWS input is missing.');
  const credentials = JSON.parse(execute(process.execPath, [fileURLToPath(import.meta.url), '--secret-worker'], {
    input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN })
  }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-ha-db-'));
  const socket = path.join(directory, 'docker.sock');
  const control = path.join(directory, 'ssh.sock');
  let connected = false;
  try {
    execute('ssh', ['-i', path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible'),
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StreamLocalBindMask=0177', '-M', '-S', control, '-f', '-N',
      '-L', socket + ':/var/run/docker.sock', 'root@10.0.10.5']);
    connected = true;
    execute(path.join(repository, '.venv/bin/ansible-playbook'), ['playbooks/home-assistant-db.yml', '-e', JSON.stringify({
      homeassistant_db_apply: true,
      ansible_python_interpreter: path.join(repository, '.venv/bin/python')
    })], {
      cwd: path.join(repository, 'ansible'),
      env: {
        ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'),
        HOMEASSISTANT_DOCKER_HOST: 'unix://' + socket,
        HOMEASSISTANT_DB_ADMIN_PASSWORD: credentials.admin.value,
        HOMEASSISTANT_DB_PASSWORD: credentials.application.value
      }
    });
    if (process.argv.includes('--bootstrap-kubernetes')) {
      execute('kubectl', ['get', 'namespace', 'home-assistant', '-o', 'name']);
      const existing = execute('kubectl', ['-n', 'home-assistant', 'get', 'secret', 'bw-auth-token', '--ignore-not-found', '-o', 'json']);
      if (existing.trim()) {
        const actual = JSON.parse(existing);
        ensure(Buffer.from(actual.data.token, 'base64').toString() === stored.BWS_ACCESS_TOKEN, 'Existing bootstrap token differs; overwrite refused.');
      } else {
        execute('kubectl', ['create', '-f', '-'], { input: JSON.stringify({
          apiVersion: 'v1', kind: 'Secret', metadata: { name: 'bw-auth-token', namespace: 'home-assistant' },
          type: 'Opaque', stringData: { token: stored.BWS_ACCESS_TOKEN }
        }) });
      }
    }
    console.log(JSON.stringify({
      database: 'home-assistant-postgres', host: 'nas.owl.red', port: 15432,
      adminSecretId: credentials.admin.id, applicationSecretId: credentials.application.id,
      recorderUrlSecretId: credentials.url.id, privateValuesPrinted: false
    }, null, 2));
  } finally {
    if (connected) spawnSync('ssh', ['-S', control, '-O', 'exit', 'root@10.0.10.5'], { stdio: 'ignore' });
    for (const name of ['docker.sock', 'ssh.sock']) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  }
}

try {
  if (process.argv.includes('--secret-worker')) await secretWorker();
  else main();
} catch (error) {
  console.error(process.argv.includes('--secret-worker') ? 'Private credential operation failed; details withheld.' : error.message);
  process.exitCode = 1;
}