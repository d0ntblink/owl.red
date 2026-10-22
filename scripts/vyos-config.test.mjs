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
  assert.match(configuration, /suricata \{/);
  assert.match(configuration, /filetype syslog/);
  assert.doesNotMatch(configuration, /10\.0\.10\.|vif |action queue|copy-mode ips/);
  const second = render();
  assert.equal(second.status, 0, second.error?.message || second.stdout + second.stderr);
  assert.match(second.stdout, /changed=0\s/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), configuration);
});

test('unsafe profiles, paths, keys and image qualifications are refused before rendering', () => {
  const wrongKey = path.join(temporary, 'wrong-type.pub');
  fs.writeFileSync(wrongKey, 'ssh-rsa invalid-test-key\n', { mode: 0o600 });
  const image = JSON.parse(fs.readFileSync(path.join(repository, 'vyos/image.json'), 'utf8'));
  const attempts = [
    { vyos_profile: 'production', vyos_output_dir: path.join(temporary, 'production') },
    { vyos_output_dir: rejectedOutput },
    { vyos_public_key_file: wrongKey, vyos_output_dir: path.join(temporary, 'wrong-key') },
    { vyos_image: { ...image, verified: false }, vyos_output_dir: path.join(temporary, 'unverified') },
    { vyos_image: { ...image, channel: 'stream' }, vyos_output_dir: path.join(temporary, 'wrong-channel') },
    {
      vyos_image: { ...image, qualification: { ...image.qualification, native_suricata: false } },
      vyos_output_dir: path.join(temporary, 'missing-suricata'),
    },
  ];
  for (const extra of attempts) {
    const result = render(extra);
    assert.notEqual(result.status, 0, 'Unsafe input unexpectedly succeeded');
    assert.equal(fs.existsSync(extra.vyos_output_dir), false, result.stdout + result.stderr);
  }
});

