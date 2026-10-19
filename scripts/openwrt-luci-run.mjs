import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, randomBytes, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repository);
const home = os.homedir();
const phase = process.argv[2] || 'plan';
assert.ok(['plan', 'apply'].includes(phase), 'Use plan or apply.');
const stored = parseEnv(fs.readFileSync('env.secret', 'utf8'));
let diagnosticDirectory;
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
  if (result.status !== 0) {
    diagnosticDirectory ??= fs.mkdtempSync(path.join(home, '.local/state/owl-red/openwrt-luci-'));
    fs.writeFileSync(path.join(diagnosticDirectory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('Operation failed; private diagnostics: ' + diagnosticDirectory);
  }
  return result.stdout.trim();
}
const environment = { ...process.env, BW_SECRET: stored.BW_SECRET,
  BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0') };
delete environment.BW_SESSION;
const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
function vault(args) { return execute(binary, args, { env: environment }); }
assert.ok(vault(['--version']) === '2026.7.0', 'Use the verified Bitwarden CLI/profile.');
environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
vault(['sync']);
const login = JSON.parse(vault(['get', 'item', '10da341d-20ad-4f4a-b15c-add2008eb0e4'])).login;
assert.ok(login.username === 'root' && login.password, 'Unexpected AP credential.');
function ssh(script) {
  return execute('sshpass', ['-e', 'ssh', '-T', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'HostKeyAlias=10.10.20.1', '-o', 'ConnectTimeout=5', '-o', 'PubkeyAuthentication=no',
    'root@10.0.10.40', 'sh -s'], { input: script, env: { ...process.env, SSHPASS: login.password } });
}
const board = JSON.parse(ssh('ubus call system board\n'));
assert.ok(board.board_name === 'dlink,dir-885l' && board.release.version === '25.12.2', 'Unexpected AP platform.');
const secret = JSON.parse(execute('kubectl', ['-n', 'home-assistant', 'get', 'secret', 'openwrt-luci-tls', '-o', 'json']));
const certificateText = Buffer.from(secret.data['tls.crt'], 'base64').toString();
const privateKey = Buffer.from(secret.data['tls.key'], 'base64').toString();
const certificate = new X509Certificate(certificateText);
assert.ok(certificate.checkHost('ap.owl.red') && certificate.checkPrivateKey(createPrivateKey(privateKey)), 'Unexpected AP TLS identity.');
assert.ok(Date.parse(certificate.validTo) > Date.now() + 7 * 86400000, 'AP certificate is expired or too close to expiry.');
const certPath = ssh('uci -q get uhttpd.main.cert\n');
const keyPath = ssh('uci -q get uhttpd.main.key\n');
for (const filename of [certPath, keyPath]) assert.ok(/^\/etc\/[A-Za-z0-9_./-]+$/.test(filename) && !filename.includes('..'), 'Unexpected existing TLS path.');
const currentCertificate = new X509Certificate(ssh('cat ' + certPath + '\n'));
const inputPath = path.join(home, '.local/state/owl-red/openwrt-rebuild/input.json');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const oldFingerprint = currentCertificate.fingerprint256.replaceAll(':', '').toLowerCase();
const newFingerprint = certificate.fingerprint256.replaceAll(':', '').toLowerCase();
assert.ok([oldFingerprint, newFingerprint].includes(input.certificate_sha256), 'Controller TLS pin differs; review before changing it.');
const installed = ssh("if apk info -e luci-mod-rpc >/dev/null 2>&1; then printf installed; else printf missing; fi\n") === 'installed';
const tlsDirectory = '/etc/ssl/owl-red-luci';
const tlsChanged = currentCertificate.fingerprint256 !== certificate.fingerprint256 || certPath !== tlsDirectory + '/fullchain.pem' || keyPath !== tlsDirectory + '/privkey.pem';
const dns = execute(path.join(repository, '.venv/bin/python'), ['-c', "import yaml;from pathlib import Path;print(yaml.safe_load(Path('ansible/inventory/group_vars/aps.yml').read_text())['openwrt_management_dns'])"]);
assert.ok(dns === '10.0.10.30', 'Use the existing Technitium resolver.');
const dnsChanged = ssh('cat /etc/resolv.conf\n') !== 'nameserver ' + dns || ssh('uci -q get network.lan.dns\n') !== dns;
console.log(JSON.stringify({ phase, package: 'luci-mod-rpc', wouldInstall: !installed, wouldUpdateTls: tlsChanged, wouldFixDns: dnsChanged, wifiReload: false }));
if (phase === 'apply') {
  if (dnsChanged) {
    const recovery = '/root/owl-red-luci-dns-' + randomBytes(6).toString('hex');
    ssh(`set -eu
test -z "$(uci changes network)"
umask 077
mkdir '${recovery}'
cp -p /etc/config/network '${recovery}/network'
cp -P /etc/resolv.conf '${recovery}/resolv.conf'
printf 'nameserver ${dns}\\n' > /etc/resolv.conf.owl-red-new
chmod 644 /etc/resolv.conf.owl-red-new
mv /etc/resolv.conf.owl-red-new /etc/resolv.conf
uci -q delete network.lan.dns || true
uci add_list network.lan.dns='${dns}'
uci commit network
`);
    console.log(JSON.stringify({ privateDnsRecovery: recovery, networkReload: false }));
  }
  if (!installed) ssh('set -eu\napk update\napk add luci-mod-rpc\n');
  if (tlsChanged) {
    const recovery = '/root/owl-red-luci-' + randomBytes(6).toString('hex');
    ssh(`set -eu
test -z "$(uci changes uhttpd)"
umask 077
mkdir '${recovery}'
cp -p /etc/config/uhttpd '${recovery}/uhttpd'
mkdir -p '${tlsDirectory}'
cat > '${tlsDirectory}/fullchain.pem.new' <<'OWL_CERT'
${certificateText.trim()}
OWL_CERT
cat > '${tlsDirectory}/privkey.pem.new' <<'OWL_KEY'
${privateKey.trim()}
OWL_KEY
chmod 600 '${tlsDirectory}/privkey.pem.new'
mv '${tlsDirectory}/fullchain.pem.new' '${tlsDirectory}/fullchain.pem'
mv '${tlsDirectory}/privkey.pem.new' '${tlsDirectory}/privkey.pem'
uci set uhttpd.main.cert='${tlsDirectory}/fullchain.pem'
uci set uhttpd.main.key='${tlsDirectory}/privkey.pem'
uci commit uhttpd
if ! /etc/init.d/uhttpd reload; then
  cp -p '${recovery}/uhttpd' /etc/config/uhttpd
  /etc/init.d/uhttpd reload
  exit 1
fi
`);
    console.log(JSON.stringify({ privateApRecovery: recovery }));
  }
  execute('kubectl', ['-n', 'home-assistant', 'exec', '-i', 'deployment/home-assistant', '-c', 'home-assistant', '--', 'python3', '-'], {
    input: "import urllib.request,urllib.error\ntry:\n response=urllib.request.urlopen('https://ap.owl.red/cgi-bin/luci/',timeout=15)\n assert response.status==200\nexcept urllib.error.HTTPError as error:\n assert error.code in (401,403)\n"
  });
  input.certificate_sha256 = newFingerprint;
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ rpcInstalled: true, httpsVerifiedFromHa: true, controllerPinUpdated: true, wifiReload: false }));
}