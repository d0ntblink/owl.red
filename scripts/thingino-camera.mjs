#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pbkdf2Sync, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const { camera, profile, credentials } = request;
const home = os.homedir();
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const recoveryRoot = path.join(home, '.local/state/owl-red');
ensure(path.dirname(path.resolve(request.recovery)) === recoveryRoot && path.basename(request.recovery).startsWith('thingino-'), 'Invalid private recovery directory.');
ensure(/^camera_(foyer|office)$/.test(camera.name), 'Unknown camera.');
ensure(['10.0.40.12', '10.0.40.13'].includes(camera.target), 'Unexpected target network.');
ensure(profile.ssid === 'owl.red-iot-local' && profile.frequencies.every(value => Number.isInteger(value) && value >= 2412 && value <= 2462), 'Only 2.4 GHz local IoT is allowed.');
ensure(request.rollbackSeconds >= 240 && request.rollbackSeconds <= 600, 'Unsafe rollback interval.');
ensure(credentials.username === 'root' && credentials.password && credentials.wifi, 'Private inputs are incomplete.');
const directory = path.join(request.recovery, camera.name);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

function ssh(host, script, attempts = 1) {
  return spawnSync('sshpass', ['-e', 'ssh', '-T', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UserKnownHostsFile=' + path.join(recoveryRoot, 'thingino-known_hosts'),
    '-o', 'HostKeyAlias=' + camera.alias, '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=' + attempts, '-o', 'NumberOfPasswordPrompts=1',
    '-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password', '-o', 'LogLevel=ERROR',
    '-o', 'ProxyCommand=ssh -i ' + path.join(home, '.ssh/id_ed25519_owl_ansible') + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -W %h:%p root@10.0.10.3',
    'root@' + host, 'sh -s'], {
    input: script, env: { ...process.env, SSHPASS: credentials.password }, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: attempts > 1 ? 130000 : 18000, maxBuffer: 4 * 1024 * 1024
  });
}

const stateScript = `set -eu
printf 'IDENTITY\\n'
cat /sys/class/net/wlan0/address
grep '^IMAGE_ID=' /etc/os-release
printf 'STATUS\\n'
wpa_cli -i wlan0 status | grep -E '^(ssid|bssid|freq|wpa_state|ip_address|address)='
printf 'NETWORK\\n'
ip -o -4 addr show dev wlan0
ip route
grep '^nameserver ' /etc/resolv.conf
printf 'CONFIG\\n'
base64 /etc/wpa_supplicant.conf
printf 'OTHER-CONFIG-HASH\\n'
sha256sum /etc/thingino.json /etc/network/interfaces.d/wlan0
printf 'SERVICES\\n'
netstat -lnt 2>/dev/null | grep -E ':(22|80|554)[[:space:]]' || true
`;

function parseState(result) {
  ensure(result.status === 0, 'Camera SSH state read failed; no unverified changes will be confirmed.');
  const text = result.stdout;
  ensure(text.split('IDENTITY\n')[1]?.split('\n')[0].trim().toLowerCase() === camera.mac, 'Camera MAC mismatch.');
  ensure(text.includes('IMAGE_ID=wuuk_y0510_t31x_sc4336p_ssv6158'), 'Unexpected firmware/hardware image.');
  const statusText = text.split('STATUS\n')[1]?.split('NETWORK\n')[0];
  const status = Object.fromEntries(statusText.trim().split('\n').map(line => { const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1).trim()]; }));
  const configuration = Buffer.from(text.split('CONFIG\n')[1].split('OTHER-CONFIG-HASH\n')[0].replaceAll(/\s/g, ''), 'base64').toString();
  return { status, configuration, network: text.split('NETWORK\n')[1].split('CONFIG\n')[0], otherHashes: text.split('OTHER-CONFIG-HASH\n')[1].split('SERVICES\n')[0], services: text.split('SERVICES\n')[1] };
}

function verify(state) {
  ensure(state.status.ssid === profile.ssid && state.status.wpa_state === 'COMPLETED', 'Target Wi-Fi is not authenticated.');
  ensure(profile.frequencies.includes(Number(state.status.freq)) && Number(state.status.freq) < 2500, 'Camera is not on 2.4 GHz.');
  ensure(state.status.bssid.toLowerCase() === profile.expected_bssid, 'Unexpected target access point.');
  ensure(state.status.ip_address === camera.target && state.network.includes(camera.target + '/24'), 'Expected DHCP address/mask not acquired.');
  ensure(state.network.includes('default via ' + profile.gateway) && state.network.includes('nameserver ' + profile.dns), 'Target gateway or DNS differs.');
  ensure(/:80\s/.test(state.services) && /:554\s/.test(state.services), 'Camera web or RTSP listener is missing.');
}

try {
  let host = camera.target;
  let initial = ssh(host, stateScript);
  fs.writeFileSync(path.join(directory, 'initial-target.log'), JSON.stringify({ status: initial.status, stdout: initial.stdout, stderr: initial.stderr }), { mode: 0o600 });
  if (initial.status !== 0 && request.phase !== 'verify') { host = camera.bootstrap; initial = ssh(host, stateScript); }
  const before = parseState(initial);
  if (request.phase === 'inspect') {
    const diagnostic = ssh(host, `printf 'TRIALS\\n'; for state in /etc/owl-red-wifi-*; do test ! -d "$state" || { printf '%s\\n' "$state"; test ! -f "$state/switch.log" || cat "$state/switch.log"; }; done; printf 'CRON\\n'; crontab -l; printf 'CURRENT-CONFIG-HASH\\n'; sha256sum /etc/wpa_supplicant.conf`);
    fs.writeFileSync(path.join(directory, 'diagnostics.log'), diagnostic.stdout + diagnostic.stderr, { mode: 0o600 });
  }
  fs.writeFileSync(path.join(directory, 'before.json'), JSON.stringify(before), { mode: 0o600 });
  const psk = /^[a-fA-F0-9]{64}$/.test(credentials.wifi) ? credentials.wifi.toLowerCase() : pbkdf2Sync(credentials.wifi, profile.ssid, 4096, 32, 'sha1').toString('hex');
  ensure((before.configuration.match(/^\s*network\s*=\s*\{/gm) ?? []).length === 1, 'Multiple saved Wi-Fi networks require review.');
  ensure((before.configuration.match(/^\s*ssid\s*=/gm) ?? []).length === 1 && (before.configuration.match(/^\s*psk\s*=/gm) ?? []).length === 1, 'Ambiguous Wi-Fi credential fields.');
  ensure(!/^\s*mode\s*=\s*2\s*$/m.test(before.configuration), 'AP mode requires a separate reviewed transition.');
  const desired = before.configuration
    .replace(/^(\s*)ssid\s*=.*$/m, '$1ssid=' + JSON.stringify(profile.ssid))
    .replace(/^(\s*)psk\s*=.*$/m, '$1psk=' + psk);
  const changed = before.configuration !== desired;
  if (request.phase === 'verify') verify(before);
  if (request.phase !== 'apply' || !changed) {
    if (request.phase === 'apply') verify(before);
    const previousTransaction = path.join(directory, 'transaction.sh');
    if (['apply', 'verify'].includes(request.phase) && !changed && fs.existsSync(previousTransaction)) {
      verify(before);
      const previous = fs.readFileSync(previousTransaction, 'utf8').match(/^mkdir '([^']+)'$/m)?.[1];
      ensure(previous && /^\/etc\/owl-red-wifi-[a-f0-9-]+$/.test(previous), 'Unknown prior recovery transaction.');
      const settled = ssh(camera.target, `set -eu\nstate=${quote(previous)}\ntest "$(cat /sys/class/net/wlan0/address)" = ${quote(camera.mac)}\ntest -d "$state"\ntouch "$state/confirmed"\ncrontab -l > "$state/crontab.latest"\ngrep -vF "$state/rollback.sh" "$state/crontab.latest" > "$state/crontab.final" || true\ncrontab "$state/crontab.final"\nprintf 'confirmed\\n'\n`);
      ensure(settled.status === 0 && settled.stdout.includes('confirmed'), 'Prior verified transaction confirmation failed.');
      fs.writeFileSync(path.join(directory, 'accepted.json'), JSON.stringify({ target: camera.target, ssid: before.status.ssid, frequencyMHz: Number(before.status.freq), rollbackCancelled: true, nativeConfigurationPreserved: true }), { mode: 0o600 });
    }
    console.log(JSON.stringify({ camera: camera.name, phase: request.phase, changed: request.phase === 'plan' && changed,
      currentAddress: before.status.ip_address, targetAddress: camera.target, ssid: before.status.ssid, frequencyMHz: Number(before.status.freq), wouldChange: changed }));
    process.exit(0);
  }
  const remote = '/etc/owl-red-wifi-' + randomUUID();
  const deadline = request.rollbackSeconds;
  const hash = createHash('sha256').update(before.configuration).digest('hex');
  const rollback = `#!/bin/sh\nset -eu\nstate=${quote(remote)}\n[ ! -e "$state/confirmed" ] || exit 0\nif [ "$(cat /proc/sys/kernel/random/boot_id)" = "$(cat "$state/boot-id")" ]; then\n  uptime=$(cut -d. -f1 /proc/uptime)\n  [ "$uptime" -ge "$(cat "$state/deadline")" ] || exit 0\nfi\ncp "$state/before.conf" /etc/wpa_supplicant.conf\nchmod 0600 /etc/wpa_supplicant.conf\ncrontab -l > "$state/crontab.rollback.latest"\ngrep -vF "$state/rollback.sh" "$state/crontab.rollback.latest" > "$state/crontab.restored" || true\ncrontab "$state/crontab.restored"\nsync\n/etc/init.d/S38wpa_supplicant restart\n/etc/init.d/S40network restart\n`;
  const switchScript = '#!/bin/sh\n/etc/init.d/S38wpa_supplicant restart\n/etc/init.d/S40network restart\n';
  const delimiter = 'THINGINO_' + randomUUID().replaceAll('-', '');
  const transaction = `set -eu
test "$(cat /sys/class/net/wlan0/address)" = ${quote(camera.mac)}
test "$(sha256sum /etc/wpa_supplicant.conf | cut -d' ' -f1)" = ${quote(hash)}
grep -q '^iface wlan0 inet dhcp' /etc/network/interfaces.d/wlan0
test ! -e /overlay/etc/wpa_supplicant.preset_fallback
if test -f /mnt/mmcblk0p1/uenv.txt && grep -qE '^wlan_(ssid|pass)=' /mnt/mmcblk0p1/uenv.txt; then exit 44; fi
test -n "$(pidof crond)"
umask 077
mkdir ${quote(remote)}
cp /etc/wpa_supplicant.conf ${quote(remote + '/before.conf')}
cat > ${quote(remote + '/desired.conf')} <<'${delimiter}'
${desired}${delimiter}
cat > ${quote(remote + '/rollback.sh')} <<'${delimiter}'
${rollback}${delimiter}
cat > ${quote(remote + '/switch.sh')} <<'${delimiter}'
${switchScript}${delimiter}
crontab -l > ${quote(remote + '/crontab.before')} 2>/dev/null || :
cat /proc/sys/kernel/random/boot_id > ${quote(remote + '/boot-id')}
printf '%s\\n' "$(( $(cut -d. -f1 /proc/uptime) + ${deadline} ))" > ${quote(remote + '/deadline')}
cat ${quote(remote + '/crontab.before')} > ${quote(remote + '/crontab.current')}
printf '* * * * * /bin/sh %s/rollback.sh\\n' ${quote(remote)} >> ${quote(remote + '/crontab.current')}
crontab ${quote(remote + '/crontab.current')}
cp ${quote(remote + '/desired.conf')} /etc/wpa_supplicant.conf
chmod 0600 /etc/wpa_supplicant.conf
sync
nohup sh ${quote(remote + '/switch.sh')} </dev/null > ${quote(remote + '/switch.log')} 2>&1 &
printf 'staged\\n'
`;
  fs.writeFileSync(path.join(directory, 'transaction.sh'), transaction, { mode: 0o600 });
  for (const script of [transaction, rollback, switchScript]) {
    const syntax = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' });
    ensure(syntax.status === 0, 'Generated camera shell script failed syntax validation.');
  }
  const staged = ssh(host, transaction);
  fs.writeFileSync(path.join(directory, 'stage.log'), JSON.stringify({ status: staged.status, stdout: staged.stdout, stderr: staged.stderr }), { mode: 0o600 });
  ensure(staged.status === 0 || staged.status === 255, 'Camera refused the guarded transaction; inspect private recovery before retrying.');
  const readiness = spawnSync(path.join(repository, '.venv/bin/ansible'), ['-i', 'ansible/inventory/hosts.yml', 'edge_pve',
    '-m', 'ansible.builtin.wait_for', '-a', JSON.stringify({ host: camera.target, port: 22, timeout: 120, connect_timeout: 3 })],
    { cwd: repository, env: { ...process.env, ANSIBLE_CONFIG: path.join(repository, 'ansible/ansible.cfg') }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 140000, maxBuffer: 4 * 1024 * 1024 });
  fs.writeFileSync(path.join(directory, 'port-readiness.log'), readiness.stdout + readiness.stderr, { mode: 0o600 });
  ensure(readiness.status === 0, 'Target SSH port did not become ready; local rollback remains armed.');
  const targetResult = ssh(camera.target, stateScript, 20);
  fs.writeFileSync(path.join(directory, 'target-read.log'), JSON.stringify({ status: targetResult.status, stderr: targetResult.stderr }), { mode: 0o600 });
  const after = parseState(targetResult);
  verify(after);
  ensure(after.configuration === desired && after.otherHashes === before.otherHashes, 'Persistent config or unrelated camera settings differ.');
  const confirmation = ssh(camera.target, `set -eu\nstate=${quote(remote)}\ntest "$(cat /sys/class/net/wlan0/address)" = ${quote(camera.mac)}\ntest -d "$state"\ntouch "$state/confirmed"\ncrontab -l > "$state/crontab.latest"\ngrep -vF "$state/rollback.sh" "$state/crontab.latest" > "$state/crontab.final" || true\ncrontab "$state/crontab.final"\nprintf 'confirmed\\n'\n`);
  ensure(confirmation.status === 0 && confirmation.stdout.includes('confirmed'), 'Verification passed but rollback confirmation failed; do not proceed to another camera.');
  fs.writeFileSync(path.join(directory, 'accepted.json'), JSON.stringify({ target: camera.target, ssid: after.status.ssid, frequencyMHz: Number(after.status.freq), rollbackCancelled: true, otherConfigurationUnchanged: true }), { mode: 0o600 });
  console.log(JSON.stringify({ camera: camera.name, phase: 'apply', changed: true, address: camera.target,
    ssid: after.status.ssid, frequencyMHz: Number(after.status.freq), webAndRtspListening: true, rollbackCancelled: true }));
} catch (error) {
  fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ error: error.message }), { mode: 0o600 });
  console.error(error.message + ' Private recovery: ' + directory);
  process.exitCode = 1;
}