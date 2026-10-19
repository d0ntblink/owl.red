#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { execFileSync, spawnSync } from 'node:child_process';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
const profile = path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0');
const phase = process.argv[2] ?? 'inspect';
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

function main() {
  ensure(['credentials', 'inspect', 'plan', 'apply', 'verify'].includes(phase), 'Supported phases: credentials, inspect, plan, apply, verify.');
  const stateRoot = path.join(home, '.local/state/owl-red');
  const suppliedRecovery = process.argv[3];
  if (phase === 'apply') ensure(process.env.THINGINO_APPLY_ALLOWED === 'true' && suppliedRecovery, 'Apply requires THINGINO_APPLY_ALLOWED=true and the reviewed plan directory.');
  ensure(fs.existsSync(binary) && fs.existsSync(profile), 'Use the verified Bitwarden 2026.7.0 binary and copied profile; do not retry 2026.4.1 unlocks.');
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  const environment = {
    ...process.env, BW_SECRET: stored.BW_SECRET ?? process.env.BW_SECRET,
    BITWARDENCLI_APPDATA_DIR: profile
  };
  delete environment.BW_SESSION;
  function vault(argumentsList) {
    try {
      return execFileSync(binary, argumentsList, { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
    } catch {
      throw new Error('Verified-profile vault operation failed; private output withheld.');
    }
  }
  ensure(vault(['--version']) === '2026.7.0', 'Unexpected Bitwarden version.');
  environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
  vault(['sync']);
  if (['inspect', 'plan', 'apply', 'verify'].includes(phase)) {
    const login = JSON.parse(vault(['get', 'item', '79c52c46-77d5-46b6-8d7d-b4dd00ff75ae'])).login;
    const wifi = JSON.parse(vault(['get', 'item', '9a8a2769-6c84-48a7-bf9e-b4e70030d1af'])).login;
    ensure(login?.username === 'root' && login.password && wifi?.password, 'Private camera/Wi-Fi entries are incomplete.');
    fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
    const recovery = suppliedRecovery ? path.resolve(suppliedRecovery) : fs.mkdtempSync(path.join(stateRoot, 'thingino-'));
    ensure(path.dirname(recovery) === stateRoot && path.basename(recovery).startsWith('thingino-') && fs.statSync(recovery).isDirectory(), 'Invalid camera recovery directory.');
    const argumentsList = ['-i', 'ansible/inventory/hosts.yml', 'ansible/playbooks/thingino-cameras.yml', '-e', JSON.stringify({
      thingino_phase: phase, thingino_apply_allowed: process.env.THINGINO_APPLY_ALLOWED === 'true',
      thingino_node: process.execPath, thingino_recovery: recovery,
      ansible_python_interpreter: path.join(repository, '.venv/bin/python')
    })];
    if (process.env.THINGINO_LIMIT) {
      ensure(['camera_foyer', 'camera_office'].includes(process.env.THINGINO_LIMIT), 'Unknown camera limit.');
      argumentsList.push('--limit', process.env.THINGINO_LIMIT);
    }
    const result = spawnSync(path.join(repository, '.venv/bin/ansible-playbook'), argumentsList, {
      cwd: repository,
      env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'),
        THINGINO_CREDENTIALS: JSON.stringify({ username: login.username, password: login.password, wifi: wifi.password }) },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024
    });
    fs.writeFileSync(path.join(recovery, phase + '-' + (process.env.THINGINO_LIMIT ?? 'all') + '.log'), (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
    ensure(result.status === 0, 'Camera ' + phase + ' stopped; private diagnostics: ' + recovery);
    console.log(result.stdout);
    console.log(JSON.stringify({ phase, recovery, devicesChangedOnlyIfApplied: phase === 'apply' }, null, 2));
    return;
  }
  const items = JSON.parse(vault(['list', 'items', '--nointeraction']));
  const matches = items.filter(item => /wuuk|thingino|camera|owl-red-wifi|openwrt|10\.0\.10\.(186|124)/i.test(item.name + ' ' + JSON.stringify(item.login?.uris ?? [])));
  console.log(JSON.stringify({
    vaultReadVerified: true,
    items: matches.map(item => ({ id: item.id, name: item.name, username: item.login?.username,
      uris: item.login?.uris?.map(entry => entry.uri), hasPassword: !!item.login?.password }))
  }, null, 2));
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }