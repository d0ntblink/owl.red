import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

process.umask(0o077);
const phase = process.argv[2] || 'inspect';
assert.ok(['inspect', 'repair-netwatch', 'match-netwatch'].includes(phase), 'Use inspect, repair-netwatch or match-netwatch.');
const cameraName = process.argv[3] || 'foyer';
const camera = {
  foyer: { host: '10.0.40.12', mac: '02:7f:f6:05:40:fc' },
  office: { host: '10.0.40.13', mac: '02:2d:1f:56:ee:b8' },
}[cameraName];
assert.ok(camera, 'Use foyer or office.');
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const home = os.homedir();
const stateRoot = path.join(home, '.local/state/owl-red');
const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
const environment = { ...process.env, BW_SECRET: stored.BW_SECRET, BITWARDENCLI_APPDATA_DIR: path.join(stateRoot, 'bitwarden-cli-2026.7.0') };
delete environment.BW_SESSION;
const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
function vault(args) {
  const result = spawnSync(binary, args, { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, 'Private camera credential access failed.');
  return result.stdout.trim();
}
environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
const login = JSON.parse(vault(['get', 'item', '79c52c46-77d5-46b6-8d7d-b4dd00ff75ae'])).login;
assert.equal(login.username, 'root');
const read = String.raw`set -eu
test "$(cat /sys/class/net/wlan0/address)" = '${camera.mac}'
grep -q '^IMAGE_ID=wuuk_y0510_t31x_sc4336p_ssv6158' /etc/os-release
printf 'boot_id='; cat /proc/sys/kernel/random/boot_id
printf 'uptime_seconds='; cut -d. -f1 /proc/uptime
for key in enabled target interval fail_count; do
  value=$(jct /etc/thingino.json get "netwatch.$key" || true)
  printf 'netwatch_%s=%s\n' "$key" "$value"
done
if ping -c 1 -W 2 10.0.40.1 >/dev/null 2>&1; then printf 'gateway_reachable=true\n'; else printf 'gateway_reachable=false\n'; fi
`;
const repair = String.raw`set -eu
test "$(cat /sys/class/net/wlan0/address)" = '${camera.mac}'
grep -q '^IMAGE_ID=wuuk_y0510_t31x_sc4336p_ssv6158' /etc/os-release
test "$(jct /etc/thingino.json get netwatch.enabled)" = true
before=$(jct /etc/thingino.json get netwatch.target)
case "$before" in 10.0.10.1|10.0.40.1) ;; *) echo 'Unexpected watchdog target; review required' >&2; exit 1 ;; esac
ping -c 1 -W 2 10.0.40.1 >/dev/null 2>&1
if [ "$before" != 10.0.40.1 ]; then
  umask 077
  backup=/etc/owl-red-netwatch-before.json
  if [ ! -e "$backup" ]; then cp /etc/thingino.json "$backup"; chmod 0600 "$backup"; fi
  /etc/init.d/S52netwatch stop
  jct /etc/thingino.json set netwatch.target 10.0.40.1
  test "$(jct /etc/thingino.json get netwatch.target)" = 10.0.40.1
  sync
  /etc/init.d/S52netwatch start
  printf 'changed=true\n'
else
  printf 'changed=false\n'
fi
test -s /var/run/netwatch.pid
kill -0 "$(cat /var/run/netwatch.pid)"
printf 'software_watchdog_running=true\n'
`;
const match = String.raw`set -eu
test "$(cat /sys/class/net/wlan0/address)" = '${camera.mac}'
grep -q '^IMAGE_ID=wuuk_y0510_t31x_sc4336p_ssv6158' /etc/os-release
enabled=$(jct /etc/thingino.json get netwatch.enabled)
target=$(jct /etc/thingino.json get netwatch.target || true)
case "$enabled" in true|false) ;; *) exit 1 ;; esac
case "$target" in ''|10.0.10.1|10.0.40.1) ;; *) echo 'Unexpected watchdog target; review required' >&2; exit 1 ;; esac
test "$(jct /etc/thingino.json get netwatch.interval)" = 30
test "$(jct /etc/thingino.json get netwatch.fail_count)" = 3
ip route | grep -q '^default via 10.0.40.1 '
ping -c 1 -W 2 10.0.40.1 >/dev/null 2>&1
if [ "$enabled" != true ] || [ "$target" != 10.0.40.1 ]; then
  umask 077
  backup=/etc/owl-red-netwatch-match-before.json
  if [ ! -e "$backup" ]; then cp /etc/thingino.json "$backup"; chmod 0600 "$backup"; fi
  /etc/init.d/S52netwatch stop
  jct /etc/thingino.json set netwatch.target 10.0.40.1
  jct /etc/thingino.json set netwatch.enabled true
  test "$(jct /etc/thingino.json get netwatch.target)" = 10.0.40.1
  test "$(jct /etc/thingino.json get netwatch.enabled)" = true
  sync
  /etc/init.d/S52netwatch start
  printf 'changed=true\n'
else
  printf 'changed=false\n'
fi
test -s /var/run/netwatch.pid
kill -0 "$(cat /var/run/netwatch.pid)"
printf 'software_watchdog_running=true\n'
`;
const directory = fs.mkdtempSync(path.join(stateRoot, cameraName + '-health-'));
const script = (phase === 'repair-netwatch' ? repair : phase === 'match-netwatch' ? match : '') + read;
const syntax = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' });
assert.equal(syntax.status, 0, 'Generated native shell syntax failed.');
const result = spawnSync('sshpass', ['-e', 'ssh', '-T', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + path.join(stateRoot, 'thingino-known_hosts'), '-o', 'HostKeyAlias=thingino-' + cameraName, '-o', 'ConnectTimeout=5', '-o', 'NumberOfPasswordPrompts=1', '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password', '-o', 'LogLevel=ERROR', '-o', 'ProxyCommand=ssh -i ' + path.join(home, '.ssh/id_ed25519_owl_ansible') + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -W %h:%p root@10.0.10.3', 'root@' + camera.host, 'sh -s'], { input: script, env: { ...process.env, SSHPASS: login.password }, encoding: 'utf8', timeout: 25000, maxBuffer: 2 * 1024 * 1024 });
fs.writeFileSync(path.join(directory, 'output.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
assert.equal(result.status, 0, 'Camera operation failed; private diagnostics: ' + directory);
const fields = {};
for (const line of result.stdout.split('\n')) {
  const match = line.match(/^(boot_id|uptime_seconds|netwatch_enabled|netwatch_target|netwatch_interval|netwatch_fail_count|gateway_reachable|changed|software_watchdog_running)=(.*)$/);
  if (match) fields[match[1]] = match[2];
}
console.log(JSON.stringify({ camera: cameraName, phase, ...fields, privateDiagnostics: directory }));