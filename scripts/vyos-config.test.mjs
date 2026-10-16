import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ansible = process.env.ANSIBLE_PLAYBOOK || path.join(repository, '.venv/bin/ansible-playbook');
const python = process.env.PYTHON || path.join(repository, '.venv/bin/python');
const stateDirectory = path.join(os.homedir(), '.local/state/owl-red');
fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
const temporary = fs.mkdtempSync(path.join(stateDirectory, 'vyos-config-test-'));
const keyfile = path.join(temporary, 'bootstrap');
const outputDirectory = path.join(temporary, 'rendered');
const candidate = path.join(outputDirectory, 'candidate.config');
const rejectedOutput = path.join(repository, path.basename(temporary));

after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(rejectedOutput, { recursive: true, force: true });
});

const keygen = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyfile], {
  encoding: 'utf8',
});
assert.equal(keygen.status, 0, keygen.stderr);

function render(extra = {}) {
  return spawnSync(ansible, [
    '-i', 'localhost,',
    'ansible/playbooks/vyos-render.yml',
    '--extra-vars', JSON.stringify({
      vyos_output_dir: outputDirectory,
      vyos_public_key_file: `${keyfile}.pub`,
      ...extra,
    }),
  ], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      ...process.env,
      ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'),
      ANSIBLE_NOCOLOR: '1',
      ANSIBLE_FORCE_COLOR: '0',
    },
  });
}

test('real localhost render is private, isolated and idempotent', () => {
  const first = render();
  assert.equal(first.status, 0, first.error?.message || first.stdout + first.stderr);
  const configuration = fs.readFileSync(candidate, 'utf8');
  assert.equal(fs.statSync(outputDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(candidate).mode & 0o777, 0o600);
  assert.match(configuration, /address 192\.0\.2\.1\/24/);
  assert.doesNotMatch(configuration, /10\.0\.10\.|service suricata|vif /);
  const second = render();
  assert.equal(second.status, 0, second.error?.message || second.stdout + second.stderr);
  assert.match(second.stdout, /changed=0\s/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), configuration);
});

test('production profile, repository output and non-Ed25519 key are refused before rendering', () => {
  const wrongKey = path.join(temporary, 'wrong-type.pub');
  fs.writeFileSync(wrongKey, 'ssh-rsa invalid-test-key\n', { mode: 0o600 });
  const attempts = [
    { vyos_profile: 'production', vyos_output_dir: path.join(temporary, 'production') },
    { vyos_output_dir: rejectedOutput },
    { vyos_public_key_file: wrongKey, vyos_output_dir: path.join(temporary, 'wrong-key') },
  ];
  for (const extra of attempts) {
    const result = render(extra);
    assert.notEqual(result.status, 0, 'Unsafe input unexpectedly succeeded');
    assert.equal(fs.existsSync(extra.vyos_output_dir), false, result.stdout + result.stderr);
  }
});

test('candidate parses with the authenticated release library and uses its actual CLI paths', {
  skip: !process.env.VYOS_NATIVE_ROOT && 'Set VYOS_NATIVE_ROOT to the verified image extraction',
}, () => {
  const result = spawnSync(python, ['-c', String.raw`
import importlib.util
import json
from pathlib import Path
import shlex
import sys

root, candidate, manifest = map(Path, sys.argv[1:])
version = json.loads((root / 'usr/share/vyos/version.json').read_text())
image = json.loads(manifest.read_text())
assert version['version'] == image['release']
assert version['build_git'] == image['build_git']
assert image['verified'] is True
spec = importlib.util.spec_from_file_location(
    'signed_vyos_configtree', root / 'usr/lib/python3/dist-packages/vyos/configtree.py'
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
tree = module.ConfigTree(
    config_string=candidate.read_text(), libpath=str(root / 'usr/lib/libvyosconfig.so.0')
)
commands = [tuple(shlex.split(line)) for line in tree.to_commands().splitlines() if line]
expected = [
    ('set', 'interfaces', 'ethernet', 'eth0', 'address', 'dhcp'),
    ('set', 'interfaces', 'ethernet', 'eth1', 'address', '192.0.2.1/24'),
    ('set', 'service', 'dhcp-server', 'listen-interface', 'eth1'),
    ('set', 'service', 'dhcp-server', 'shared-network-name', 'LAB', 'subnet', '192.0.2.0/24', 'subnet-id', '10'),
    ('set', 'firewall', 'ipv4', 'forward', 'filter', 'default-action', 'drop'),
    ('set', 'firewall', 'ipv4', 'input', 'filter', 'default-log'),
    ('set', 'firewall', 'ipv6', 'forward', 'filter', 'default-action', 'drop'),
    ('set', 'system', 'config-management', 'commit-confirm', 'action', 'reload'),
    ('set', 'nat', 'destination', 'rule', '100', 'translation', 'address', '192.0.2.5'),
    ('set', 'service', 'ssh', 'disable-password-authentication'),
]
for command in expected:
    assert command in commands, command
schema = root / 'opt/vyatta/share/vyatta-cfg/templates'
for command in commands:
    assert command[0] == 'set'
    node = schema
    remaining = []
    for index, token in enumerate(command[1:], start=1):
        if (node / token).is_dir():
            node = node / token
        elif (node / 'node.tag').is_dir():
            node = node / 'node.tag'
        else:
            remaining = command[index:]
            break
    definition = node / 'node.def'
    if node.name == 'node.tag':
        definition = node.parent / 'node.def'
    assert definition.is_file() and len(remaining) <= 1, command
assert not tree.exists(['service', 'suricata'])
assert not tree.exists(['interfaces', 'ethernet', 'eth1', 'vif'])
print(f'Native grammar and {len(commands)} release schema paths passed; no boot/commit claim')
`, process.env.VYOS_NATIVE_ROOT, candidate, path.join(repository, 'vyos/image.json')], {
    cwd: repository,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stdout, /Native grammar and \d+ release schema paths passed/);
});