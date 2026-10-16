import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binaryHash = 'c44180a3a4e91325a820464a9bff5ba3e5e86840ca8faa1d2f2e1340ecdd9271';
export const targets = {
  'worker1-talos': { address: '10.0.10.24', mac: '02:00:00:00:00:24', role: 'worker' },
  'cp1-talos': { address: '10.0.10.21', mac: '02:00:00:00:00:21', role: 'controlplane' },
  'cp2-talos': { address: '10.0.10.22', mac: '02:00:00:00:00:22', role: 'controlplane' },
  'cp3-talos': { address: '10.0.10.23', mac: '02:00:00:00:00:23', role: 'controlplane' },
};

export function patchFor(name) {
  assert(Object.hasOwn(targets, name), 'Select exactly one allowlisted Talos guest');
  const target = targets[name];
  return [
    { op: 'test', path: '/machine/type', value: target.role },
    { op: 'test', path: '/machine/network/hostname', value: name },
    { op: 'test', path: '/machine/network/interfaces/0/deviceSelector/hardwareAddr', value: target.mac },
    { op: 'test', path: '/machine/network/interfaces/0/addresses', value: [`${target.address}/16`] },
    { op: 'replace', path: '/machine/network/interfaces/0/addresses', value: [`${target.address}/24`] },
  ];
}

export function expectedConfiguration(before, name) {
  assert(Object.hasOwn(targets, name), 'Select exactly one allowlisted Talos guest');
  const target = targets[name];
  assert.equal(before.machine.type, target.role);
  const network = before.machine.network;
  assert.equal(network.hostname, name);
  assert.equal(network.interfaces.length, 1);
  assert.deepEqual(network.interfaces[0].deviceSelector, { hardwareAddr: target.mac });
  assert.deepEqual(network.interfaces[0].addresses, [`${target.address}/16`]);
  assert.deepEqual(network.interfaces[0].routes, [{ network: '0.0.0.0/0', gateway: '10.0.10.1' }]);
  assert.deepEqual(network.nameservers, ['10.0.10.1', '1.1.1.1']);
  if (target.role === 'controlplane') assert.deepEqual(network.interfaces[0].vip, { ip: '10.0.10.20' });
  const expected = structuredClone(before);
  expected.machine.network.interfaces[0].addresses = [`${target.address}/24`];
  return expected;
}

