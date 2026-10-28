#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] ?? 'plan';
assert.ok(['plan', 'create', 'deploy', 'inspect', 'resize'].includes(phase), 'Unknown controller lifecycle phase');
if (['create', 'deploy', 'resize'].includes(phase)) assert.equal(process.env.GWN_LXC_APPLY_ALLOWED, 'true', 'Explicit controller lifecycle approval required');
const manifest = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/gwn-manager.json'), 'utf8'));
assert.ok(manifest.container.id === 201 && manifest.container.node === 'edge' && manifest.container.unprivileged, 'Unexpected controller boundary');
const home = os.homedir();
const state = path.join(home, '.local/state/owl-red/gwn-lxc');
fs.mkdirSync(state, { recursive: true, mode: 0o700 });
const sshArguments = ['-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=6', 'root@10.0.10.3'];
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: repository, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    fs.writeFileSync(path.join(state, 'failure.log'), (result.stdout ?? '') + (result.stderr ?? ''), { mode: 0o600 });
    throw new Error('Controller operation failed; private diagnostics retained outside Git');
  }
  return result.stdout.trim();
}
const remote = command => execute('ssh', [...sshArguments, command]);
const guests = JSON.parse(remote('pvesh get /cluster/resources --type vm --output-format json'));
const current = guests.filter(item => item.vmid === 201);
const protectedBefore = remote('qm config 103; pct config 200');
const protectedHash = crypto.createHash('sha256').update(protectedBefore).digest('hex');

