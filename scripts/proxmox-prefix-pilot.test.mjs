import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const document = spawnSync('python3', ['-c',
  'import json,pathlib,yaml; print(json.dumps(yaml.safe_load(pathlib.Path("ansible/playbooks/proxmox-prefix-pilot.yml").read_text())))'],
{ cwd: repository, encoding: 'utf8' });
assert.equal(document.status, 0, 'Python 3 and PyYAML are required');
const play = JSON.parse(document.stdout)[0];
const rollbackSource = play.vars.proxmox_prefix_pilot_rollback_script;
const confirmSource = play.vars.proxmox_prefix_pilot_confirm_script;
const beforeText = 'auto lo\niface lo inet loopback\n\niface nic0 inet manual\n\nauto vmbr0\niface vmbr0 inet static\n address 10.0.10.14/16\n gateway 10.0.10.1\n';
const stagedText = beforeText.replace('10.0.10.14/16', '10.0.10.14/24');
const digest = content => createHash('sha256').update(content).digest('hex');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-prefix-test-'));
  const config = path.join(directory, 'interfaces');
  const state = path.join(directory, 'state');
  fs.mkdirSync(state, { mode: 0o700 });
  fs.writeFileSync(config, stagedText, { mode: 0o644 });
  fs.writeFileSync(path.join(state, 'interfaces.before'), beforeText, { mode: 0o600 });
  fs.writeFileSync(path.join(state, 'before.sha256'), digest(beforeText) + '\n');
  fs.writeFileSync(path.join(state, 'staged.sha256'), digest(stagedText) + '\n');
  const reload = path.join(directory, 'fake-reload');
  const systemctl = path.join(directory, 'fake-systemctl');
  fs.writeFileSync(reload, `#!/bin/sh\nprintf 'reload\\n' >> '${directory}/reload.log'\n`, { mode: 0o700 });
  fs.writeFileSync(systemctl, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${directory}/systemctl.log'\n`, { mode: 0o700 });
  return { directory, config, state, reload, systemctl,
    clean() { fs.rmSync(directory, { recursive: true, force: true }); } };
}

function execute(source, args) {
  return spawnSync('bash', ['-c', source, 'offline-prefix-test', ...args], { encoding: 'utf8', timeout: 10000 });
}

function rollback(fixture) {
  return execute(rollbackSource, [fixture.state, fixture.config, fixture.reload]);
}

function confirm(fixture) {
  return execute(confirmSource, [fixture.state, fixture.config, 'offline-timer', fixture.systemctl]);
}

test('policy is topology-allowlisted, one-host, default-deny and guarded in check mode', () => {
  assert.equal(play.hosts, 'edge_pve:storage_pve:cp1_pve:cp2_pve:cp3_pve:worker1_pve');
  assert.equal(play.serial, 1);
  assert.equal(play.any_errors_fatal, true);
  assert.deepEqual(Object.keys(play.vars.proxmox_prefix_pilot_targets).sort(), ['cp1_pve', 'cp2_pve', 'cp3_pve', 'worker1_pve', 'edge_pve', 'storage_pve'].sort());
  assert.equal(play.vars.proxmox_prefix_pilot_apply_confirmed, false);
  assert.equal(play.vars.proxmox_prefix_pilot_rollback_seconds, 180);
  const activation = play.tasks.find(task => task.name.startsWith('Stage and activate'));
  assert.ok(activation.when.includes('not ansible_check_mode'));
  const names = activation.block.map(task => task.name);
  assert.ok(names.indexOf('Arm recovery before activating any network change')
    < names.indexOf('Activate the staged network through PVE without FRR regeneration'));
  assert.ok(names.indexOf('Require successful reload completion')
    < names.indexOf('Confirm only while holding the rollback lock'));
  assert.ok(activation.block.find(task => task.name === 'Require the approved runtime and persisted prefix')
    ['ansible.builtin.assert'].that.some(condition => condition.includes("selectattr('family', 'equalto', 'inet')")));
  function inspect(tasks) {
    for (const task of tasks) {
      for (const argument of task['ansible.builtin.command']?.argv ?? []) {
        if (typeof argument === 'string' && argument.startsWith('/nodes/')) {
          assert.ok(argument.includes('{{ proxmox_prefix_pilot_node }}'), task.name);
        }
      }
      for (const condition of task['ansible.builtin.assert']?.that ?? []) {
        assert.ok(['string', 'boolean'].includes(typeof condition), task.name);
      }
      for (const section of ['block', 'rescue', 'always']) inspect(task[section] ?? []);
    }
  }
  inspect(play.tasks);
});

test('actual scope guard resolves topology mappings and refuses NAS, wrong IP or multiple hosts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-prefix-scope-test-'));
  try {
    const samples = [
      { host: 'cp1_pve', ip: '10.0.10.11', node: 'cp1', guest: 'cp1-talos', api: '10.0.10.21', accepted: true },
      { host: 'cp2_pve', ip: '10.0.10.12', node: 'cp2', guest: 'cp2-talos', api: '10.0.10.22', accepted: true },
      { host: 'cp3_pve', ip: '10.0.10.13', node: 'cp3', guest: 'cp3-talos', api: '10.0.10.23', accepted: true },
      { host: 'worker1_pve', ip: '10.0.10.14', node: 'worker1', guest: 'worker1-talos', api: '', accepted: true },
      { host: 'edge_pve', ip: '10.0.10.3', node: 'edge', guest: '', api: '', accepted: true },
      { host: 'storage_pve', ip: '10.0.10.4', node: 'storage', guest: '', api: '', accepted: true },
      { host: 'nas_unraid', ip: '10.0.10.5', accepted: false },
      { host: 'storage_pve', ip: '10.0.10.5', accepted: false },
      { host: 'cp1_pve', ip: '10.0.10.3', accepted: false },
      { host: 'cp1_pve', ip: '10.0.10.11', overrides: { proxmox_prefix_pilot_api_address: '10.0.10.23' }, accepted: false },
      { host: 'cp1_pve', ip: '10.0.10.11', extra: 'cp2_pve ansible_host=10.0.10.12', accepted: false },
    ];
    for (const [index, sample] of samples.entries()) {
      const inventory = path.join(directory, `case-${index}.ini`);
      fs.writeFileSync(inventory, `${sample.host} ansible_host=${sample.ip}\n${sample.extra ?? ''}\n`);
      const tasks = [play.tasks[0]];
      if (sample.accepted) tasks.push({ name: 'Verify resolved target only', 'ansible.builtin.assert': { that: [
        `proxmox_prefix_pilot_node == '${sample.node}'`,
        `proxmox_prefix_pilot_address == '${sample.ip}'`,
        `proxmox_prefix_pilot_guest == '${sample.guest}'`,
        `proxmox_prefix_pilot_api_address == '${sample.api}'`,
        `proxmox_prefix_pilot_after == '${sample.ip}/24'`,
      ] } });
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify([{ hosts: 'all', connection: 'local', gather_facts: false,
        vars: { ...play.vars, ...sample.overrides }, tasks }]));
      const result = spawnSync('ansible-playbook', ['-i', inventory, filename, '--check'], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (sample.accepted) assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0, sample.host);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('both production recovery programs have valid Bash syntax', () => {
  for (const source of [rollbackSource, confirmSource]) {
    const result = spawnSync('bash', ['-n'], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('only the known zero-byte PVE SDN include is allowed by the actual preflight expression', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-prefix-include-test-'));
  try {
    const conditions = play.tasks.find(task => task.name === "Refuse unexpected topology or another operator's pending changes")
      ['ansible.builtin.assert'].that.filter(condition => typeof condition === 'string' && condition.includes('_prefix_includes'));
    assert.equal(conditions.length, 1);
    const cases = [
      { expected: 0, value: { matched: 0, files: [] } },
      { expected: 0, value: { matched: 1, files: [{ path: '/etc/network/interfaces.d/sdn', size: 0, isreg: true, islnk: false }] } },
      { expected: 1, value: { matched: 1, files: [{ path: '/etc/network/interfaces.d/sdn', size: 10, isreg: true, islnk: false }] } },
      { expected: 1, value: { matched: 1, files: [{ path: '/etc/network/interfaces.d/other', size: 0, isreg: true, islnk: false }] } },
      { expected: 1, value: { matched: 1, files: [{ path: '/etc/network/interfaces.d/sdn', size: 0, isreg: false, islnk: true }] } },
    ];
    for (const [index, sample] of cases.entries()) {
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify([{ hosts: 'localhost', connection: 'local', gather_facts: false,
        vars: { _prefix_includes: sample.value },
        tasks: [{ name: 'Exercise production include policy', 'ansible.builtin.assert': { that: conditions } }] }]), { mode: 0o600 });
      const result = spawnSync('ansible-playbook', ['-i', 'localhost,', filename], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (sample.expected === 0) assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the actual staged guards accept PVE headers but reject directive or parsed-model drift', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-prefix-model-test-'));
  try {
    const activation = play.tasks.find(task => task.name.startsWith('Stage and activate'));
    const selected = new Set(['Refuse any staged directive change beyond CIDR and formatting',
      'Capture the original parsed bridge', 'Require the reviewed parsed interface set',
      'Build the one-field expected interface model', 'Refuse any other parsed interface change before activation']);
    const tasks = activation.block.filter(task => selected.has(task.name));
    assert.equal(tasks.length, 5);
    const original = [
      { name: 'lo', addr_method: 'loopback', addr_family: 'inet', auto: true, config: {} },
      { name: 'nic0', addr_method: 'manual', addr_family: 'inet', auto: false, config: {} },
      { name: 'vmbr0', addr_method: 'static', addr_family: 'inet', auto: true,
        config: { address: '10.0.10.14/16', gateway: '10.0.10.1', 'bridge-ports': 'nic0' } },
    ];
    for (const variant of ['pve-header', 'extra-directive', 'other-parsed-field']) {
      const staged = structuredClone(original);
      staged[2].config.address = '10.0.10.14/24';
      if (variant === 'other-parsed-field') staged[1].auto = true;
      const text = '# PVE autogenerated network settings\n\n' + stagedText
        + (variant === 'extra-directive' ? 'post-up unexpected-command\n' : '');
      const definition = [{ hosts: 'localhost', connection: 'local', gather_facts: false,
        vars: { proxmox_prefix_pilot_target: play.vars.proxmox_prefix_pilot_targets.worker1_pve,
          proxmox_prefix_pilot_before: '10.0.10.14/16', proxmox_prefix_pilot_after: '10.0.10.14/24',
          _prefix_source: { content: Buffer.from(beforeText).toString('base64') },
          _prefix_staged: { content: Buffer.from(text).toString('base64') },
          _prefix_original_parsed: { stdout: JSON.stringify(original) },
          _prefix_staged_parsed: { stdout: JSON.stringify(staged) } }, tasks }];
      const filename = path.join(directory, `${variant}.json`);
      fs.writeFileSync(filename, JSON.stringify(definition), { mode: 0o600 });
      const result = spawnSync('ansible-playbook', ['-i', 'localhost,', filename], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (variant === 'pve-header') assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0, variant);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('edge topology and protected guest guards reject NIC, passthrough, router PID or DNS daemon drift', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-edge-guards-test-'));
  try {
    const activation = play.tasks.find(task => task.name.startsWith('Stage and activate'));
    const names = new Set(['Refuse any staged directive change beyond CIDR and formatting',
      'Capture the original parsed bridge', 'Require the reviewed parsed interface set',
      'Build the one-field expected interface model', 'Refuse any other parsed interface change before activation']);
    const protectedBlock = activation.block.find(task => task.name === 'Verify protected guest configurations and power state after the host reload');
    const tasks = [...activation.block.filter(task => names.has(task.name)),
      play.tasks.find(task => task.name === 'Refuse an already stopped protected guest'),
      ...protectedBlock.block.filter(task => task['ansible.builtin.assert']),
      activation.block.find(task => task.name === 'Require the Technitium process to remain running without a restart')];
    for (const [index, variant] of ['healthy', 'extra-nic-drift', 'passthrough-drift', 'router-restart',
      'missing-router-pid', 'dns-restart', 'stopped-container'].entries()) {
      const target = play.vars.proxmox_prefix_pilot_targets.edge_pve;
      const original = target.interfaces.map(name => ({ name, addr_method: name === 'lo' ? 'loopback'
        : name === 'vmbr0' ? 'static' : 'manual', addr_family: 'inet',
      auto: ['lo', 'vmbr0'].includes(name), config: name === 'vmbr0'
        ? { address: '10.0.10.3/16', gateway: '10.0.10.1', 'bridge-ports': 'onboard' } : {} }));
      const staged = structuredClone(original);
      staged.find(device => device.name === 'vmbr0').config.address = '10.0.10.3/24';
      const textModels = structuredClone(staged);
      if (variant === 'extra-nic-drift') staged.find(device => device.name === 'nic3').auto = true;
      const serialize = interfaces => interfaces.map(device => [
        ...(device.auto ? [`auto ${device.name}`] : []),
        `iface ${device.name} ${device.addr_family} ${device.addr_method}`,
        ...Object.entries(device.config).map(([name, value]) => ` ${name} ${value}`),
      ].join('\n')).join('\n\n') + '\n';
      const source = serialize(original);
      const reorderedStagedText = serialize([...textModels.filter(device => device.name !== 'vmbr0'),
        textModels.find(device => device.name === 'vmbr0')]);
      const guestItems = [{ kind: 'qemu', id: '100' }, { kind: 'lxc', id: '200' }];
      const configs = [{ hostpci0: '0000:01:00,pcie=1', hostpci1: '0000:04:00,pcie=1' },
        { net0: 'bridge=vmbr0,ip=10.0.10.30/24' }];
      const changedConfigs = structuredClone(configs);
      if (variant === 'passthrough-drift') changedConfigs[0].hostpci0 = 'different-pci-device';
      const statuses = [{ status: 'running', pid: 111 }, { status: 'running' }];
      const changedStatuses = structuredClone(statuses);
      if (variant === 'router-restart') changedStatuses[0].pid = 222;
      if (variant === 'missing-router-pid') delete statuses[0].pid;
      if (variant === 'stopped-container') changedStatuses[1].status = 'stopped';
      const results = values => ({ results: values.map((value, guestIndex) => ({
        item: guestItems[guestIndex], stdout: JSON.stringify(value),
      })) });
      const definition = [{ hosts: 'localhost', connection: 'local', gather_facts: false,
        vars: { proxmox_prefix_pilot_node: 'edge', proxmox_prefix_pilot_target: target,
          proxmox_prefix_pilot_before: '10.0.10.3/16', proxmox_prefix_pilot_after: '10.0.10.3/24',
          _prefix_source: { content: Buffer.from(source).toString('base64') },
          _prefix_staged: { content: Buffer.from('# Generated header\n' + reorderedStagedText).toString('base64') },
          _prefix_original_parsed: { stdout: JSON.stringify(original) },
          _prefix_staged_parsed: { stdout: JSON.stringify(staged) },
          _prefix_protected_config_before: results(configs), _prefix_protected_config_after: results(changedConfigs),
          _prefix_protected_status_before: results(statuses), _prefix_protected_status_after: results(changedStatuses),
          _prefix_dns_pid_before: { stdout: '123' },
          _prefix_dns_pid_after: { stdout: variant === 'dns-restart' ? '456' : '123' } }, tasks }];
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify(definition));
      const result = spawnSync('ansible-playbook', ['-i', 'localhost,', filename], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (variant === 'healthy') assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0, variant);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('storage guards preserve bond, NAS VM devices/process and guest network identity', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-storage-guards-test-'));
  try {
    const activation = play.tasks.find(task => task.name.startsWith('Stage and activate'));
    const modelNames = new Set(['Refuse any staged directive change beyond CIDR and formatting',
      'Capture the original parsed bridge', 'Require the reviewed parsed interface set',
      'Build the one-field expected interface model', 'Refuse any other parsed interface change before activation']);
    const protectedBlock = activation.block.find(task => task.name === 'Verify protected guest configurations and power state after the host reload');
    const tasks = [...activation.block.filter(task => modelNames.has(task.name)),
      play.tasks.find(task => task.name === 'Require the reviewed storage bond baseline'),
      play.tasks.find(task => task.name === 'Require the expected NAS identity before changing its PVE host'),
      play.tasks.find(task => task.name === 'Refuse an already stopped protected guest'),
      activation.block.find(task => task.name === 'Require storage bond runtime parameters to remain unchanged'),
      activation.block.find(task => task.name === 'Require NAS interface identity and prefix to remain unchanged'),
      ...protectedBlock.block.filter(task => task['ansible.builtin.assert'])];
    for (const [index, variant] of ['healthy', 'bond-member-drift', 'bond-mode-drift', 'bond-auto-drift', 'bond-active-link-drift',
      'nas-passthrough-drift', 'nas-usb-boot-drift', 'nas-disk-drift', 'nas-vm-restart',
      'nas-prefix-drift', 'nas-mac-drift'].entries()) {
      const target = play.vars.proxmox_prefix_pilot_targets.storage_pve;
      const original = target.interfaces.map(name => ({ name, addr_method: name === 'lo' ? 'loopback'
        : name === 'vmbr0' ? 'static' : 'manual', addr_family: 'inet',
      auto: ['lo', 'bond0', 'vmbr0'].includes(name), config: name === 'vmbr0'
        ? { address: '10.0.10.4/16', gateway: '10.0.10.1', 'bridge-ports': 'bond0' }
        : name === 'bond0' ? { 'bond-slaves': 'obnic0 obnic1', 'bond-miimon': '100',
          'bond-mode': 'active-backup', 'bond-primary': 'obnic0' } : {} }));
      const staged = structuredClone(original);
      staged.find(device => device.name === 'vmbr0').config.address = '10.0.10.4/24';
      const textModels = structuredClone(staged);
      if (variant === 'bond-member-drift') staged.find(device => device.name === 'bond0').config['bond-slaves'] = 'obnic1';
      if (variant === 'bond-mode-drift') staged.find(device => device.name === 'bond0').config['bond-mode'] = 'balance-rr';
      if (variant === 'bond-auto-drift') staged.filter(device => ['obnic0', 'obnic1'].includes(device.name)).forEach(device => { device.auto = true; });
      const serialize = interfaces => interfaces.map(device => [
        ...(device.auto ? [`auto ${device.name}`] : []),
        `iface ${device.name} ${device.addr_family} ${device.addr_method}`,
        ...Object.entries(device.config).map(([name, value]) => ` ${name} ${value}`),
      ].join('\n')).join('\n\n') + '\n';
      const bond = Object.entries(target.bond_parameters).map(([item, value]) => ({
        item, content: Buffer.from(value + '\n').toString('base64'),
      }));
      const changedBond = structuredClone(bond);
      if (variant === 'bond-active-link-drift') changedBond.find(item => item.item === 'active_slave').content = Buffer.from('obnic1\n').toString('base64');
      const config = { hostpci0: '0000:01:00,pcie=1,rombar=0', usb0: 'host=24a9:205a,usb3=1',
        scsi0: 'existing-boot-device', boot: 'order=scsi0' };
      const changedConfig = structuredClone(config);
      if (variant === 'nas-passthrough-drift') changedConfig.hostpci0 = 'different-device';
      if (variant === 'nas-usb-boot-drift') changedConfig.usb0 = 'different-usb-device';
      if (variant === 'nas-disk-drift') changedConfig.scsi0 = 'different-boot-device';
      const guestItem = { kind: 'qemu', id: '101' };
      const resultFor = value => ({ results: [{ item: guestItem, stdout: JSON.stringify(value) }] });
      const nas = [{ ifname: 'eth0', address: 'f8:f2:1e:48:91:40', addr_info: [
        { family: 'inet', local: '10.0.10.5', prefixlen: 16 },
      ] }];
      const changedNas = structuredClone(nas);
      if (variant === 'nas-prefix-drift') changedNas[0].addr_info[0].prefixlen = 24;
      if (variant === 'nas-mac-drift') changedNas[0].address = 'f8:f2:1e:48:91:41';
      const definition = [{ hosts: 'localhost', connection: 'local', gather_facts: false,
        vars: { proxmox_prefix_pilot_node: 'storage', proxmox_prefix_pilot_target: target,
          proxmox_prefix_pilot_before: '10.0.10.4/16', proxmox_prefix_pilot_after: '10.0.10.4/24',
          _prefix_source: { content: Buffer.from(serialize(original)).toString('base64') },
          _prefix_staged: { content: Buffer.from('# Generated header\n' + serialize(textModels)).toString('base64') },
          _prefix_original_parsed: { stdout: JSON.stringify(original) },
          _prefix_staged_parsed: { stdout: JSON.stringify(staged) },
          _prefix_bond_before: { results: bond }, _prefix_bond_after: { results: changedBond },
          _prefix_nas_before: { stdout: JSON.stringify(nas) }, _prefix_nas_after: { stdout: JSON.stringify(changedNas) },
          _prefix_protected_config_before: resultFor(config), _prefix_protected_config_after: resultFor(changedConfig),
          _prefix_protected_status_before: resultFor({ status: 'running', pid: 111 }),
          _prefix_protected_status_after: resultFor({ status: 'running', pid: variant === 'nas-vm-restart' ? 222 : 111 }) }, tasks }];
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify(definition));
      const result = spawnSync('ansible-playbook', ['-i', 'localhost,', filename], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (variant === 'healthy') assert.equal(result.status, 0, result.stdout + result.stderr);
      else assert.notEqual(result.status, 0, variant);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('storage exact staging changes only CIDR and refuses source drift or pending-file collision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-storage-staging-test-'));
  try {
    const activation = play.tasks.find(task => task.name.startsWith('Stage and activate'));
    const apiStage = activation.block.find(task => task.name === 'Stage only the management CIDR through the PVE API');
    assert.equal(apiStage.when, "proxmox_prefix_pilot_node != 'storage'");
    const stageNames = new Set(['Refuse storage source drift since its recovery preimage',
      'Stage the exact storage preimage with only its CIDR replaced',
      'Require storage staging to create its own new pending file']);
    const tasks = activation.block.filter(task => stageNames.has(task.name));
    assert.equal(tasks.length, 3);
    const copyTask = tasks.find(task => task['ansible.builtin.copy']);
    assert.equal(copyTask.when, "proxmox_prefix_pilot_node == 'storage'");
    assert.equal(copyTask['ansible.builtin.copy'].dest, '/etc/network/interfaces.new');
    assert.equal(copyTask['ansible.builtin.copy'].owner, 'root');
    assert.equal(copyTask['ansible.builtin.copy'].group, 'root');
    assert.equal(copyTask['ansible.builtin.copy'].mode, '0644');
    assert.equal(copyTask['ansible.builtin.copy'].force, false);
    const source = beforeText.replaceAll('10.0.10.14/16', '10.0.10.4/16');
    for (const [index, variant] of ['fresh', 'source-drift', 'pending-collision'].entries()) {
      const pending = path.join(directory, `pending-${index}`);
      if (variant === 'pending-collision') fs.writeFileSync(pending, 'another operator pending file\n');
      const fixtureTasks = structuredClone(tasks);
      const copy = fixtureTasks.find(task => task['ansible.builtin.copy'])['ansible.builtin.copy'];
      copy.dest = pending;
      delete copy.owner;
      delete copy.group;
      const content = Buffer.from(source).toString('base64');
      const definition = [{ hosts: 'localhost', connection: 'local', gather_facts: false,
        vars: { proxmox_prefix_pilot_node: 'storage', proxmox_prefix_pilot_before: '10.0.10.4/16',
          proxmox_prefix_pilot_after: '10.0.10.4/24', _prefix_source: { content },
          _prefix_storage_source: { content: variant === 'source-drift' ? Buffer.from(source + '# changed\n').toString('base64') : content } },
        tasks: fixtureTasks }];
      const filename = path.join(directory, `case-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify(definition));
      const result = spawnSync('ansible-playbook', ['-i', 'localhost,', filename], {
        cwd: repository, encoding: 'utf8', timeout: 20000,
        env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), ANSIBLE_NOCOLOR: '1' },
      });
      if (variant === 'fresh') {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(fs.readFileSync(pending, 'utf8'), source.replaceAll('10.0.10.4/16', '10.0.10.4/24'));
        assert.equal(fs.statSync(pending).mode & 0o777, 0o644);
      } else {
        assert.notEqual(result.status, 0, variant);
        if (variant === 'pending-collision') assert.equal(fs.readFileSync(pending, 'utf8'), 'another operator pending file\n');
        else assert.equal(fs.existsSync(pending), false);
      }
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('rollback restores exactly the captured source and reloads once', () => {
  const context = fixture();
  try {
    fs.writeFileSync(context.config + '.new', stagedText);
    const result = rollback(context);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(context.config, 'utf8'), beforeText);
    assert.equal(fs.existsSync(context.config + '.new'), false);
    assert.equal(fs.readFileSync(path.join(context.directory, 'reload.log'), 'utf8'), 'reload\n');
    assert.ok(fs.existsSync(path.join(context.state, 'rolled-back')));
  } finally { context.clean(); }
});

test('confirmed state prevents a later timer from reversing the successful change', () => {
  const context = fixture();
  try {
    assert.equal(confirm(context).status, 0);
    assert.equal(rollback(context).status, 0);
    assert.equal(fs.readFileSync(context.config, 'utf8'), stagedText);
    assert.equal(fs.existsSync(path.join(context.directory, 'reload.log')), false);
    assert.equal(fs.readFileSync(path.join(context.directory, 'systemctl.log'), 'utf8'), 'stop offline-timer.timer\n');
  } finally { context.clean(); }
});

test('rollback refuses to overwrite another operator active or pending source', () => {
  for (const target of ['active', 'pending']) {
    const context = fixture();
    try {
      fs.writeFileSync(target === 'active' ? context.config : context.config + '.new', 'unrelated change\n');
      assert.notEqual(rollback(context).status, 0);
      assert.ok(fs.existsSync(path.join(context.state, 'rollback-blocked')));
      assert.equal(fs.existsSync(path.join(context.directory, 'reload.log')), false);
      assert.equal(fs.readFileSync(target === 'active' ? context.config : context.config + '.new', 'utf8'), 'unrelated change\n');
    } finally { context.clean(); }
  }
});

test('confirmation refuses an already rolled-back or drifted file', () => {
  for (const rolledBack of [true, false]) {
    const context = fixture();
    try {
      if (rolledBack) assert.equal(rollback(context).status, 0);
      else fs.writeFileSync(context.config, 'another operator change\n');
      assert.notEqual(confirm(context).status, 0);
      assert.equal(fs.existsSync(path.join(context.state, 'confirmed')), false);
    } finally { context.clean(); }
  }
});

test('a damaged preimage cannot be installed as a network rollback', () => {
  const context = fixture();
  try {
    fs.writeFileSync(path.join(context.state, 'interfaces.before'), 'damaged preimage\n');
    assert.notEqual(rollback(context).status, 0);
    assert.ok(fs.existsSync(path.join(context.state, 'rollback-blocked')));
    assert.equal(fs.readFileSync(context.config, 'utf8'), stagedText);
    assert.equal(fs.existsSync(path.join(context.directory, 'reload.log')), false);
  } finally { context.clean(); }
});

test('reload failure is not falsely recorded as completed rollback', () => {
  const context = fixture();
  try {
    fs.writeFileSync(context.reload, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
    assert.notEqual(rollback(context).status, 0);
    assert.equal(fs.existsSync(path.join(context.state, 'rolled-back')), false);
    assert.notEqual(confirm(context).status, 0);
  } finally { context.clean(); }
});

test('simultaneous confirmation and rollback serialize to one consistent outcome', async () => {
  const context = fixture();
  try {
    function run(source, args) {
      return new Promise((resolve, reject) => {
        const child = spawn('bash', ['-c', source, 'offline-prefix-test', ...args]);
        child.on('error', reject);
        child.on('close', code => resolve(code));
      });
    }
    await Promise.all([
      run(rollbackSource, [context.state, context.config, context.reload]),
      run(confirmSource, [context.state, context.config, 'offline-timer', context.systemctl]),
    ]);
    const confirmed = fs.existsSync(path.join(context.state, 'confirmed'));
    const rolledBack = fs.existsSync(path.join(context.state, 'rolled-back'));
    assert.notEqual(confirmed, rolledBack);
    assert.equal(fs.readFileSync(context.config, 'utf8'), confirmed ? stagedText : beforeText);
  } finally { context.clean(); }
});