function main() {
  const { values } = parseArgs({ options: { node: { type: 'string' }, 'apply-confirmed': { type: 'boolean', default: false } } });
  const name = values.node;
  const patch = patchFor(name);
  const target = targets[name];
  const binary = process.env.TALOSCTL_BINARY ?? path.join(os.homedir(), '.local/share/owl-red/tools/talos/1.8.1/talosctl');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), binaryHash, 'Use the verified official Talos 1.8.1 executable');
  const parent = path.join(os.homedir(), '.local/state/owl-red/talos-prefix');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(parent, `${name}-`));
  fs.chmodSync(directory, 0o700);
  const save = (filename, content) => fs.writeFileSync(path.join(directory, filename), typeof content === 'string'
    ? content : JSON.stringify(content, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const execute = (command, args, input) => {
    const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) {
      save('command-error.json', { command, args, status: result.status, stdout: result.stdout, stderr: result.stderr });
      throw new Error('Command failed; inspect private evidence and actual state before any retry');
    }
    return result.stdout;
  };
  const parse = content => JSON.parse(execute('python3', ['-c', 'import json,sys,yaml;json.dump(yaml.safe_load(sys.stdin.read()),sys.stdout)'], content));
  const decode = content => JSON.parse(execute('python3', ['-c', 'import json,sys;decoder=json.JSONDecoder();text=sys.stdin.read();result=[]\nwhile text.strip():\n value,end=decoder.raw_decode(text.lstrip());result.append(value);text=text.lstrip()[end:]\njson.dump(result,sys.stdout)'], content)).flat();
  const api = ['--context', 'owl-k8s', '--endpoints', target.address, '--nodes', target.address];
  const configuration = () => JSON.parse(execute(binary, [...api, 'get', 'machineconfig', 'v1alpha1', '-o', 'json'])).spec;
  const runtime = prefix => {
    const version = execute(binary, [...api, 'version']);
    assert.equal((version.match(/Tag:\s+v1\.8\.1/g) ?? []).length, 2, 'Client and server must both remain 1.8.1');
    const addresses = decode(execute(binary, [...api, 'get', 'addresses', '-o', 'json'])).map(resource => resource.spec);
    const own = addresses.filter(address => address.family === 'inet4' && address.address.startsWith(`${target.address}/`));
    assert.equal(own.length, 1, 'Exactly one runtime management address is required');
    assert.equal(own[0].address, `${target.address}/${prefix}`);
    const defaults = decode(execute(binary, [...api, 'get', 'routes', '-o', 'json']))
      .map(resource => resource.spec).filter(route => route.gateway === '10.0.10.1');
    assert(defaults.length > 0, 'The existing runtime gateway must remain present');
    const bootIdentity = execute(binary, [...api, 'read', '/proc/sys/kernel/random/boot_id']).trim();
    assert.match(bootIdentity, /^[a-f0-9-]{36}$/);
    return { address: own[0], defaults, bootIdentity };
  };
  const health = () => {
    const kubernetes = ['--context', 'admin@owl-k8s', '--request-timeout=8s'];
    const nodes = JSON.parse(execute('kubectl', [...kubernetes, 'get', 'nodes', '-o', 'json'])).items;
    assert.deepEqual(nodes.map(node => node.metadata.name).sort(), Object.keys(targets).sort());
    assert(nodes.every(node => node.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True')));
    for (const address of ['10.0.10.20', '10.0.10.21', '10.0.10.22', '10.0.10.23']) {
      assert.equal(execute('kubectl', [...kubernetes, `--server=https://${address}:6443`, 'get', '--raw=/readyz']).trim(), 'ok');
    }
    const vipAddresses = decode(execute(binary, ['--context', 'owl-k8s', '--endpoints', '10.0.10.21',
      '--nodes', '10.0.10.21,10.0.10.22,10.0.10.23', 'get', 'addresses', '-o', 'json']))
      .map(resource => resource.spec.address).filter(address => address.startsWith('10.0.10.20/'));
    assert.deepEqual(vipAddresses, ['10.0.10.20/32'], 'Exactly one live API VIP must retain /32');
    const members = execute(binary, ['--context', 'owl-k8s', '--endpoints', '10.0.10.21', '--nodes', '10.0.10.21', 'etcd', 'members']);
    const rows = members.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row[2]).sort(), ['cp1-talos', 'cp2-talos', 'cp3-talos']);
    assert(rows.every(row => row.at(-1) === 'false'));
    return { allFourNodesReady: true, apiVipAndThreeDirectEndpointsReady: true, apiVipRemains32: true, threeEtcdVotingMembers: true };
  };
  let phase = 'preview';
  try {
    const before = configuration();
    save('machine.before.yaml', before);
    const expected = expectedConfiguration(parse(before), name);
    save('patch.json', patch);
    const candidate = execute(binary, ['machineconfig', 'patch', path.join(directory, 'machine.before.yaml'), '--patch', JSON.stringify(patch)]);
    assert.deepEqual(parse(candidate), expected, 'The complete candidate may differ only by one address-list replacement');
    save('machine.candidate.yaml', candidate);
    save('server-dry-run.log', execute(binary, [...api, 'apply-config', '--file', path.join(directory, 'machine.candidate.yaml'), '--mode', 'no-reboot', '--dry-run']));
    const beforeRuntime = runtime(16);
    save('runtime-before.json', beforeRuntime);
    save('health-before.json', health());
    assert.deepEqual(parse(configuration()), parse(before), 'Refuse configuration drift since the private preimage');
    if (!values['apply-confirmed']) {
      const report = { node: name, previewOnly: true, candidateOnlyCidrChange: true, liveStateUnchanged: true, directory };
      save('result.json', report);
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    phase = 'trial';
    const trialStarted = Date.now();
    save('trial.log', execute(binary, [...api, 'apply-config', '--file', path.join(directory, 'machine.candidate.yaml'), '--mode', 'try', '--timeout', '3m']));
    save('health-trial.json', health());
    assert.deepEqual(parse(configuration()), expected);
    const trialRuntime = runtime(24);
    assert.equal(trialRuntime.bootIdentity, beforeRuntime.bootIdentity, 'No reboot is allowed');
    assert.deepEqual(trialRuntime.defaults, beforeRuntime.defaults);
    assert.equal(trialRuntime.address.linkIndex, beforeRuntime.address.linkIndex);
    assert.equal(trialRuntime.address.linkName, beforeRuntime.address.linkName);
    save('runtime-trial.json', trialRuntime);
    assert(Date.now() - trialStarted < 120000, 'Leave at least one minute for local automatic recovery');
    assert.deepEqual(parse(configuration()), expected, 'Refuse drift before confirming the trial');
    save('confirmation.log', execute(binary, [...api, 'apply-config', '--file', path.join(directory, 'machine.candidate.yaml'), '--mode', 'no-reboot']));
    phase = 'confirmed';
    assert.deepEqual(parse(configuration()), expected);
    const afterRuntime = runtime(24);
    assert.equal(afterRuntime.bootIdentity, beforeRuntime.bootIdentity);
    assert.deepEqual(afterRuntime.defaults, beforeRuntime.defaults);
    save('runtime-after.json', afterRuntime);
    save('health-after.json', health());
    const report = { observedAt: new Date().toISOString(), node: name, address: `${target.address}/24`,
      completeConfigurationOnlyCidrChanged: true, versionAndBootIdentityUnchanged: true,
      apiVipAndThreeDirectEndpointsReady: true, allFourNodesReady: true, threeEtcdVotingMembers: true,
      trialConfirmedWithoutReboot: true, directory };
    save('result.json', report);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    save('failure.json', { phase, observedAt: new Date().toISOString(), inspectActualStateBeforeRetry: true });
    throw new Error(`Talos prefix pilot stopped in ${phase}; inspect ${directory}. In trial mode leave automatic recovery alone; a confirmed change is not automatically reverted.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}