if (phase === 'inspect') {
  assert.ok(current.length === 1 && current[0].type === 'lxc' && current[0].name === 'gwn', 'Expected owned controller LXC');
  const result = remote('pct status 201; pct exec 201 -- /run/current-system/sw/bin/systemctl is-active gwn-manager.service');
  console.log(result);
} else if (phase === 'deploy') {
  assert.ok(current.length === 1 && current[0].type === 'lxc' && current[0].name === 'gwn', 'Expected owned controller LXC');
  const configuration = remote('pct config 201');
  assert.ok(configuration.includes('unprivileged: 1') && configuration.includes('ip=10.0.10.32/24') && configuration.includes('02:6F:77:10:02:01'), 'Live controller allocation mismatch');
  const system = execute('nix-build', ['nix/hosts/gwn-manager/check.nix', '-A', 'system', '--no-out-link', '--max-jobs', '2', '--cores', '2']);
  assert.match(system, /^\/nix\/store\/[a-z0-9]+-nixos-system-[a-zA-Z0-9._-]+$/);
  fs.writeFileSync(path.join(state, 'system-path'), system + '\n', { mode: 0o600 });
  const closure = execute('nix-store', ['--query', '--requisites', system]).split('\n');
  const exporter = spawn('nix-store', ['--export', ...closure], { stdio: ['ignore', 'pipe', 'pipe'] });
  const importer = spawn('ssh', [...sshArguments, 'pct exec 201 -- /run/current-system/sw/bin/nix-store --import'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostics = '';
  exporter.stderr.on('data', data => { diagnostics += data; });
  importer.stderr.on('data', data => { diagnostics += data; });
  importer.stdout.resume();
  exporter.stdout.pipe(importer.stdin);
  const timeout = setTimeout(() => { exporter.kill(); importer.kill(); }, 600000);
  const codes = await Promise.all([exporter, importer].map(child => new Promise(resolve => child.on('close', resolve))));
  clearTimeout(timeout);
  fs.writeFileSync(path.join(state, 'closure-transfer.log'), diagnostics, { mode: 0o600 });
  assert.ok(codes.every(code => code === 0), 'Nix closure transfer failed; private diagnostics retained');
  fs.writeFileSync(path.join(state, 'activation-requested.json'), JSON.stringify({ system, at: new Date().toISOString() }), { mode: 0o600 });
  remote('pct exec 201 -- /run/current-system/sw/bin/nix-env -p /nix/var/nix/profiles/system --set ' + system);
  remote('pct exec 201 -- ' + system + '/bin/switch-to-configuration switch');
  console.log(JSON.stringify({ controller: 201, systemActivated: true }));
} else {
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  assert.ok(stored.PROXMOX_ROOT_PASSWORD, 'Existing Proxmox credential is required');
  const environment = { ...process.env, PROXMOX_VE_ENDPOINT: 'https://10.0.10.3:8006/', PROXMOX_VE_USERNAME: 'root@pam', PROXMOX_VE_PASSWORD: stored.PROXMOX_ROOT_PASSWORD, PROXMOX_VE_INSECURE: 'true' };
  delete environment.PROXMOX_VE_API_TOKEN;
  const root = '-chdir=terraform/proxmox/gwn-manager';
  const plan = path.join(state, 'controller.tfplan');
  execute('terraform', [root, 'plan', '-input=false', '-out=' + plan], { env: environment });
  const rendered = JSON.parse(execute('terraform', [root, 'show', '-json', plan], { env: environment }));
  const changes = (rendered.resource_changes ?? []).filter(change => change.change.actions.join(',') !== 'no-op');
  assert.ok(changes.length <= 1, 'Refuse changes outside one controller resource');
  for (const change of changes) {
    const after = change.change.after;
    assert.ok(change.address === 'proxmox_virtual_environment_container.gwn_manager' &&
      after.vm_id === 201 && after.node_name === 'edge' && after.unprivileged === true, 'Unexpected controller resource');
    if (change.change.actions.join(',') === 'update') {
      assert.ok(['plan', 'resize'].includes(phase), 'Use the explicit memory-only resize phase');
      const before = structuredClone(change.change.before);
      assert.ok(before.memory[0].dedicated === 6144 && after.memory[0].dedicated === 4096, 'Only the reviewed 6-to-4-GiB reduction is allowed');
      before.memory[0].dedicated = after.memory[0].dedicated;
      assert.deepEqual(before, after, 'Refuse changes other than the controller memory limit');
    } else assert.ok(change.change.actions.join(',') === 'create' && phase !== 'resize', 'Refuse controller replacement or destruction');
  }
  console.log(JSON.stringify({ planCreates: changes.filter(change => change.change.actions[0] === 'create').length,
    memoryUpdates: changes.filter(change => change.change.actions[0] === 'update').length,
    existingController: current.length === 1, otherGuestsChanged: false }));
  if (phase === 'resize' && changes.length) {
    assert.ok(current.length === 1 && current[0].type === 'lxc' && current[0].name === 'gwn', 'Expected owned controller LXC');
    const before = remote('pct config 201');
    assert.ok(/^memory: 6144$/m.test(before), 'Live memory differs from the resize preimage');
    const servicePid = remote('pct exec 201 -- /run/current-system/sw/bin/systemctl show gwn-manager.service --property=MainPID --value');
    assert.ok(Number(servicePid) > 0, 'Controller service must be running before hot resize');
    fs.writeFileSync(path.join(state, 'memory-before.conf'), before, { mode: 0o600 });
    remote('pct set 201 --memory 4096');
    const after = remote('pct config 201');
    assert.ok(/^memory: 4096$/m.test(after), 'Memory reduction was not applied');
    assert.equal(before.replace(/^memory: .*$/m, ''), after.replace(/^memory: .*$/m, ''), 'Unrelated container configuration changed');
    assert.equal(remote('pct exec 201 -- /run/current-system/sw/bin/systemctl show gwn-manager.service --property=MainPID --value'), servicePid, 'Controller service restarted during resize');
    const refresh = path.join(state, 'memory-refresh.tfplan');
    execute('terraform', [root, 'plan', '-refresh-only', '-input=false', '-out=' + refresh], { env: environment });
    execute('terraform', [root, 'apply', '-input=false', refresh], { env: environment });
    console.log(JSON.stringify({ controller: 201, memoryMiB: 4096, liveMemoryOnly: true, servicePidUnchanged: true }));
  }
  if (phase === 'create' && changes.length) {
    assert.ok(current.length === 0, 'CT 201 already exists; inspect before retrying');
    const marker = path.join(state, 'create-requested.json');
    assert.ok(!fs.existsSync(marker), 'A previous create was requested; inspect actual state before retrying');
    fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString() }), { mode: 0o600 });
    execute('terraform', [root, 'apply', '-input=false', plan], { env: environment });
    console.log(JSON.stringify({ controllerCreated: 201 }));
  }
}
assert.equal(crypto.createHash('sha256').update(remote('qm config 103; pct config 200')).digest('hex'), protectedHash, 'Protected router/DNS configuration changed');