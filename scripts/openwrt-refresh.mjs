import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';

process.umask(0o077);
const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(repository);
const pin = JSON.parse(fs.readFileSync('ansible/vars/openwrt-firmware.json', 'utf8'));
const phase = process.argv[2] ?? 'prepare';
assert(['fetch', 'prepare', 'build', 'stage', 'apply', 'reboot', 'verify'].includes(phase), 'Use fetch, prepare, build, stage, apply, reboot or verify');
const directory = path.join(os.homedir(), '.local/state/owl-red/openwrt-refresh', pin.version);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const builder = path.join(directory, pin.imageBuilder.filename.replace(/\.tar\.zst$/, ''));
const stateFile = path.join(directory, 'state.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
function execute(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    fs.writeFileSync(path.join(directory, phase + '-failure.log'), String(result.stderr ?? '') + String(result.stdout ?? ''), { mode: 0o600 });
    throw new Error('AP refresh operation failed; private diagnostics: ' + directory);
  }
  return result.stdout;
}
function save() { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 }); }
let rootPassword;
function ssh(command, input, binary = false) {
  if (!rootPassword) {
    const secrets = parseEnv(fs.readFileSync('env.secret', 'utf8'));
    const environment = { ...process.env, BW_SECRET: secrets.BW_SECRET, BITWARDENCLI_APPDATA_DIR: path.join(os.homedir(), '.local/state/owl-red/bitwarden-cli-2026.7.0') };
    const binary = path.join(os.homedir(), '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
    environment.BW_SESSION = execute(binary, ['unlock', '--passwordenv', 'BW_SECRET', '--raw'], { env: environment }).trim();
    const login = JSON.parse(execute(binary, ['get', 'item', '10da341d-20ad-4f4a-b15c-add2008eb0e4'], { env: environment }));
    assert.equal(login.login.username, 'root');
    rootPassword = login.login.password;
  }
  const proxy = 'ssh -i ' + path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible') + ' -o BatchMode=yes -o StrictHostKeyChecking=yes -W %h:%p root@10.0.10.3';
  return execute('sshpass', ['-e', 'ssh', '-T', '-o', 'ProxyCommand=' + proxy, '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=10.10.20.1', '-o', 'ConnectTimeout=8', '-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no', 'root@10.0.10.40', command], { input, env: { ...process.env, SSHPASS: rootPassword }, encoding: binary ? undefined : 'utf8' });
}
function board() {
  const current = JSON.parse(ssh('ubus call system board'));
  assert.equal(current.board_name, pin.board, 'Wrong AP hardware');
  assert([pin.previousVersion, pin.version].includes(current.release.version), 'Unexpected installed firmware');
  return current;
}
if (phase === 'fetch') {
  const archive = path.join(directory, pin.imageBuilder.filename);
  if (!fs.existsSync(archive)) {
    const response = await fetch(pin.baseUrl + pin.imageBuilder.filename);
    assert(response.ok, 'Pinned official ImageBuilder unavailable');
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  }
  const data = fs.readFileSync(archive);
  assert.equal(createHash('sha256').update(data).digest('hex'), pin.imageBuilder.sha256, 'ImageBuilder checksum mismatch');
  if (!fs.existsSync(builder)) execute('tar', ['-xf', '-', '-C', directory], { input: zstdDecompressSync(data) });
  const available = execute('make', ['info'], { cwd: builder });
  assert(available.includes(pin.profile), 'Pinned board profile unavailable');
  console.log(JSON.stringify({ builderChecksumVerified: true, profileAvailable: true, version: pin.version }));
} else if (phase === 'prepare') {
  const current = board();
  assert([pin.previousVersion, pin.version].includes(current.release.version), 'Preparation requires a pinned release');
  const backup = path.join(directory, 'before-reset.tar.gz');
  if (!fs.existsSync(backup)) {
    ssh('umask 077; sysupgrade -b /tmp/owl-red-before-refresh.tar.gz');
    fs.writeFileSync(backup, ssh('cat /tmp/owl-red-before-refresh.tar.gz', undefined, true), { mode: 0o600 });
  }
  state.backupSha256 = createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  state.boardBefore ??= current;
  state.bootBefore ??= ssh('cat /proc/sys/kernel/random/boot_id').trim();
  const identities = JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', "import importlib.util,json,sys,tarfile; spec=importlib.util.spec_from_file_location('native','ansible/library/openwrt_ap.py'); native=importlib.util.module_from_spec(spec); spec.loader.exec_module(native); archive=tarfile.open(sys.argv[1],'r:gz'); config=native.parse_config(archive.extractfile('etc/config/uhttpd').read().decode()); print(json.dumps(sorted({value[field] for value in config.values() for field in ['cert','key'] if field in value})))", backup]));
  for (const identity of identities) {
    assert(/^\/etc\/[A-Za-z0-9_./-]+$/.test(identity) && !identity.split('/').includes('..'), 'Unsafe management identity path');
    const destination = path.join(directory, 'management-identity', identity.slice(1));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, ssh('cat ' + identity, undefined, true), { mode: 0o600 });
  }
  const render = String.raw`import hashlib,importlib.util,json,pathlib,shlex,sys,tarfile
import yaml
from jinja2 import Environment,StrictUndefined
request=json.load(sys.stdin)
root=pathlib.Path(request['directory'])
overlay=root/'overlay'
overlay.mkdir(mode=0o700,exist_ok=True)
profile=yaml.safe_load(pathlib.Path('ansible/inventory/group_vars/aps.yml').read_text())
private=json.loads(pathlib.Path(profile['openwrt_private_input_file'].replace("{{ lookup('env', 'HOME') }}",str(pathlib.Path.home()))).read_text())
profile['openwrt_wifi_keys']=private['wifi_keys']
environment=Environment(undefined=StrictUndefined,trim_blocks=True,lstrip_blocks=True)
environment.filters['quote']=shlex.quote
spec=importlib.util.spec_from_file_location('native_ap','ansible/library/openwrt_ap.py')
native=importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
def write(name,content,mode=0o600):
    target=overlay/name
    target.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
    target.write_bytes(content if isinstance(content,bytes) else content.encode())
    target.chmod(mode)
for name in ['network','wireless','dhcp','firewall']:
    template=pathlib.Path('ansible/templates/openwrt-'+name+'.j2').read_text()
    rendered=environment.from_string(template).render(**profile)
    native.parse_config(rendered)
    write('etc/config/'+name,rendered)
wireless=native.parse_config((overlay/'etc/config/wireless').read_text())
assert len([value for value in wireless.values() if value['.type']=='wifi-iface'])==4
assert all(value.get('disabled')=='0' for value in wireless.values())
with tarfile.open(root/'before-reset.tar.gz','r:gz') as archive:
    members={member.name.removeprefix('./').lstrip('/'):member for member in archive.getmembers() if member.isfile()}
    def copy(name,mode=0o600):
        assert name in members,'Required management identity missing from backup: '+name
        write(name,archive.extractfile(members[name]).read(),mode)
    copy('etc/shadow')
    copy('etc/config/uhttpd')
    keys=[name for name in members if name.startswith('etc/dropbear/dropbear_') and name.endswith('_host_key')]
    assert keys,'No trusted SSH host identity in backup'
    for name in keys: copy(name)
    uhttpd=native.parse_config((overlay/'etc/config/uhttpd').read_text())
    identities={value[field].lstrip('/') for value in uhttpd.values() for field in ['cert','key'] if field in value}
    assert identities
    for name in identities:
        assert name.startswith('etc/') and '..' not in pathlib.PurePosixPath(name).parts
        if name in members:
            copy(name)
        else:
            retained = root / 'management-identity' / name
            assert retained.is_file(), 'Required external management identity missing'
            write(name, retained.read_bytes())
write('etc/sysctl.d/90-owl-ap.conf','net.ipv4.ip_forward=0\nnet.ipv6.conf.all.forwarding=0\n',0o644)
write('etc/resolv.conf','nameserver 10.0.10.30\n',0o644)
bindings=profile['openwrt_bss_bridges']
assert set(bindings)=={'phy0-ap0','phy0-ap1','phy0-ap2','phy1-ap0'}
service=['#!/bin/sh /etc/rc.common','START=99','STOP=10','start() {','    ubus -t 45 wait_for '+' '.join('hostapd.'+name for name in bindings)+' || return 1']
for device,bridge in bindings.items():
  assert bridge in ['br-private','br-guest','br-iot-local','br-iot-cloud']
  service+=['    test -d /sys/class/net/'+device+' || return 1','    test -d /sys/class/net/'+bridge+'/bridge || return 1','    current=$(readlink -f /sys/class/net/'+device+'/master 2>/dev/null || true)','    if test "$current" != /sys/devices/virtual/net/'+bridge+'; then','        if test -n "$current" && test -d "$current/bridge"; then brctl delif "$(basename "$current")" '+device+' || return 1; fi','        brctl addif '+bridge+' '+device+' || return 1','    fi']
service+=['}','reload() { start; }','']
write('etc/init.d/owl-bss-bridges','\n'.join(service),0o755)
link=overlay/'etc/rc.d/S99owl-bss-bridges'
link.parent.mkdir(parents=True,exist_ok=True)
if link.is_symlink() or link.exists(): link.unlink()
link.symlink_to('../init.d/owl-bss-bridges')
defaults='#!/bin/sh\nset -eu\nuci set system.@system[0].hostname=ap\nuci commit system\nfor service in dnsmasq odhcpd firewall opennds; do\n if test -x /etc/init.d/$service; then /etc/init.d/$service disable; fi\ndone\nexit 0\n'
write('etc/uci-defaults/99-owl-ap',defaults,0o700)
for item in [overlay,*overlay.rglob('*')]:
  if item.is_dir(): item.chmod(0o755)
print(json.dumps({'activeBssCount':4,'managementIdentityPreserved':True,'oldOverlayRestored':False}))
`;
  const rendered = execute(path.join(repository, '.venv/bin/python'), ['-c', render], { input: JSON.stringify({ directory }) });
  state.prepared = true;
  save();
  console.log(rendered.trim());
} else if (phase === 'build') {
  assert(state.prepared && fs.existsSync(path.join(builder, 'Makefile')), 'Prepare and verify the pinned builder first');
  const previousUmask = process.umask(0o022);
  let result;
  try {
    result = spawnSync('make', ['image', 'PROFILE=' + pin.profile, 'PACKAGES=' + pin.packages.join(' '), 'FILES=' + path.join(directory, 'overlay')], { cwd: builder, env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } finally {
    process.umask(previousUmask);
  }
  fs.writeFileSync(path.join(directory, 'image-build.log'), result.stdout + result.stderr, { mode: 0o600 });
  assert.equal(result.status, 0, 'Image build failed; private local build log retained');
  const image = path.join(builder, 'bin/targets', pin.target, pin.officialImage.filename);
  assert(fs.existsSync(image), 'Board-specific reset image missing');
  state.image = image;
  state.imageSha256 = createHash('sha256').update(fs.readFileSync(image)).digest('hex');
  state.built = true;
  state.compatibilityPassed = false;
  save();
  console.log(JSON.stringify({ resetImageBuilt: true, version: pin.version, imageSha256: state.imageSha256, containsPrivateIdentity: true }));
} else if (phase === 'stage') {
  assert(state.built && state.image, 'Build the private reset image first');
  board();
  const image = fs.readFileSync(state.image);
  assert.equal(createHash('sha256').update(image).digest('hex'), state.imageSha256);
  ssh('umask 077; cat > /tmp/owl-red-ap-reset.bin', image);
  const checksum = ssh('sha256sum /tmp/owl-red-ap-reset.bin').trim().split(/\s+/)[0];
  assert.equal(checksum, state.imageSha256, 'On-device image checksum mismatch');
  ssh('sysupgrade -T /tmp/owl-red-ap-reset.bin');
  state.compatibilityPassed = true;
  save();
  console.log(JSON.stringify({ onDeviceChecksumVerified: true, nativeCompatibilityPassed: true, APChanged: false }));
} else if (phase === 'apply') {
  assert.equal(process.env.OPENWRT_REFRESH_ALLOWED, 'true', 'Explicit reset/firmware apply approval required');
  assert(state.compatibilityPassed && state.backupSha256, 'Native compatibility and backup gates are required');
  const marker = path.join(directory, 'apply-issued.json');
  assert(!fs.existsSync(marker), 'Reset upgrade already requested; inspect actual state before any retry');
  assert.equal(board().release.version, pin.previousVersion);
  assert.equal(ssh('sha256sum /tmp/owl-red-ap-reset.bin').trim().split(/\s+/)[0], state.imageSha256);
  fs.writeFileSync(marker, JSON.stringify({ imageSha256: state.imageSha256, resetRequested: true }), { mode: 0o600 });
  try {
    ssh('sysupgrade -n /tmp/owl-red-ap-reset.bin');
  } catch {
    console.log('Reset upgrade requested; SSH outcome unknown. Verify boot/version before any retry.');
    process.exit(0);
  }
  console.log('Reset upgrade requested. Verify boot/version before any retry.');
} else if (phase === 'reboot') {
  assert.equal(process.env.OPENWRT_REFRESH_ALLOWED, 'true', 'Explicit AP recovery reboot approval required');
  assert.equal(board().release.version, pin.version);
  assert.equal(ssh('uci -q get wireless.radio1.channel').trim(), '36', 'Require the confirmed recovery channel');
  const marker = path.join(directory, 'post-upgrade-reboot-issued.json');
  assert(!fs.existsSync(marker), 'The approved recovery reboot was already requested');
  state.postUpgradeBootBefore = ssh('cat /proc/sys/kernel/random/boot_id').trim();
  save();
  fs.writeFileSync(marker, JSON.stringify({ channel: 36, oneApRebootRequested: true }), { mode: 0o600 });
  try { ssh('/sbin/reboot'); } catch { console.log('Single AP reboot requested; verify the boot ID before any retry.'); process.exit(0); }
  console.log('Single AP reboot requested; verify the boot ID before any retry.');
} else {
  const current = board();
  assert.equal(current.release.version, pin.version, 'Target firmware did not boot');
  assert.notEqual(ssh('cat /proc/sys/kernel/random/boot_id').trim(), state.postUpgradeBootBefore ?? state.bootBefore, 'Expected fresh AP boot');
  const wireless = JSON.parse(ssh('ubus call network.wireless status'));
  const objects = ssh("ubus list 'hostapd.*'").trim().split('\n').filter(Boolean);
  const present = ssh('for name in network wireless dhcp firewall; do if test -f /etc/config/$name; then printf "%s present\\n" "$name"; else printf "%s missing\\n" "$name"; fi; done').trim().split('\n');
  const logs = ssh('logread | tail -250');
  const radioErrors = logs.split('\n').filter(line => /radio1|phy1/.test(line) && /fail|error|unsupported|not supported/i.test(line) && !/password|secret|psk|key/i.test(line)).map(line => line.replace(/(?:[0-9a-f]{2}:){5}[0-9a-f]{2}/gi, '[mac]')).slice(-10);
  fs.writeFileSync(path.join(directory, 'wireless-runtime.json'), JSON.stringify(wireless), { mode: 0o600 });
  console.log(JSON.stringify({ targetFirmwareVerified: true, version: current.release.version, board: current.board_name, managementSshIdentityPreserved: true, configurationPresence: present, hostapdObjects: objects, radioErrors, radios: Object.entries(wireless).map(([name, value]) => ({ name, up: value.up, pending: value.pending, interfaces: value.interfaces?.map(item => ({ section: item.section, ifname: item.ifname })) })) }));
}