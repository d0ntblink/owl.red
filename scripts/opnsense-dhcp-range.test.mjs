import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uuid = 'caca46e0-9db2-4b3a-bab3-d6eda6246104';

test('all assert conditions parse as expressions rather than truthy YAML mappings', () => {
  const parser = String.raw`import json,sys,yaml
document=yaml.safe_load(sys.stdin.read())
invalid=[]
def inspect(tasks):
    for task in tasks:
        assertion=task.get('ansible.builtin.assert',{})
        if any(not isinstance(condition,(str,bool)) for condition in assertion.get('that',[])):
            invalid.append(task.get('name'))
        for section in ('block','rescue','always'):
            inspect(task.get(section,[]))
for play in document:
    inspect(play.get('tasks',[]))
print(json.dumps(invalid))`;
  const result = spawnSync('python3', ['-c', parser], {
    input: fs.readFileSync(path.join(repository, 'ansible/playbooks/opnsense-dhcp-range.yml')),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, 'Python 3 and PyYAML are required');
  assert.deepEqual(JSON.parse(result.stdout), []);
});

async function scenario(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-range-test-'));
  const inventory = path.join(directory, 'inventory.ini');
  fs.writeFileSync(inventory, '[network_edge]\nopnsense ansible_host=127.0.0.1\n', { mode: 0o600 });
  const range = { interface: { lan: { selected: 1, value: 'LAN' } }, start_addr: '10.0.10.100',
    end_addr: options.uncorrectedPool ? '10.0.10.200' : options.converged || options.mask ? '10.0.10.199' : '10.0.10.200',
    subnet_mask: options.currentMask ?? (options.maskConverged ? '255.255.255.0' : ''), lease_time: '',
    constructor: {}, nosync: '0' };
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    requests.push({ method: request.method, path: request.url, body });
    let payload;
    let status = 200;
    if (request.method === 'GET' && request.url === `/api/dnsmasq/settings/getRange/${uuid}`) {
      payload = options.missing ? {} : { range };
    } else if (request.url.startsWith('/api/dnsmasq/leases/search')) {
      const rows = options.leaseConflict ? [{ address: '10.0.10.200' }]
        : options.outsideLease ? [{ address: '10.0.20.10' }] : [];
      payload = { rows, total: options.incomplete ? rows.length + 1 : rows.length };
    } else if (request.url.startsWith('/api/dnsmasq/settings/searchHost')) {
      const rows = options.outsideReservation ? [{ ip: '10.0.20.11', hwaddr: '02:00:00:00:00:11' }] : [];
      payload = { rows, total: rows.length };
    } else if (request.method === 'POST' && request.url === `/api/dnsmasq/settings/setRange/${uuid}`) {
      if (!options.ignoredSave) Object.assign(range, body.range);
      if (options.extraChange) {
        if (options.mask) range.lease_time = '300';
        else range.subnet_mask = '255.255.255.0';
      }
      payload = { result: 'saved' };
    } else if (request.method === 'POST' && request.url === '/api/dnsmasq/service/reconfigure') {
      payload = { status: options.failedActivation ? 'failed' : 'ok' };
    } else if (request.method === 'GET' && request.url === '/api/dnsmasq/service/status') {
      payload = { status: 'running' };
    } else {
      status = 404;
      payload = { error: 'Unexpected offline-test request' };
    }
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const services = { items: options.serviceConflict ? [{ spec: {}, status: {
      loadBalancer: { ingress: [{ ip: '10.0.10.200' }] },
    } }] : [] };
    const recovery = path.join(directory, 'private-recovery');
    const variables = { opnsense_range_api_url: `http://127.0.0.1:${server.address().port}`,
      opnsense_range_apply_confirmed: options.approved ?? true,
      opnsense_range_recovery_verified: options.approved ?? true,
      opnsense_range_recovery_dir: recovery,
      opnsense_range_services_command: ['/usr/bin/printf', '%s', JSON.stringify(services)],
      ansible_python_interpreter: '/usr/bin/python3' };
    if (options.mask) variables.opnsense_range_field = 'subnet_mask';
    Object.assign(variables, options.variables);
    const args = ['-i', inventory, 'ansible/playbooks/opnsense-dhcp-range.yml',
      '--extra-vars', JSON.stringify(variables)];
    if (options.check) args.push('--check');
    const result = await new Promise((resolve, reject) => {
      const child = spawn('ansible-playbook', args, { cwd: repository, timeout: 45000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'),
          ANSIBLE_NOCOLOR: '1', OPNSENSE_API_KEY: 'offline-key', OPNSENSE_API_SECRET: 'offline-secret' } });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      child.on('error', reject);
      child.on('close', code => resolve({ code, output }));
    });
    const beforeFile = path.join(recovery, 'before.json');
    return { ...result, requests, range, snapshot: fs.existsSync(beforeFile)
      ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : undefined,
    directoryMode: fs.existsSync(recovery) ? fs.statSync(recovery).mode & 0o777 : undefined,
    snapshotMode: fs.existsSync(beforeFile) ? fs.statSync(beforeFile).mode & 0o777 : undefined };
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('check mode reads and reports without writes or local recovery artifacts', async () => {
  const result = await scenario({ check: true, approved: false });
  assert.equal(result.code, 0, result.output);
  assert.ok(result.requests.length > 0);
  assert.ok(result.requests.every(request => request.method === 'GET'));
  assert.equal(result.range.end_addr, '10.0.10.200');
  assert.equal(result.snapshot, undefined);
});

test('normal execution without both approvals refuses before contacting the API', async () => {
  const result = await scenario({ approved: false });
  assert.notEqual(result.code, 0);
  assert.deepEqual(result.requests, []);
});

test('approved reconciliation saves a private preimage and writes only the range end', async () => {
  const result = await scenario();
  assert.equal(result.code, 0, result.output);
  const writes = result.requests.filter(request => request.method === 'POST');
  assert.deepEqual(writes, [{ method: 'POST', path: `/api/dnsmasq/settings/setRange/${uuid}`,
    body: { range: { end_addr: '10.0.10.199' } } },
  { method: 'POST', path: '/api/dnsmasq/service/reconfigure', body: {} }]);
  assert.equal(result.snapshot.range.end_addr, '10.0.10.200');
  assert.equal(result.directoryMode, 0o700);
  assert.equal(result.snapshotMode, 0o600);
  assert.equal(result.range.subnet_mask, '');
});

test('an already converged range does not write or reactivate services', async () => {
  const result = await scenario({ converged: true });
  assert.equal(result.code, 0, result.output);
  assert.ok(result.requests.every(request => request.method === 'GET'));
  assert.equal(result.snapshot, undefined);
});

test('missing objects, incomplete pagination and address ownership refuse all writes', async () => {
  for (const options of [{ missing: true }, { incomplete: true }, { leaseConflict: true }, { serviceConflict: true }]) {
    const result = await scenario(options);
    assert.notEqual(result.code, 0);
    assert.ok(result.requests.every(request => request.method === 'GET'));
  }
});

test('ignored saves or changes to other fields prevent service activation', async () => {
  for (const options of [{ ignoredSave: true }, { extraChange: true }]) {
    const result = await scenario(options);
    assert.notEqual(result.code, 0);
    assert.equal(result.requests.filter(request => request.method === 'POST').length, 1);
    assert.ok(!result.requests.some(request => request.path.endsWith('/reconfigure')));
  }
});

test('activation failures stop without retrying or automatic rollback', async () => {
  const result = await scenario({ failedActivation: true });
  assert.notEqual(result.code, 0);
  assert.equal(result.requests.filter(request => request.method === 'POST').length, 2);
  assert.equal(result.range.end_addr, '10.0.10.199');
  assert.ok(result.output.includes('No automatic rollback'));
});

test('mask preview and converged mask use GET only without recovery artifacts', async () => {
  for (const options of [{ mask: true, check: true, approved: false }, { mask: true, maskConverged: true }]) {
    const result = await scenario(options);
    assert.equal(result.code, 0, result.output);
    assert(result.requests.every(request => request.method === 'GET'));
    assert.equal(result.snapshot, undefined);
  }
});

test('approved mask reconciliation changes only subnet_mask and preserves corrected pool and lease timing', async () => {
  const result = await scenario({ mask: true });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.requests.filter(request => request.method === 'POST'), [
    { method: 'POST', path: `/api/dnsmasq/settings/setRange/${uuid}`, body: { range: { subnet_mask: '255.255.255.0' } } },
    { method: 'POST', path: '/api/dnsmasq/service/reconfigure', body: {} },
  ]);
  assert.equal(result.snapshot.range.subnet_mask, '');
  assert.equal(result.range.end_addr, '10.0.10.199');
  assert.equal(result.range.lease_time, '');
});

test('mask reconciliation refuses outside clients and stops on unexpected saved-field drift', async () => {
  for (const options of [{ outsideLease: true }, { outsideReservation: true }, { ignoredSave: true }, { extraChange: true }]) {
    const result = await scenario({ mask: true, ...options });
    assert.notEqual(result.code, 0, result.output);
    if (options.outsideLease || options.outsideReservation) assert(result.requests.every(request => request.method === 'GET'));
    else assert(!result.requests.some(request => request.path.endsWith('/reconfigure')));
  }
});

test('mask values are fixed and the corrected pool and expected old mask are required', async () => {
  for (const options of [
    { variables: { opnsense_range_field: 'lease_time' } },
    { variables: { opnsense_range_desired_value: '255.255.0.0' } },
    { variables: { opnsense_range_expected_value: '255.255.0.0' } },
    { uncorrectedPool: true },
    { currentMask: '255.255.254.0' },
  ]) {
    const result = await scenario({ mask: true, ...options });
    assert.notEqual(result.code, 0, result.output);
    assert(result.requests.every(request => request.method === 'GET'));
    if (options.variables) assert.deepEqual(result.requests, []);
  }
});