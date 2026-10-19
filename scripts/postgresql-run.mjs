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

function loadConfiguration() {
  const option = process.argv.indexOf('--config');
  ensure(option < 0 || process.argv[option + 1], 'A configuration path is required.');
  const filename = option < 0 ? path.join(repository, 'ansible/vars/postgresql.json') : path.resolve(process.argv[option + 1]);
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
  ensure(config.server?.host === '10.0.10.5' && config.server.port === 15432, 'Endpoint migration requires a separate reviewed change.');
  ensure(config.server.container_name === 'postgresql' && config.server.data_directory === '/mnt/ssd/appdata/home-assistant-db', 'Use the shared service name and preserve the existing data directory.');
  ensure(config.server.icon === 'https://raw.githubusercontent.com/homarr-labs/dashboard-icons/main/png/postgresql.png', 'Use the verified PostgreSQL icon.');
  ensure(/^postgres:17@sha256:[a-f0-9]{64}$/.test(config.server.image), 'Keep a digest-pinned PostgreSQL 17 image; major upgrades need a separate migration.');
  ensure(config.server.admin_password_secret === 'home-assistant__postgres__admin-password', 'Administrator credential migration requires a separate reviewed change.');
  ensure(typeof config.server.admin_password_secret === 'string' && config.server.admin_password_secret.length > 0, 'An administrator secret reference is required.');
  const entries = Object.entries(config.applications ?? {});
  ensure(entries.length > 0, 'At least one application is required.');
  const databases = new Set();
  const roles = new Set();
  const secrets = new Set([config.server.admin_password_secret]);
  for (const [key, application] of entries) {
    ensure(/^[a-z][a-z0-9_]{0,62}$/.test(key), 'Invalid application key.');
    ensure(typeof application.database === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(application.database) && !['postgres', 'template0', 'template1'].includes(application.database), 'Invalid application database.');
    ensure(typeof application.role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(application.role) && application.role !== 'postgres' && !application.role.startsWith('pg_'), 'Invalid application role.');
    ensure(!databases.has(application.database) && !roles.has(application.role), 'Applications must have distinct databases and roles.');
    databases.add(application.database);
    roles.add(application.role);
    for (const reference of [application.password_secret, application.url_secret]) {
      ensure(typeof reference === 'string' && reference.length > 0 && !secrets.has(reference), 'Applications must have distinct credential references.');
      secrets.add(reference);
    }
    ensure(!application.kubernetes_namespace || /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(application.kubernetes_namespace), 'Invalid Kubernetes namespace.');
  }
  return { config, filename };
}

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
      client.secrets().create(organization, key, value(), 'Shared PostgreSQL application credential; managed by owl.red.', [project]);
  }
  const admin = await getOrCreate(request.config.server.admin_password_secret, () => randomBytes(32).toString('hex'));
  ensure(/^[a-f0-9]{64}$/.test(admin.value), 'Unexpected administrator credential format; rotation refused.');
  const applications = {};
  const passwords = new Set([admin.value]);
  for (const [key, entry] of Object.entries(request.config.applications)) {
    const password = await getOrCreate(entry.password_secret, () => randomBytes(32).toString('hex'));
    ensure(/^[a-f0-9]{64}$/.test(password.value), 'Unexpected application credential format; rotation refused.');
    ensure(!passwords.has(password.value), 'Application and administrator passwords must be distinct.');
    passwords.add(password.value);
    const expected = new URL('postgresql://' + request.config.server.host + ':' + request.config.server.port + '/' + entry.database);
    expected.username = entry.role;
    expected.password = password.value;
    expected.searchParams.set('client_encoding', 'utf8');
    const url = await getOrCreate(entry.url_secret, () => expected.toString());
    ensure(url.value === expected.toString(), 'Existing application URL differs; replacement refused.');
    applications[key] = { password, url };
  }
  process.stdout.write(JSON.stringify({ admin, applications }));
}

