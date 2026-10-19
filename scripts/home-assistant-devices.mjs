#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phase = process.argv[2] ?? 'inspect';
const selected = process.argv[3];
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  ensure(['inspect', 'plan', 'apply'].includes(phase), 'Use inspect, plan or apply.');
  const config = JSON.parse(fs.readFileSync(path.join(repository, 'gitops/home-assistant/devices.json'), 'utf8'));
  ensure(config.endpoint === 'https://ha.owl.red', 'Unexpected Home Assistant endpoint.');
  ensure(!selected || config.devices[selected], 'Unknown device.');
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  const result = spawnSync('bws', ['secret', 'get', config.token_secret_id, '--output', 'json'], {
    env: { ...process.env, BWS_ACCESS_TOKEN: stored.BWS_ACCESS_TOKEN },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
  ensure(result.status === 0, 'Private HA credential lookup failed; details withheld.');
  const token = JSON.parse(result.stdout).value;
  function cameraLogin(id) {
    ensure(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'Camera credential reference is required.');
    const response = spawnSync('bws', ['secret', 'get', id, '--output', 'json'], {
      env: { ...process.env, BWS_ACCESS_TOKEN: stored.BWS_ACCESS_TOKEN },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    ensure(response.status === 0, 'Camera credential lookup failed; private output withheld.');
    let login;
    try { login = JSON.parse(JSON.parse(response.stdout).value); }
    catch { throw new Error('Invalid private camera credential format; details withheld.'); }
    ensure(typeof login?.username === 'string' && login.username.length > 0 && typeof login.password === 'string' && login.password.length > 0, 'Camera credential entry is incomplete.');
    return { username: login.username, password: login.password };
  }
  function vaultItem(id) {
    const home = os.homedir();
    const binary = path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
    const environment = { ...process.env, BW_SECRET: stored.BW_SECRET,
      BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0') };
    delete environment.BW_SESSION;
    function vault(argumentsList) {
      const response = spawnSync(binary, argumentsList, { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
      ensure(response.status === 0, 'Private Bambu credential lookup failed; details withheld.');
      return response.stdout.trim();
    }
    ensure(vault(['--version']) === '2026.7.0', 'Use the verified Bitwarden CLI/profile.');
    environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
    vault(['sync']);
    let item;
    try { item = JSON.parse(vault(['get', 'item', id])); }
    catch { throw new Error('Private device item lookup failed; details withheld.'); }
    return item;
  }
  function bambuSettings(device) {
    const item = vaultItem(device.credential_item);
    function field(name) {
      const matches = (item.fields ?? []).filter(entry => entry.name === name);
      ensure(matches.length <= 1, 'Duplicate private Bambu field: ' + name);
      return matches[0]?.value;
    }
    const serial = field('printer_serial')?.trim().toUpperCase();
    const access_code = field('lan_access_code')?.trim();
    if (!serial || !access_code) return null;
    ensure(/^[A-Z0-9]{8,32}$/.test(serial) && /^[A-Za-z0-9]{8}$/.test(access_code), 'Private Bambu LAN fields have an unexpected format; values withheld.');
    return { host: device.host, serial, access_code, print_cache_count: '5',
      timelapse_cache_count: '0', usage_hours: '0',
      advanced: { disable_ssl_verify: false, enable_firmware_update: false } };
  }
  async function api(route, method = 'GET', body) {
    const response = await fetch(config.endpoint + '/api/' + route, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000)
    });
    ensure(response.ok, 'Home Assistant API request failed: HTTP ' + response.status);
    return response.status === 204 ? null : response.json();
  }
  async function registry(command) {
    const socket = new WebSocket(config.endpoint.replace('https:', 'wss:') + '/api/websocket');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('HA registry request timed out.')), 15000);
      function finish(error, value) {
        clearTimeout(timeout);
        socket.close();
        if (error) reject(error);
        else resolve(value);
      }
      socket.addEventListener('error', () => finish(new Error('HA registry connection failed.')));
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); }
        catch { finish(new Error('Invalid HA registry response; details withheld.')); return; }
        if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        if (message.type === 'auth_invalid') finish(new Error('HA registry authentication failed.'));
        if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, ...command }));
        if (message.type === 'result' && message.id === 1) {
          if (message.success) finish(null, message.result);
          else finish(new Error('HA registry operation failed; private output withheld.'));
        }
      });
    });
  }
  async function reconcileArea(name, device, entry) {
    if (device.area === undefined) return false;
    ensure(typeof device.area === 'string' && device.area.trim().length > 0, 'Area must name an existing HA area.');
    if (device.integration === 'luci') {
      console.log(JSON.stringify({ device: name, area: device.area, areaAssignment: 'not_applied_luci_has_client_trackers_not_an_ap_device', changed: false }));
      return false;
    }
    const areas = await registry({ type: 'config/area_registry/list' });
    const matchingAreas = areas.filter(area => area.name === device.area);
    ensure(matchingAreas.length === 1, 'Create exactly one HA area named ' + device.area + ' before applying this device.');
    const devices = await registry({ type: 'config/device_registry/list' });
    const matchingDevices = devices.filter(registered => registered.config_entries.includes(entry.entry_id));
    const roots = matchingDevices.filter(registered => !registered.via_device_id);
    ensure(roots.length === 1, 'Area assignment requires one device root for ' + name + '; review unrelated devices separately.');
    const connected = new Set([roots[0].id]);
    for (let pass = 0; pass < matchingDevices.length; pass++) {
      for (const registered of matchingDevices) {
        if (connected.has(registered.via_device_id)) connected.add(registered.id);
      }
    }
    ensure(connected.size === matchingDevices.length, 'Area assignment found an unrelated device for ' + name + '; review its parent mapping.');
    const target = matchingAreas[0];
    const different = matchingDevices.filter(registered => registered.area_id !== target.area_id);
    if (different.length && phase === 'apply') {
      for (const registered of different) {
        await registry({ type: 'config/device_registry/update', device_id: registered.id, area_id: target.area_id });
      }
      const updated = await registry({ type: 'config/device_registry/list' });
      ensure(matchingDevices.every(registered => updated.some(candidate => candidate.id === registered.id && candidate.area_id === target.area_id)), 'HA area update could not be verified.');
    }
    console.log(JSON.stringify({ device: name, area: target.name, registeredDevices: matchingDevices.length,
      ...(phase === 'plan' ? { wouldUpdateArea: different.length > 0 } : {}), changed: phase === 'apply' && different.length > 0 }));
    return phase === 'apply' && different.length > 0;
  }
  function homekitCode(id) {
    const response = spawnSync('bws', ['secret', 'get', id, '--output', 'json'], {
      env: { ...process.env, BWS_ACCESS_TOKEN: stored.BWS_ACCESS_TOKEN },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    ensure(response.status === 0, 'Private HomeKit PIN lookup failed; details withheld.');
    let code;
    try { code = JSON.parse(response.stdout).value?.trim(); }
    catch { throw new Error('Invalid private HomeKit PIN response; details withheld.'); }
    ensure(typeof code === 'string' && /^\d{3}[- ]?\d{2}[- ]?\d{3}$/.test(code), 'Private HomeKit PIN must contain eight digits; value withheld.');
    const digits = code.replace(/[- ]/g, '');
    return digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5);
  }
  function discoverHomekit(device) {
    ensure(device.host === '10.0.50.10' && device.service_name === 'ecobee._hap._tcp.local.', 'HomeKit bootstrap is restricted to the Ecobee.');
    function execute(program, argumentsList, input) {
      const response = spawnSync(program, argumentsList, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
      ensure(response.status === 0, 'Bounded Ecobee service discovery failed; private output withheld.');
      return response.stdout.trim();
    }
    const pod = ['-n', 'home-assistant', 'exec', '-i', 'deployment/home-assistant', '-c', 'home-assistant', '--', 'python3', '-'];
    const query = execute('kubectl', pod, `import base64,dns.message,dns.rdatatype
query=dns.message.make_query('_hap._tcp.local',dns.rdatatype.PTR)
query.flags=0
query.question[0].rdclass |= 0x8000
print(base64.b64encode(query.to_wire()).decode())
`);
    const home = os.homedir();
    const packet = execute('ssh', ['-T', '-i', home + '/.ssh/id_ed25519_owl_ansible',
      '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'HostKeyAlias=edge.owl.red',
      '-o', 'UserKnownHostsFile=' + home + '/.local/state/owl-red/vyos-known_hosts',
      '-o', 'ConnectTimeout=5', 'owl-ansible@10.0.10.1', 'python3 -'], `import base64,socket
connection=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
connection.bind(('10.0.50.1',0))
connection.setsockopt(socket.IPPROTO_IP,socket.IP_TTL,255)
connection.settimeout(6)
connection.sendto(base64.b64decode('${query}'),('10.0.50.10',5353))
data,address=connection.recvfrom(8192)
assert address[0]=='10.0.50.10'
connection.close()
print(base64.b64encode(data).decode())
`);
    ensure(/^[A-Za-z0-9+/=]+$/.test(packet), 'Invalid Ecobee discovery response.');
    const verified = execute('kubectl', pod, `import base64,dns.message,dns.rdatatype,json,socket
message=dns.message.from_wire(base64.b64decode('${packet}'))
records=message.answer+message.additional
service=${JSON.stringify(device.service_name)}
srv=next(value for record in records if record.name.to_text()==service and record.rdtype==dns.rdatatype.SRV for value in record)
txt=next(value for record in records if record.name.to_text()==service and record.rdtype==dns.rdatatype.TXT for value in record)
properties=dict(value.split(b'=',1) for value in txt.strings if b'=' in value)
assert properties[b'id'].decode().lower()==${JSON.stringify(device.homekit_id)}
assert int(properties[b'sf']) & 1
assert properties[b'md']==b'ECB501'
assert any(record.name==srv.target and record.rdtype==dns.rdatatype.A and any(value.address=='10.0.50.10' for value in record) for record in records)
connection=socket.create_connection(('10.0.50.10',srv.port),timeout=5)
connection.close()
names={'_hap._tcp.local.',service,srv.target.to_text()}
message.answer=[record for record in records if record.name.to_text() in names and record.rdtype in {dns.rdatatype.PTR,dns.rdatatype.SRV,dns.rdatatype.TXT,dns.rdatatype.A}]
message.additional=[]
message.authority=[]
message.question=[]
message.id=0
sender=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
sender.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
sender.bind(('127.0.0.2',5353))
sender.sendto(message.to_wire(),('127.0.0.1',5353))
sender.close()
print(json.dumps({'host':'10.0.50.10','port':srv.port,'verifiedAdvertisement':True}))
`);
    console.log(JSON.stringify({ device: 'ecobee', discovery: JSON.parse(verified) }));
  }
  const entries = await api('config/config_entries/entry');
  if (phase === 'inspect') {
    console.log(JSON.stringify({ authenticated: true, entries: entries.map(entry => ({
      entry_id: entry.entry_id, domain: entry.domain, title: entry.title, state: entry.state
    })) }, null, 2));
    return;
  }
  ensure(phase !== 'apply' || selected, 'Apply requires one explicitly named device.');
  for (const [name, device] of Object.entries(config.devices).filter(([name]) => !selected || name === selected)) {
    ensure(['ipp', 'onvif', 'bambu_lab', 'homekit_controller', 'luci'].includes(device.integration), 'This device flow has not been qualified.');
    const lan = device.integration === 'bambu_lab' ? bambuSettings(device) : null;
    if (device.integration === 'bambu_lab' && !lan) {
      ensure(phase !== 'apply', 'Add hidden printer_serial and lan_access_code fields to the existing Bambu Lab vault item; no printer changes made.');
      console.log(JSON.stringify({ device: name, pending: 'private_lan_credentials', requiredFields: ['printer_serial', 'lan_access_code'], changed: false }));
      continue;
    }
    const title = device.integration === 'homekit_controller' ? device.name : device.integration === 'bambu_lab' ? lan.serial : device.integration === 'onvif' ? device.name + ' - ' + device.mac : device.host;
    const existing = entries.filter(entry => entry.domain === device.integration && entry.title === title);
    ensure(existing.length <= 1, 'Duplicate device entries require review.');
    if (existing.length) {
      const changed = await reconcileArea(name, device, existing[0]);
      console.log(JSON.stringify({ device: name, configured: true, state: existing[0].state, changed }));
      continue;
    }
    if (phase === 'plan') {
      console.log(JSON.stringify({ device: name, integration: device.integration, host: device.host, wouldAdd: true, changed: false }));
      continue;
    }
    let flow;
    try {
      if (device.integration === 'homekit_controller') discoverHomekit(device);
      flow = await api('config/config_entries/flow', 'POST', { handler: device.integration, show_advanced_options: true });
      if (device.integration === 'homekit_controller') {
        ensure(flow.type === 'form' && flow.step_id === 'user', 'Ecobee was not discovered by HA; no pairing attempt made.');
        flow = await api('config/config_entries/flow/' + flow.flow_id, 'POST', { device: device.name });
      }
      if (device.integration === 'onvif' && flow.type === 'form' && flow.step_id === 'user') {
        flow = await api('config/config_entries/flow/' + flow.flow_id, 'POST', { auto: false });
      }
      if (device.integration === 'bambu_lab' && flow.type === 'form' && flow.step_id === 'user') {
        flow = await api('config/config_entries/flow/' + flow.flow_id, 'POST', { printer_mode: 'lan' });
      }
      const step = { ipp: 'user', onvif: 'configure', bambu_lab: 'Lan', homekit_controller: 'pair', luci: 'user' }[device.integration];
      ensure(flow.type === 'form' && flow.step_id === step, 'Unexpected integration setup step.');
      ensure(!Object.keys(flow.errors ?? {}).length, 'Integration setup returned errors before credential submission.');
      const { integration, credential_secret_id, credential_item, mac, homekit_id, service_name, area, ...settings } = device;
      if (integration === 'onvif') Object.assign(settings, cameraLogin(credential_secret_id));
      if (integration === 'luci') {
        ensure(settings.ssl === true && settings.verify_ssl === true && settings.host === 'ap.owl.red', 'Use the verified AP HTTPS endpoint.');
        const item = vaultItem(credential_item);
        ensure(item.login?.username && item.login.password, 'OpenWrt credential is incomplete.');
        Object.assign(settings, { username: item.login.username, password: item.login.password });
      }
      const pairing = integration === 'homekit_controller' ? { pairing_code: homekitCode(credential_secret_id) } : null;
      const configured = await api('config/config_entries/flow/' + flow.flow_id, 'POST', pairing ?? lan ?? settings);
      if (configured.type === 'form') throw new Error('Integration requires attention: ' + JSON.stringify(configured.errors ?? {}));
      ensure(configured.type === 'create_entry' || (configured.type === 'abort' && configured.reason === 'already_configured'), 'Integration setup did not complete.');
      console.log(JSON.stringify({ device: name, integration, configured: true, changed: configured.type === 'create_entry', entryId: configured.result?.entry_id }));
      flow = undefined;
      if (device.area !== undefined) {
        const current = await api('config/config_entries/entry');
        const created = current.filter(entry => entry.domain === integration && entry.title === title);
        ensure(created.length === 1, 'Configured integration requires review before assigning an area.');
        await reconcileArea(name, device, created[0]);
      }
    } finally {
      if (flow?.flow_id) {
        try { await api('config/config_entries/flow/' + flow.flow_id, 'DELETE'); } catch { }
      }
    }
  }
}

try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }