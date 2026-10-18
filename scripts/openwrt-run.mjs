import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repository);
const home = os.homedir();
const root = path.join(home, '.local/state/owl-red');
const phase = process.argv[2] || 'inspect';
const phases = ['bootstrap', 'inspect', 'qualify', 'plan', 'trial', 'verify', 'rebind', 'confirm', 'rollback', 'finish', 'switch-prepare', 'switch-test', 'switch-apply', 'switch-rollback', 'gateway-lab-trial', 'gateway-lab-confirm', 'gateway-trial', 'gateway-confirm', 'client-connect', 'client-test'];
assert.ok(phases.includes(phase), 'Unsupported AP phase');
const suppliedDirectory = process.argv[3];
const recovery = suppliedDirectory ? path.resolve(suppliedDirectory) : fs.mkdtempSync(path.join(root, 'openwrt-rebuild-'));
assert.equal(path.dirname(recovery), root);
assert.ok(path.basename(recovery).startsWith('openwrt-rebuild-') && fs.statSync(recovery).isDirectory());
if (['qualify', 'trial', 'rebind', 'confirm', 'rollback', 'finish'].includes(phase) || phase.startsWith('switch-') || phase.startsWith('gateway-')) {
  assert.ok(suppliedDirectory && process.env.OPENWRT_APPLY_ALLOWED === 'true', 'Explicit recovery directory and OPENWRT_APPLY_ALLOWED=true are required');
}
if (phase === 'client-connect') {
  assert.equal(process.env.OPENWRT_CLIENT_CONNECT_ALLOWED, 'true', 'Explicit workstation Wi-Fi association approval is required');
}
const secrets = parseEnv(fs.readFileSync('env.secret', 'utf8'));
const bw = process.env.BW_BINARY || path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
const vaultEnvironment = {
  ...process.env,
  BW_SECRET: secrets.BW_SECRET || process.env.BW_SECRET,
  BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0'),
};
function vault(args, input) {
  try {
    return execFileSync(bw, args, { env: vaultEnvironment, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error('Bitwarden operation failed; credential values suppressed');
  }
}
vaultEnvironment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
vault(['sync']);
const login = JSON.parse(vault(['get', 'item', '10da341d-20ad-4f4a-b15c-add2008eb0e4']));
assert.ok(login.login?.password && login.login.username === 'root');
if (phase.startsWith('client-')) {
  const request = { phase: phase.slice('client-'.length), allowed: process.env.OPENWRT_CLIENT_CONNECT_ALLOWED === 'true' };
  if (phase === 'client-connect') {
    const wifi = JSON.parse(vault(['get', 'item', '44bcc98e-5388-4208-a1d5-b4e70030bac7']));
    assert.ok(wifi.login?.password);
    request.key = wifi.login.password;
  }
  const source = fs.readFileSync('scripts/windows-wifi-client.ps1', 'utf8');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
    input: JSON.stringify(request), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000,
  });
  if (result.status !== 0) {
    throw new Error('Workstation Wi-Fi operation failed; private inputs suppressed. No adapter reset, metric or DNS change is permitted.');
  }
  const output = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  fs.writeFileSync(path.join(recovery, `${phase}.json`), JSON.stringify(output, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...output, evidence: recovery }, null, 2));
  process.exit(0);
}
if (phase.startsWith('gateway-') || phase.startsWith('switch-')) {
  const isSwitch = phase.startsWith('switch-');
  const environment = { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg') };
  if (isSwitch) {
    const switchLogin = JSON.parse(vault(['get', 'item', '33779df3-4be6-4822-a01e-b44e012390dc']));
    assert.ok(switchLogin.login?.password);
    environment.SWOS_PASSWORD = switchLogin.login.password;
    environment.NO_PROXY = [environment.NO_PROXY || '', '10.0.10.2'].filter(Boolean).join(',');
    environment.no_proxy = environment.NO_PROXY;
  }
  const variables = {
    openwrt_apply_allowed: process.env.OPENWRT_APPLY_ALLOWED === 'true',
    openwrt_recovery_directory: recovery,
    openwrt_switch_phase: phase.slice('switch-'.length),
    openwrt_gateway_phase: phase.endsWith('confirm') ? 'confirm' : 'trial',
    openwrt_gateway_target: phase.startsWith('gateway-lab-') ? 'edge_lab' : 'edge_router',
  };
  const args = ['-i', 'ansible/inventory/hosts.yml', `ansible/playbooks/${isSwitch ? 'swos-ap' : 'vyos-wifi'}.yml`, '-e', JSON.stringify(variables)];
  if (isSwitch) args.push('-e', `ansible_python_interpreter=${repository}/.venv/bin/python`);
  const result = spawnSync(path.join(repository, '.venv/bin/ansible-playbook'), args, { env: environment, stdio: 'inherit' });
  console.log(JSON.stringify({ phase, recovery, exitCode: result.status }));
  process.exit(result.status ?? 1);
}
const privateDirectory = path.join(root, 'openwrt-rebuild');
const inputFile = path.join(privateDirectory, 'input.json');
if (phase === 'bootstrap') {
  const ssh = [
    '-e', 'ssh', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
    '-o', 'NumberOfPasswordPrompts=1', '-o', 'PreferredAuthentications=password',
    '-o', 'PubkeyAuthentication=no', 'root@10.10.20.1',
  ];
  const environment = { ...process.env, SSHPASS: login.login.password };
  function read(command) {
    try {
      return execFileSync('sshpass', [...ssh, command], { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    } catch {
      throw new Error('Trusted AP bootstrap read failed; sensitive values suppressed');
    }
  }
  const board = JSON.parse(read('ubus call system board'));
  assert.equal(board.board_name, 'dlink,dir-885l');
  assert.equal(board.release.version, '25.12.2');
  const wireless = JSON.parse(read('ubus call uci get \'{"config":"wireless"}\'')).values;
  const certificatePath = read('uci -q get uhttpd.main.cert').trim();
  assert.match(certificatePath, /^\/etc\/[A-Za-z0-9_./-]+$/);
  assert.ok(!certificatePath.includes('..'));
  const certificate = new X509Certificate(read(`cat '${certificatePath}'`));
  const adopted = {
    private: wireless.wifinet_lan_5g.key,
    guest: wireless.wifinet_guest_2g.key,
    iot_local: wireless.wifinet_iot.key,
    iot_cloud: randomBytes(32).toString('base64url'),
  };
  const wifiKeys = {};
  const references = {};
  for (const [network, initial] of Object.entries(adopted)) {
    const name = `owl-red-wifi-${network.replaceAll('_', '-')}`;
    const matches = JSON.parse(vault(['list', 'items', '--search', name])).filter(item => item.name === name && item.type === 1);
    assert.ok(matches.length <= 1, 'Duplicate Wi-Fi credential items; stop before changes');
    let item = matches[0];
    if (!item) {
      assert.ok(typeof initial === 'string' && initial.length >= 8 && initial.length <= 63);
      const definition = {
        type: 1, name,
        notes: `Controller-owned owl.red ${network} Wi-Fi credential. Password Manager is the human authority; do not rotate in LuCI. Guest activation remains gated.`,
        login: { username: network, password: initial, uris: [] },
      };
      item = JSON.parse(vault(['create', 'item'], Buffer.from(JSON.stringify(definition)).toString('base64')));
    }
    assert.ok(item.login?.password && item.login.password.length >= 8 && item.login.password.length <= 63);
    wifiKeys[network] = item.login.password;
    references[network] = { name, item_id: item.id };
  }
  assert.notEqual(wifiKeys.iot_local, wifiKeys.iot_cloud, 'IoT networks must not share a credential');
  fs.mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(inputFile, JSON.stringify({ certificate_sha256: certificate.fingerprint256.replaceAll(':', '').toLowerCase(), wifi_keys: wifiKeys, references }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ bootstrapComplete: true, APChanged: false, references, recovery }, null, 2));
  process.exit(0);
}
assert.ok(fs.existsSync(inputFile), 'Run the versioned bootstrap phase first');
const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
for (const [network, reference] of Object.entries(input.references)) {
  const item = JSON.parse(vault(['get', 'item', reference.item_id]));
  assert.ok(item.login?.password && Buffer.byteLength(item.login.password, 'utf8') >= 8 && Buffer.byteLength(item.login.password, 'utf8') <= 63 && !/[\r\n\0]/.test(item.login.password), `Unsupported Wi-Fi key for ${network}; values suppressed`);
  input.wifi_keys[network] = item.login.password;
}
fs.writeFileSync(inputFile, JSON.stringify(input, null, 2), { mode: 0o600 });
const endpoint = process.env.OPENWRT_ENDPOINT || 'https://10.0.10.40';
const result = spawnSync(path.join(repository, '.venv/bin/ansible-playbook'), [
  '-i', 'ansible/inventory/hosts.yml', 'ansible/playbooks/openwrt-ap.yml',
  '-e', JSON.stringify({ openwrt_phase: phase, openwrt_endpoint: endpoint, openwrt_recovery_directory: recovery, openwrt_apply_allowed: process.env.OPENWRT_APPLY_ALLOWED === 'true' }),
], {
  env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg'), OPENWRT_ROOT_PASSWORD: login.login.password },
  stdio: 'inherit',
});
if (phase === 'trial' && result.status === 0) {
  const rebound = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'rebind', recovery], {
    env: { ...process.env, OPENWRT_ENDPOINT: endpoint },
    stdio: 'inherit',
  });
  if (rebound.status !== 0) process.exit(rebound.status ?? 1);
}
console.log(JSON.stringify({ phase, recovery, exitCode: result.status }));
process.exit(result.status ?? 1);