function execute(program, argumentsList, options = {}) {
  const result = spawnSync(program, argumentsList, {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...options
  });
  if (result.status !== 0) {
    const directory = path.join(os.homedir(), '.local/state/owl-red');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const log = fs.mkdtempSync(path.join(directory, 'postgresql-provisioning-'));
    fs.writeFileSync(path.join(log, 'output.log'), (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
    throw new Error('Operation failed: ' + program + '. Private diagnostic output: ' + log);
  }
  return result.stdout;
}

function main() {
  const { config, filename } = loadConfiguration();
  if (process.argv.includes('--validate-config')) {
    console.log(JSON.stringify({ valid: true, applications: Object.keys(config.applications), liveChanges: false }));
    return;
  }
  ensure(process.argv.includes('--apply'), 'Use --apply for explicitly scoped PostgreSQL provisioning.');
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  ensure(stored.BWS_ACCESS_TOKEN, 'Private controller BWS input is missing.');
  const credentials = JSON.parse(execute(process.execPath, [fileURLToPath(import.meta.url), '--secret-worker'], {
    input: JSON.stringify({ token: stored.BWS_ACCESS_TOKEN, config })
  }));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-postgresql-'));
  const socket = path.join(directory, 'docker.sock');
  const control = path.join(directory, 'ssh.sock');
  let connected = false;
  try {
    execute('ssh', ['-i', path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible'),
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StreamLocalBindMask=0177', '-M', '-S', control, '-f', '-N',
      '-L', socket + ':/var/run/docker.sock', 'root@10.0.10.5']);
    connected = true;
    execute(path.join(repository, '.venv/bin/ansible-playbook'), ['playbooks/postgresql.yml', '-e', JSON.stringify({
      postgresql_apply: true,
      postgresql_config: config,
      ansible_python_interpreter: path.join(repository, '.venv/bin/python')
    })], {
      cwd: path.join(repository, 'ansible'),
      env: {
        ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'),
        POSTGRESQL_DOCKER_HOST: 'unix://' + socket,
        POSTGRESQL_ADMIN_PASSWORD: credentials.admin.value,
        POSTGRESQL_APPLICATION_PASSWORDS: JSON.stringify(Object.fromEntries(
          Object.entries(credentials.applications).map(([key, value]) => [key, value.password.value])
        ))
      }
    });
    if (process.argv.includes('--bootstrap-kubernetes')) {
      const selected = process.argv.indexOf('--application');
      const application = selected < 0 ? 'homeassistant' : process.argv[selected + 1];
      const namespace = config.applications[application]?.kubernetes_namespace;
      ensure(namespace, 'Select a configured application with a Kubernetes namespace.');
      execute('kubectl', ['get', 'namespace', namespace, '-o', 'name']);
      const existing = execute('kubectl', ['-n', namespace, 'get', 'secret', 'bw-auth-token', '--ignore-not-found', '-o', 'json']);
      if (existing.trim()) {
        const actual = JSON.parse(existing);
        ensure(Buffer.from(actual.data.token, 'base64').toString() === stored.BWS_ACCESS_TOKEN, 'Existing bootstrap token differs; overwrite refused.');
      } else {
        execute('kubectl', ['create', '-f', '-'], { input: JSON.stringify({
          apiVersion: 'v1', kind: 'Secret', metadata: { name: 'bw-auth-token', namespace },
          type: 'Opaque', stringData: { token: stored.BWS_ACCESS_TOKEN }
        }) });
      }
    }
    console.log(JSON.stringify({
      service: 'shared-postgresql', container: config.server.container_name,
      host: config.server.host, port: config.server.port, configuration: path.relative(repository, filename),
      adminSecretId: credentials.admin.id,
      applications: Object.fromEntries(Object.entries(credentials.applications).map(([key, value]) => [key, {
        database: config.applications[key].database, role: config.applications[key].role,
        passwordSecretId: value.password.id, urlSecretId: value.url.id
      }])),
      privateValuesPrinted: false
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