test('VLAN lab overlay refuses missing approval, production identities and allocation changes offline', () => {
  const inventory = path.join(temporary, 'vlan-lab-inventory.json');
  fs.writeFileSync(inventory, JSON.stringify({
    all: {
      hosts: {
        edge_lab: {
          ansible_connection: 'local',
          ansible_host: '127.0.0.1',
          ansible_port: 22102,
          vm_id: 102,
        },
      },
    },
  }));
  const attempts = [
    {},
    { vyos_vlan_pilot_apply_allowed: true, vm_id: 103 },
    { vyos_vlan_pilot_apply_allowed: true, ansible_host: '10.0.10.1', ansible_port: 22 },
    { vyos_vlan_pilot_apply_allowed: true, vyos_vlan_pilot: { vlan_id: 10 } },
  ];
  for (const extra of attempts) {
    const result = spawnSync(ansible, [
      '-i', inventory,
      'ansible/playbooks/vyos-vlan-lab.yml',
      '--extra-vars', JSON.stringify(extra),
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
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /This opt-in playbook cannot target the production router/);
    assert.doesNotMatch(result.stdout, /TASK \[Verify actual lab identity/);
  }
});

test('production VLAN pilot refuses missing approval and changed host/operator boundaries offline', () => {
  const inventory = path.join(temporary, 'vlan-production-inventory.json');
  fs.writeFileSync(inventory, JSON.stringify({
    all: {
      hosts: {
        edge_router: {
          ansible_connection: 'local', ansible_host: '10.0.10.1', vm_id: 103, platform: 'vyos',
        },
        switch_swos: {
          ansible_connection: 'local', ansible_host: '10.0.10.2', swos_username: 'admin',
        },
      },
    },
  }));
  const attempts = [
    { owner: 'vyos', extra: {} },
    { owner: 'vyos', extra: { vlan20_pilot_allowed: true, vm_id: 102 } },
    { owner: 'vyos', extra: { vlan20_pilot_allowed: true, ansible_host: '127.0.0.1' } },
    { owner: 'swos', extra: {} },
    { owner: 'swos', extra: { vlan20_pilot_allowed: true, vlan20_members: [2, 22, 25] } },
  ];
  for (const { owner, extra } of attempts) {
    const result = spawnSync(ansible, [
      '-i', inventory, `ansible/playbooks/${owner}-vlan20.yml`,
      '--extra-vars', JSON.stringify(extra),
    ], {
      cwd: repository,
      encoding: 'utf8',
      env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg') },
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /TASK \[Require/);
    assert.doesNotMatch(result.stdout, /TASK \[(Verify native identity|Preserve or reconcile)/);
  }
});

test('private ingress allowlist is exact TCP443 to the shared VIP only', () => {
  const result = spawnSync(python, ['-c', String.raw`
import json
from pathlib import Path
import shlex
import yaml
from jinja2 import Environment, StrictUndefined

profile = yaml.safe_load(Path('ansible/inventory/group_vars/aps.yml').read_text())
profile['openwrt_target_registry'] = json.loads(Path('gitops/technitium/dhcp-reservations.json').read_text())
environment = Environment(undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True)
environment.filters['quote'] = shlex.quote
rendered = environment.from_string(Path('ansible/templates/vyos-wifi-services.j2').read_text()).render(**profile)
stem = ['set', 'firewall', 'ipv4', 'forward', 'filter', 'rule', '2810']
commands = [shlex.split(line.removesuffix(' &&')) for line in rendered.splitlines() if line.startswith('set ')]
actual = [command[len(stem):] for command in commands if command[:len(stem)] == stem]
expected = [
    ['description', 'OWL-WIFI-PRIVATE-INGRESS'],
    ['inbound-interface', 'name', 'eth1.20'],
    ['outbound-interface', 'name', 'eth1'],
    ['source', 'address', '10.0.20.0/24'],
    ['destination', 'address', '10.0.10.201'],
    ['protocol', 'tcp'], ['destination', 'port', '443'], ['action', 'accept'],
]
assert sorted(actual) == sorted(expected), actual
assert 2810 < 3000
guard = Path('ansible/playbooks/vyos-wifi.yml').read_text()
assert 'returnActiveValue firewall ipv4 forward filter rule 2810 description' in guard
assert 'OWL-WIFI-PRIVATE-INGRESS' in guard
`], { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

test('final dual-stack VLAN policy quarantines the direct guest path and keeps Technitium authoritative', () => {
  const result = spawnSync(python, ['-c', String.raw`
import json
from pathlib import Path
import shlex
import yaml
from jinja2 import Environment, StrictUndefined

environment = Environment(undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True)
environment.filters['bool'] = bool
plan = json.loads(Path('gitops/technitium/network.json').read_text())
rendered = environment.from_string(Path('ansible/templates/vyos-vlan-ipv6.j2').read_text()).render(
    openwrt_ipv6_plan=plan, openwrt_ipv6_delegate=True)
commands = [shlex.split(line.removesuffix(' &&')) for line in rendered.splitlines() if line.startswith('set ')]
for family in ['ipv4', 'ipv6']:
    stem = ['set', 'firewall', family, 'forward', 'filter', 'rule', '90']
    actual = [command[len(stem):] for command in commands if command[:len(stem)] == stem]
    expected = [['description', 'OWL-VLAN-CLIENT-DNS-EGRESS'],
        ['inbound-interface', 'group', 'OWL-VLAN-CLIENTS'], ['protocol', 'tcp_udp'],
        ['destination', 'port', '53,853'], ['action', 'drop'], ['log']]
    assert sorted(actual) == sorted(expected), actual
for network in plan['vlans'][1:]:
    interface = f"eth1.{network['id']}"
    assert ['set', 'interfaces', 'ethernet', 'eth1', 'vif', str(network['id']), 'address', network['router']+'/64'] in commands
    assert ['set', 'service', 'router-advert', 'interface', interface, 'name-server', network['dns']] in commands
    assert ['set', 'interfaces', 'ethernet', 'eth0', 'dhcpv6-options', 'pd', '0', 'interface', interface, 'sla-id', str(network['delegationSlaId'])] in commands
    if network['id'] in [30, 40]:
        forbidden = ['set', 'firewall', 'ipv6', 'forward', 'filter', 'rule', str(6001 + network['id']*10)]
        assert not any(command[:len(forbidden)] == forbidden for command in commands)
assert ['set', 'firewall', 'ipv4', 'forward', 'filter', 'rule', '6300', 'action', 'drop'] in commands
assert not any(command[:3] == ['set', 'nat', 'source'] for command in commands)
profile = yaml.safe_load(Path('ansible/inventory/group_vars/aps.yml').read_text())
assert profile['openwrt_wifi_networks']['guest']['enabled'] is True
assert profile['openwrt_wifi_networks']['guest']['gateway_owner'] == 'opennds'
handoff = next(task['ansible.builtin.raw'] for task in yaml.safe_load(Path('ansible/playbooks/guest-portal-router.yml').read_text())[0]['tasks'] if task['name'] == 'Handoff only the quarantined guest gateway path')
assert 'delete interfaces ethernet eth1 vif 30 address 10.0.30.1/24' in handoff
assert 'set interfaces ethernet eth1 vif 30 disable' in handoff
assert 'delete service router-advert interface eth1.30' in handoff
assert 'set protocols static route 10.0.30.0/24 next-hop 172.31.30.2' in handoff
assert 'commit-confirm 10 no-prompt' in handoff
authority = yaml.safe_load(Path('vyos/baseline.yml').read_text())['vyos_production_baseline']['dhcp_authority']
assert authority == 'technitium'
profile['openwrt_target_registry'] = json.loads(Path('gitops/technitium/dhcp-reservations.json').read_text())
profile['openwrt_dhcp_authority'] = authority
wifi = environment.from_string(Path('ansible/templates/vyos-wifi-services.j2').read_text()).render(**profile)
assert 'set service dhcp-server disable' in wifi
assert 'set service dhcp-server shared-network-name' not in wifi
assert 'set service dns forwarding name-server 10.0.10.30' in wifi
`], { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
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
assert version['build_uuid'] == image['build_uuid']
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
    ('set', 'service', 'suricata', 'interface', 'eth1'),
    ('set', 'service', 'suricata', 'address-group', 'home-net', 'address', '192.0.2.0/24'),
    ('set', 'service', 'suricata', 'address-group', 'external-net', 'group', '!home-net'),
    ('set', 'service', 'suricata', 'port-group', 'http-ports', 'port', '80'),
    ('set', 'service', 'suricata', 'log', 'eve', 'filetype', 'syslog'),
    ('set', 'service', 'suricata', 'log', 'eve', 'type', 'alert'),
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
assert tree.exists(['service', 'suricata'])
assert (schema / 'service/suricata/node.def').is_file()
assert image['channel'] == 'rolling'
assert image['qualification']['native_suricata'] is True
assert not tree.exists(['interfaces', 'ethernet', 'eth1', 'vif'])
print(f'Native grammar and {len(commands)} release schema paths passed; no boot/commit claim')
`, process.env.VYOS_NATIVE_ROOT, candidate, path.join(repository, 'vyos/image.json')], {
    cwd: repository,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stdout, /Native grammar and \d+ release schema paths passed/);
});