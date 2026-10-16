import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { expectedConfiguration, patchFor, targets } from './talos-prefix-pilot.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.TALOSCTL_BINARY ?? path.join(os.homedir(), '.local/share/owl-red/tools/talos/1.8.1/talosctl');
const patchFile = path.join(repository, 'talos/patches/management-prefix-worker1.yaml');

function parseYaml(content) {
  const result = spawnSync('python3', ['-c', 'import json,sys,yaml;json.dump(yaml.safe_load(sys.stdin.read()),sys.stdout)'], {
    input: content, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, 'Python 3/PyYAML must parse the configuration');
  return JSON.parse(result.stdout);
}

test('prefix pilot tests use the matching Talos 1.8.1 client', () => {
  const result = spawnSync(binary, ['version', '--client'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, 'Set TALOSCTL_BINARY to the checksum-verified Talos 1.8.1 executable');
  assert.match(result.stdout, /Tag:\s+v1\.8\.1/);
});

test('worker migration has exact identity guards and one address-list replacement', () => {
  const patch = parseYaml(fs.readFileSync(patchFile, 'utf8'));
  assert.deepEqual(patch, [
    { op: 'test', path: '/machine/type', value: 'worker' },
    { op: 'test', path: '/machine/network/hostname', value: 'worker1-talos' },
    { op: 'test', path: '/machine/network/interfaces/0/deviceSelector/hardwareAddr', value: '02:00:00:00:00:24' },
    { op: 'test', path: '/machine/network/interfaces/0/addresses', value: ['10.0.10.24/16'] },
    { op: 'replace', path: '/machine/network/interfaces/0/addresses', value: ['10.0.10.24/24'] },
  ]);
  assert.deepEqual(patch, patchFor('worker1-talos'));
  const bootstrap = parseYaml(fs.readFileSync(path.join(repository, 'talos/patches/worker1.yaml'), 'utf8'));
  assert.equal(Array.isArray(bootstrap), false);
  assert.equal(bootstrap.machine.network.interfaces[0].deviceSelector.hardwareAddr, '02:00:00:00:00:24');
});

test('controller allowlist and full-configuration expectation preserve control-plane VIP and unrelated fields', () => {
  assert.deepEqual(Object.keys(targets).sort(), ['cp1-talos', 'cp2-talos', 'cp3-talos', 'worker1-talos']);
  assert.throws(() => patchFor('storage_pve'));
  assert.throws(() => patchFor('worker1-talos,cp1-talos'));
  for (const [name, target] of Object.entries(targets)) {
    const before = { version: 'v1alpha1', machine: { type: target.role,
      install: { image: 'preserved-live-image' }, network: { hostname: name,
        nameservers: ['10.0.10.1', '1.1.1.1'], interfaces: [{ deviceSelector: { hardwareAddr: target.mac },
          addresses: [`${target.address}/16`], routes: [{ network: '0.0.0.0/0', gateway: '10.0.10.1' }],
          ...(target.role === 'controlplane' ? { vip: { ip: '10.0.10.20' } } : {}) }] } },
      cluster: { clusterName: 'owl-k8s', unrelated: 'preserved' } };
    const expected = structuredClone(before);
    expected.machine.network.interfaces[0].addresses = [`${target.address}/24`];
    assert.deepEqual(expectedConfiguration(before, name), expected);
    assert.equal(before.machine.network.interfaces[0].addresses[0], `${target.address}/16`);
    const drifted = structuredClone(before);
    drifted.machine.network.interfaces.push({ addresses: ['192.0.2.1/24'] });
    assert.throws(() => expectedConfiguration(drifted, name));
    const dnsDrift = structuredClone(before);
    dnsDrift.machine.network.nameservers = ['10.0.10.30'];
    assert.throws(() => expectedConfiguration(dnsDrift, name));
  }
  const source = fs.readFileSync(path.join(repository, 'scripts/talos-prefix-pilot.mjs'), 'utf8');
  assert(source.includes("'apply-confirmed': { type: 'boolean', default: false }"));
  assert(source.includes("'--mode', 'try', '--timeout', '3m'"));
  assert(source.includes("'--mode', 'no-reboot'"));
  assert(!/--insecure|--mode', '(auto|reboot)'/.test(source));
});

test('accepted bootstrap and inventory network intent matches all four live guest prefixes', () => {
  const inventory = parseYaml(fs.readFileSync(path.join(repository, 'ansible/inventory/hosts.yml'), 'utf8'));
  for (const [name, target] of Object.entries(targets)) {
    const shortName = name.replace(/-talos$/, '');
    const bootstrap = parseYaml(fs.readFileSync(path.join(repository, `talos/patches/${shortName}.yaml`), 'utf8'));
    assert.deepEqual(bootstrap.machine.network, { hostname: name, interfaces: [{
      deviceSelector: { hardwareAddr: target.mac }, addresses: [`${target.address}/24`],
      routes: [{ network: '0.0.0.0/0', gateway: '10.0.10.1' }],
      ...(target.role === 'controlplane' ? { vip: { ip: '10.0.10.20' } } : {}),
    }], nameservers: ['10.0.10.1', '1.1.1.1'] });
    const host = inventory.all.children.talos_k8s_hosts.hosts[`${shortName}_k8s`];
    assert.equal(host.addressing.current_flat.ip, target.address);
    assert.equal(host.addressing.current_flat.prefix, 24);
  }
});

test('actual Talos patch engine preserves other fields and refuses identity or address drift', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-talos-prefix-test-'));
  const original = {
    version: 'v1alpha1',
    machine: { type: 'worker', network: { hostname: 'worker1-talos', nameservers: ['10.0.10.1', '1.1.1.1'],
      interfaces: [{ deviceSelector: { hardwareAddr: '02:00:00:00:00:24' }, addresses: ['10.0.10.24/16'],
        routes: [{ network: '0.0.0.0/0', gateway: '10.0.10.1' }] }] } },
    cluster: { clusterName: 'owl-k8s', controlPlane: { endpoint: 'https://10.0.10.20:6443' } },
  };
  const runPatch = (filename, patch) => spawnSync(binary, ['machineconfig', 'patch', filename, '--patch', patch], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, TALOSCONFIG: path.join(directory, 'no-cluster-context') },
  });
  try {
    for (const [index, variant] of ['healthy', 'wrong-role', 'wrong-hostname', 'wrong-mac',
      'wrong-address', 'already-contracted', 'extra-address', 'missing-selector'].entries()) {
      const fixture = structuredClone(original);
      if (variant === 'wrong-role') fixture.machine.type = 'controlplane';
      if (variant === 'wrong-hostname') fixture.machine.network.hostname = 'cp1-talos';
      if (variant === 'wrong-mac') fixture.machine.network.interfaces[0].deviceSelector.hardwareAddr = '02:00:00:00:00:21';
      if (variant === 'wrong-address') fixture.machine.network.interfaces[0].addresses = ['10.0.10.25/16'];
      if (variant === 'already-contracted') fixture.machine.network.interfaces[0].addresses = ['10.0.10.24/24'];
      if (variant === 'extra-address') fixture.machine.network.interfaces[0].addresses.push('10.0.10.25/16');
      if (variant === 'missing-selector') delete fixture.machine.network.interfaces[0].deviceSelector;
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify(fixture));
      const result = runPatch(filename, `@${patchFile}`);
      if (variant === 'healthy') {
        assert.equal(result.status, 0, result.stderr);
        const canonical = runPatch(filename, '[]');
        assert.equal(canonical.status, 0, canonical.stderr);
        const expected = parseYaml(canonical.stdout);
        expected.machine.network.interfaces[0].addresses = ['10.0.10.24/24'];
        assert.deepEqual(parseYaml(result.stdout), expected);
      } else {
        assert.notEqual(result.status, 0, variant);
      }
      assert.deepEqual(JSON.parse(fs.readFileSync(filename, 'utf8')), fixture);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});