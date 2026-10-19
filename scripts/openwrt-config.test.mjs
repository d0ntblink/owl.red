import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON || path.join(repository, '.venv/bin/python');
const ansible = process.env.ANSIBLE_PLAYBOOK || path.join(repository, '.venv/bin/ansible-playbook');

test('each Wi-Fi network has an ordinary bridge above its tagged uplink, not the shared filtering bridge', () => {
  const result = spawnSync(python, ['-c', String.raw`
from pathlib import Path
import importlib.util
import shlex
import yaml
from jinja2 import Environment, StrictUndefined

spec = importlib.util.spec_from_file_location('openwrt_ap_test', 'ansible/library/openwrt_ap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
profile = yaml.safe_load(Path('ansible/inventory/group_vars/aps.yml').read_text())
environment = Environment(undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True)
environment.filters['quote'] = shlex.quote
sections = module.parse_config(environment.from_string(Path('ansible/templates/openwrt-network.j2').read_text()).render(**profile))
assert sections['management_vlan']['ports'] == ['wan:u*', 'lan4:u*']
assert sections['lan']['device'] == 'br-ap.1'
assert sections['lan']['ipaddr'] == '10.0.10.40'
for name, network in profile['openwrt_wifi_networks'].items():
    bridge = 'br-' + name.replace('_', '-')
    assert sections[name]['device'] == bridge
    assert sections[name]['proto'] == 'none'
    assert sections[name + '_bridge']['type'] == 'bridge'
    assert sections[name + '_bridge']['ports'] == ['br-ap.' + str(network['vlan'])]
assert profile['openwrt_bss_bridges'] == {
    'phy0-ap0': 'br-private', 'phy1-ap0': 'br-private',
    'phy0-ap1': 'br-iot-local', 'phy0-ap2': 'br-iot-cloud',
  'phy1-ap1': 'br-iot-cloud',
}
assert profile['openwrt_wifi_networks']['guest']['enabled'] is False
profile['openwrt_wifi_keys'] = {name: 'test-only-' + name + '-passphrase' for name in ['private', 'guest', 'iot_local', 'iot_cloud']}
wireless = module.parse_config(environment.from_string(Path('ansible/templates/openwrt-wireless.j2').read_text()).render(**profile))
assert wireless['iot_cloud_radio0']['disabled'] == '0'
assert wireless['iot_cloud_radio1']['disabled'] == '0'
assert wireless['iot_cloud_radio1']['network'] == 'iot_cloud'
assert wireless['iot_cloud_radio1']['device'] == 'radio1'
assert wireless['iot_cloud_radio1']['isolate'] == '1'
assert 'iot_local_radio1' not in wireless
assert wireless['guest_radio0']['disabled'] == wireless['guest_radio1']['disabled'] == '1'
`], { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});

test('runtime bridge reconciliation refuses missing explicit approval before contacting the AP', () => {
  const result = spawnSync(ansible, [
    '-i', 'ansible/inventory/hosts.yml', 'ansible/playbooks/openwrt-ap.yml',
    '-e', JSON.stringify({ openwrt_phase: 'rebind', openwrt_apply_allowed: false }),
  ], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg') },
  });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /TASK \[Refuse unsupported hardware/);
  assert.doesNotMatch(result.stdout, /TASK \[Reconcile the declared AP configuration/);
});