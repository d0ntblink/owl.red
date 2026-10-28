#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { checkServerIdentity } from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selectedPhase = process.argv[2] ?? 'inspect-local';
assert.ok(['inspect-local', 'enable-api-local', 'api-local', 'qualify-local', 'bootstrap-production', 'status-production', 'inspect-production', 'enable-api-production', 'api-production', 'ap-plan-production', 'audit-production', 'adopt-production', 'apply-production'].includes(selectedPhase), 'Unknown controller phase');
const production = selectedPhase.endsWith('-production');
const phase = production ? selectedPhase.replace('-production', '-local') : selectedPhase;
const home = os.homedir();
const directory = path.join(home, '.local/state/owl-red/gwn-manager');
const credentialFile = path.join(directory, production ? 'production-api.json' : 'wsl-api.json');
const configuration = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/gwn-manager.json'), 'utf8'));
const origin = production ? configuration.management.url : 'https://localhost:8443';
const endpoint = production ? 'https://' + configuration.container.address.split('/')[0] + ':8443' : origin;
const controllerCA = production ? fs.readFileSync(path.join(directory, 'controller-ca.pem')) : undefined;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function connection(useLocal = false) {
  const secure = production && !useLocal;
  const requestOrigin = secure ? origin : 'https://localhost:8443';
  const requestEndpoint = secure ? endpoint : requestOrigin;
  const cookies = new Map();
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    'X-Auth-Token': Buffer.from(String(Date.now())).toString('base64'),
    Origin: requestOrigin,
    Referer: requestOrigin + '/login',
    ...(secure ? { Host: new URL(requestOrigin).hostname } : {}),
  };
  async function request(route, method = 'POST', body = {}) {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Only local relative routes are allowed');
    const form = body instanceof URLSearchParams;
    const bytes = form ? body.toString() : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const request = https.request(requestEndpoint + route, {
        method,
        rejectUnauthorized: secure,
        ...(secure ? { ca: controllerCA, servername: '', checkServerIdentity: (_hostname, certificate) => checkServerIdentity(new URL(requestEndpoint).hostname, certificate) } : {}),
        timeout: 15000,
        headers: {
          ...headers,
          ...(cookies.size ? { Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; ') } : {}),
          ...(bytes === undefined ? {} : {
            'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
            'Content-Length': Buffer.byteLength(bytes),
          }),
        },
      }, response => {
        let text = '';
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          for (const cookie of response.headers['set-cookie'] ?? []) {
            const pair = cookie.split(';')[0];
            const separator = pair.indexOf('=');
            cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
          }
          if (response.headers['x-auth-token']) headers['X-Auth-Token'] = response.headers['x-auth-token'];
          if (response.headers.authorization) headers.Authorization = response.headers.authorization;
          let data;
          try { data = JSON.parse(text); }
          catch { reject(new Error('Local controller returned non-JSON; private response withheld')); return; }
          if (response.statusCode !== 200) {
            reject(new Error('Local controller HTTP ' + response.statusCode + '; private response withheld'));
            return;
          }
          resolve(data);
        });
      });
      request.on('error', () => reject(new Error('Local HTTPS request failed; private output withheld')));
      request.on('timeout', () => request.destroy());
      request.end(bytes);
    });
  }
  return { request, hostname: new URL(requestOrigin).hostname };
}

const cachedCredentials = new Map();
let vaultRead;
async function credentials(reference = configuration.management.credential_item) {
  if (cachedCredentials.has(reference)) return cachedCredentials.get(reference);
  if (!vaultRead) {
  const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
  const environment = {
    ...process.env,
    BW_SECRET: stored.BW_SECRET,
    BITWARDENCLI_APPDATA_DIR: path.join(home, '.local/state/owl-red/bitwarden-cli-2026.7.0'),
  };
  delete environment.BW_SESSION;
  function vault(argumentsList) {
    const result = spawnSync(path.join(home, '.local/share/owl-red/tools/bitwarden/2026.7.0/bw'), argumentsList, {
      env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.ok(result.status === 0, 'Private vault operation failed; output withheld');
    return result.stdout.trim();
  }
  environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
  vault(['sync']);
    vaultRead = id => JSON.parse(vault(['get', 'item', id]));
  }
  const item = vaultRead(reference);
  assert.ok(item.login?.password, 'Incomplete private credential item');
  if (reference === configuration.management.credential_item) assert.ok(item.name === 'GWN Manager' && item.login.username, 'Unexpected Manager credential');
  cachedCredentials.set(reference, item.login);
  return item.login;
}

async function login(client) {
  const account = await credentials();
  const result = await client.request('/user/app/login', 'POST', {
    userName: account.username,
    userPwd: sha256(crypto.createHash('md5').update(account.password).digest('hex')),
    serverId: '', code: '', checkCode: '', codeToken: '', lang: 'en',
    browserDomain: client.hostname, checkMFACodeFirst: 1,
  });
  assert.ok(result.retCode === 0, 'GWN account authentication failed; no automatic retry');
  const session = await client.request('/app/login', 'POST', { lang: 'en', requestDomain: result.data?.url });
  assert.ok(session.retCode === 0, 'GWN Manager session initialization failed');
  return result.data;
}

const client = connection();
if (phase === 'bootstrap-local') {
  assert.ok(production, 'Bootstrap is production-only');
  assert.equal(process.env.GWN_MANAGER_APPLY_ALLOWED, 'true', 'Explicit production bootstrap approval required');
  const status = await client.request('/app/wizard/initial_info');
  assert.ok(status.retCode === 0, 'Controller status read failed');
  if (status.data.setup_wizard === '0') {
    const account = await credentials();
    const email = configuration.management.contact_email;
    assert.ok(typeof email === 'string' && email.endsWith('@owl.red'), 'Controller contact email is required');
    const countries = await client.request('/app/wizard/get_country');
    const zones = await client.request('/app/timezones', 'GET');
    const country = countries.data?.countries?.find(item => item.countryDisplay === 'Canada' || String(item.domain).toUpperCase() === 'CA');
    const zone = zones.data?.timezones?.find(item => JSON.stringify(item).includes('Edmonton'));
    assert.ok(country?.domain && zone?.timezoneId, 'Canada/Edmonton wizard identifiers unavailable');
    const password = sha256(crypto.createHash('md5').update(account.password).digest('hex'));
    const result = await client.request('/app/wizard/finish', 'POST', {
      country: country.domain, timezone: zone.timezoneId, account: account.username,
      password, confirmPassword: password, email,
      macs: [], ssid_ssid: '', ssid_wpa_key: '',
    });
    assert.ok(result.retCode === 0, 'Production wizard failed; inspect before retrying. Code ' + result.retCode);
  }
  await login(client);
  await client.request('/app/logout');
  console.log(JSON.stringify({ productionInitialized: true, existingVaultLoginVerified: true, apAdopted: false }));
} else if (phase === 'status-local') {
  const result = await client.request('/app/wizard/initial_info');
  assert.ok(result.retCode === 0, 'Controller status read failed');
  console.log(JSON.stringify({ strictTls: production, wizard: result.data.setup_wizard, accountRoute: result.data.account_domain }));
} else if (['api-local', 'qualify-local', 'ap-plan-local', 'audit-local', 'adopt-local', 'apply-local'].includes(phase)) {
  if (phase === 'qualify-local') assert.equal(process.env.GWN_MANAGER_QUALIFY_ALLOWED, 'true', 'Explicit local CRUD qualification approval required');
  if (['adopt-local', 'apply-local'].includes(phase)) assert.equal(process.env.GWN_MANAGER_APPLY_ALLOWED, 'true', 'Explicit production AP change approval required');
  const credential = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  const token = await client.request('/oauth/token', 'POST', new URLSearchParams({
    grant_type: 'client_credentials', client_id: String(credential.appId), client_secret: credential.secretKey,
  }));
  assert.ok(token.access_token, 'Official local API token request failed; private response withheld');
  async function api(route, body = {}, method = 'POST') {
    const timestamp = String(Date.now());
    const signature = sha256('&access_token=' + token.access_token + '&appID=' + credential.appId +
      '&secretKey=' + credential.secretKey + '&timestamp=' + timestamp + '&' + sha256(JSON.stringify(body)) + '&');
    const query = new URLSearchParams({ access_token: token.access_token, appID: String(credential.appId), timestamp, signature });
    const result = await client.request('/oapi/v1.0.0/' + route + '?' + query, method, body);
    assert.ok(result.retCode === 0, 'Official API ' + route + ' returned code ' + result.retCode + '; private response withheld');
    return result.data;
  }
  const listing = await api('network/list', { pageNum: 1, pageSize: 100 });
  assert.ok(Array.isArray(listing.result) && listing.total <= 100, 'Incomplete network inventory');
  if (['ap-plan-local', 'audit-local', 'adopt-local', 'apply-local'].includes(phase)) {
    assert.ok(production && listing.result.length === 1, 'Expected one production network');
    const networkId = listing.result[0].id;
    const target = configuration.access_point;
    const canonical = value => String(value).toLowerCase().replace(/[^a-f0-9]/g, '');
    const browser = connection();
    await login(browser);
    try {
      const inventory = await browser.request('/app/ap/configure/list?network=' + networkId, 'POST', { pageNum: 1, pageSize: 100 });
      assert.ok(inventory.retCode === 0 && Array.isArray(inventory.data?.result) && inventory.data.total <= 100, 'Incomplete production AP inventory');
      const owned = inventory.data.result.filter(item => canonical(item.mac) === canonical(target.mac));
      assert.ok(owned.length <= 1, 'Duplicate target AP');
      if (phase === 'audit-local') {
        const ssids = await api('ssid/list', { networkId, pageNum: 1, pageSize: 100 });
        assert.ok(Array.isArray(ssids.result) && ssids.total <= 100, 'Incomplete SSID inventory');
        const records = [];
        for (const ssid of ssids.result) {
          const response = await api('ssid/configuration', { id: ssid.id }, 'GET');
          const actual = response.configuration;
          assert.ok(actual, 'SSID configuration missing');
          records.push({ ssid: ssid.ssidName, enabled: actual.ssidEnable, vlanEnabled: actual.ssidVlan,
            vlan: actual.ssidVlanid, bands: actual.ssidNewSsidBand, securityType: actual.ssidSecurityType,
            encryption: actual.ssidEncryption, clientIsolation: actual.ssidIsolation,
            isolationMode: actual.ssidIsolationMode, portalEnabled: actual.ssidPortalEnable,
            ipAssignment: actual.ssidClientIPAssignment, onlineDevices: ssid.onlineDevices,
            bindingFields: Object.keys(response).filter(key => /bind|device|mac/i.test(key)) });
        }
        console.log(JSON.stringify({ accessPoint: owned.map(item => ({ mac: item.mac, ip: item.ipv4 ?? item.ip,
          status: item.status, paired: item.paired, configSuccess: item.configSuccess, natSwitch: item.natSwitch,
          portFields: { devicePortInfos: item.devicePortInfos, portsInfo: item.portsInfo } })), ssids: records }, null, 2));
      } else if (phase === 'adopt-local' && !owned.length) {
        const stored = parseEnv(fs.readFileSync(path.join(repository, 'env.secret'), 'utf8'));
        assert.ok(stored.grandstream, 'Existing AP bootstrap credential required');
        fs.writeFileSync(path.join(directory, 'adoption-requested.json'), JSON.stringify({ mac: target.mac, networkId, at: new Date().toISOString() }), { mode: 0o600 });
        await api('ap/add', { networkId, mac: target.mac, name: target.name, model: target.model, password: stored.grandstream });
        console.log(JSON.stringify({ adoptionRequested: true, mac: target.mac, networkId }));
      } else if (phase === 'apply-local') {
        assert.ok(owned.length === 1 && owned[0].status === 1 && owned[0].firmware,
          'Target AP must be online before SSID binding');
        const parsed = spawnSync(path.join(repository, '.venv/bin/python'), ['-c', "import json,yaml;print(json.dumps(yaml.safe_load(open('ansible/vars/wifi-networks.yml'))['wifi_networks']))"], { cwd: repository, encoding: 'utf8' });
        assert.ok(parsed.status === 0, 'Wi-Fi policy parse failed');
        const networks = JSON.parse(parsed.stdout);
        const ssids = await api('ssid/list', { networkId, pageNum: 1, pageSize: 100 });
        assert.ok(Array.isArray(ssids.result) && ssids.total <= 100, 'Incomplete SSID inventory');
        const preimage = { networkId, ap: target.mac, ssids: [] };
        const preimageFile = path.join(directory, 'production-ssids-before-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json');
        for (const name of configuration.retired_bootstrap_ssids ?? []) {
          assert.ok(!Object.values(networks).some(network => network.ssid === name), 'Bootstrap and managed SSID names collide');
          const matches = ssids.result.filter(item => item.ssidName === name);
          assert.ok(matches.length <= 1, 'Duplicate bootstrap SSID');
          if (!matches.length) continue;
          const id = matches[0].id;
          const before = (await api('ssid/configuration', { id }, 'GET')).configuration;
          assert.ok(before, 'Bootstrap SSID configuration missing');
          assert.ok(Number(before.ssidVlan) === 0, 'Refuse retirement of a tagged production SSID');
          preimage.ssids.push({ name, id, configuration: before });
          fs.writeFileSync(preimageFile, JSON.stringify(preimage), { mode: 0o600 });
          await api('ssid/delete', { id });
          const after = await api('ssid/list', { networkId, pageNum: 1, pageSize: 100 });
          assert.ok(!after.result.some(item => item.id === id), 'Bootstrap management SSID still exists');
          console.log(JSON.stringify({ ssid: name, retired: true, verified: true }));
        }
        for (const [name, network] of Object.entries(networks)) {
          const matches = ssids.result.filter(item => item.ssidName === network.ssid);
          assert.ok(matches.length <= 1, 'Duplicate managed SSID');
          const secret = await credentials(network.credential_item);
          const desired = {
            networkId, ssidSsid: network.ssid, ssidEnable: network.enabled ? 1 : 0,
            ssidVlan: 1, ssidVlanid: network.vlan, ssidNewSsidBand: network.bands.map(band => band === '2.4' ? '2' : band).join(','),
            ssidSecurityType: 1, ssidEncryption: 3, ssidWpaEncryption: 0, ssidWpaKey: secret.password,
            ssidWepKey: '', ssidIsolation: network.isolate ? 1 : 0, ssidIsolationMode: '0',
            bindMacs: [owned[0].mac], removeMacs: [], ssidPortalEnable: 0,
            ssidPortalPolicy: 0, scheduleId: 0, ssidMacFiltering: 0,
            ssidMaclistBlacks: [], ssidMaclistWhites: [], ssidTimedClientPolicy: 0,
          };
          const before = matches.length ? (await api('ssid/configuration', { id: matches[0].id }, 'GET')).configuration : undefined;
          preimage.ssids.push({ name, id: matches[0]?.id, configuration: before });
          fs.writeFileSync(preimageFile, JSON.stringify(preimage), { mode: 0o600 });
          const actualFields = ['ssidSsid', 'ssidEnable', 'ssidVlan', 'ssidVlanid', 'ssidNewSsidBand', 'ssidSecurityType', 'ssidEncryption', 'ssidWpaEncryption', 'ssidWpaKey', 'ssidIsolation', 'ssidPortalEnable'];
          const changed = !before || actualFields.some(field => String(before[field]) !== String(desired[field]));
          let id = matches[0]?.id;
          if (changed) {
            if (id) await api('ssid/update', { ...desired, id });
            else id = (await api('ssid/create', desired)).id;
          }
          const actual = (await api('ssid/configuration', { id }, 'GET')).configuration;
          assert.ok(actualFields.every(field => String(actual[field]) === String(desired[field])), 'Managed SSID read-back mismatch; private values withheld');
          console.log(JSON.stringify({ ssid: network.ssid, vlan: network.vlan, bands: network.bands, enabled: network.enabled, changed, verified: true }));
        }
      } else {
        const discovery = await browser.request('/app/adopt/list?network=' + networkId, 'POST', { pageNum: 1, pageSize: 100, search: '' });
        console.log(JSON.stringify({ networkId, registeredTarget: owned.map(item => ({ mac: item.mac, status: item.status,
          ip: item.ipv4 ?? item.ip, firmware: item.firmware, paired: item.paired, configSuccess: item.configSuccess,
          linkSpeed: item.linkSpeed, portSpeed: item.portSpeed, channel2g4: item.channel2g4,
          channel5g: item.channel5g, frequency: item.frequency })), discoveryCode: discovery.retCode }));
      }
    } finally { await browser.request('/app/logout'); }
  } else if (phase === 'api-local') {
    const detail = listing.result[0]?.id ? await api('network/detail', { id: listing.result[0].id }) : {};
    const fixtures = [];
    for (const network of listing.result.filter(item => String(item.networkName ?? item.name).startsWith('owl-iac-'))) {
      const devices = await api('ap/list', { networkId: network.id, pageNum: 1, pageSize: 100 });
      fixtures.push({ id: network.id, name: network.networkName ?? network.name,
        responseType: Array.isArray(devices) ? 'array' : typeof devices,
        fields: Object.keys(devices ?? {}), total: devices.total,
        arrays: Object.fromEntries(Object.entries(devices ?? {}).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) });
      const browser = connection();
      await login(browser);
      try {
        const native = await browser.request('/app/ap/configure/list?network=' + network.id, 'POST', { pageNum: 1, pageSize: 100 });
        fixtures.at(-1).native = { retCode: native.retCode, fields: Object.keys(native.data ?? {}),
          total: native.data?.total, arrays: Object.fromEntries(Object.entries(native.data ?? {}).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) };
      } finally { await browser.request('/app/logout'); }
    }
    console.log(JSON.stringify({ authenticatedOfficialApi: true, networkCount: listing.total,
      networkDetailFields: Object.keys(detail), countryType: typeof detail.country,
      timezoneType: typeof detail.timezone,
      administratorsType: Array.isArray(detail.networkAdmins) ? 'array' : typeof detail.networkAdmins, fixtures }));
  }
  else {
    const pending = listing.result.filter(item => String(item.networkName ?? item.name).startsWith('owl-iac-'));
    assert.ok(pending.length <= 1, 'Review multiple existing fixtures before qualification');
    const suffix = pending.length ? (pending[0].networkName ?? pending[0].name).slice('owl-iac-'.length) : crypto.randomBytes(5).toString('hex');
    assert.match(suffix, /^[a-f0-9]{10}$/);
    const networkName = 'owl-iac-' + suffix;
    const resultFile = path.join(directory, 'qualification-' + suffix + '.json');
    if (pending.length) {
      const previous = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      assert.ok(previous.networkName === networkName && previous.networkId === pending[0].id, 'Existing fixture ownership is not proven');
    }
    const report = { networkName, apiAuthentication: true, apBindingAllowed: false, crudPassed: false, cleanupPassed: false };
    fs.writeFileSync(resultFile, JSON.stringify(report), { mode: 0o600 });
    let networkId;
    let ssidId;
    let browser;
    async function requireEmptyNetwork() {
      const devices = await api('ap/list', { networkId, pageNum: 1, pageSize: 100 });
      if (devices && typeof devices === 'object' && devices.total === 0 && Array.isArray(devices.result) && devices.result.length === 0) return;
      if (!browser) { browser = connection(); await login(browser); }
      const native = await browser.request('/app/ap/configure/list?network=' + networkId, 'POST', { pageNum: 1, pageSize: 100 });
      assert.ok(native.retCode === 0 && native.data?.total === 0 && Array.isArray(native.data.result) && native.data.result.length === 0,
        'Fixture must have a counted, empty AP inventory');
    }
    try {
      const source = listing.result[0];
      assert.ok(source?.id, 'Expected an existing network for read-only country/time-zone lookup');
      const detail = await api('network/detail', { id: source.id });
      assert.ok(detail.country && detail.timezone, 'Network country/time-zone response needs qualification');
      assert.ok(Array.isArray(detail.networkAdmins) && detail.networkAdmins.length > 0, 'Expected existing network administrator assignments');
      const administrators = detail.networkAdmins.map(item => typeof item === 'object' ? item.id : item);
      assert.ok(administrators.every(item => item !== undefined && item !== null), 'Network administrator identifier mapping needs qualification');
      if (!pending.length) await api('network/create', { networkName, country: detail.country, timezone: detail.timezone, networkAdministrators: administrators });
      const created = await api('network/list', { pageNum: 1, pageSize: 100 });
      const matches = created.result.filter(item => (item.networkName ?? item.name) === networkName);
      assert.ok(matches.length === 1, 'Expected exactly one owned fixture network');
      networkId = matches[0].id;
      report.networkId = networkId;
      fs.writeFileSync(resultFile, JSON.stringify(report), { mode: 0o600 });
      await requireEmptyNetwork();
      const desired = {
        networkId, ssidSsid: 'owl-iac-probe-' + suffix, ssidEnable: 0,
        ssidVlan: 1, ssidVlanid: 20, ssidNewSsidBand: '2,5',
        ssidSecurityType: 1, ssidEncryption: 3, ssidWpaEncryption: 0, ssidWpaKey: crypto.randomBytes(24).toString('hex'),
        ssidWepKey: '', ssidIsolation: 0, bindMacs: [], removeMacs: [],
        ssidPortalEnable: 0, ssidPortalPolicy: 0, scheduleId: 0,
        ssidMacFiltering: 0, ssidMaclistBlacks: [], ssidMaclistWhites: [], ssidTimedClientPolicy: 0,
      };
      const createdSsid = await api('ssid/create', desired);
      ssidId = createdSsid.id;
      assert.ok(ssidId, 'SSID creation did not return an ID');
      const ssids = await api('ssid/list', { networkId, pageNum: 1, pageSize: 100 });
      const records = ssids.result.filter(item => item.ssidName === desired.ssidSsid && item.id === ssidId);
      assert.ok(records.length === 1, 'Expected exactly one owned fixture SSID');
      ssidId = records[0].id;
      report.ssidId = ssidId;
      fs.writeFileSync(resultFile, JSON.stringify(report), { mode: 0o600 });
      for (const vlan of [20, 30, 40, 50]) {
        const band = vlan < 40 ? '2,5' : '2';
        const isolation = vlan === 20 ? 0 : 1;
        await api('ssid/update', { ...desired, id: ssidId, ssidVlanid: vlan, ssidNewSsidBand: band, ssidIsolation: isolation });
        const response = await api('ssid/configuration', { id: ssidId }, 'GET');
        const actual = response.configuration;
        assert.ok(actual, 'Expected documented SSID configuration wrapper');
        assert.ok(Number(actual.ssidVlanid) === vlan && Number(actual.ssidEnable) === 0 &&
          Number(actual.ssidIsolation) === isolation && actual.ssidNewSsidBand === band,
        'Fixture SSID VLAN/band/isolation read-back did not match; values withheld');
        report.wpaResponse = { encryption: actual.ssidEncryption, keyMode: actual.ssidWpaEncryption,
          keyType: typeof actual.ssidWpaKey, keyLength: typeof actual.ssidWpaKey === 'string' ? actual.ssidWpaKey.length : null,
          keyMasked: typeof actual.ssidWpaKey === 'string' && /^\*+$/.test(actual.ssidWpaKey),
          keyEqualsSubmitted: actual.ssidWpaKey === desired.ssidWpaKey };
        assert.ok(Number(actual.ssidSecurityType) === 1 && Number(actual.ssidEncryption) === 3 && Number(actual.ssidWpaEncryption) === 0 &&
          actual.ssidWpaKey === desired.ssidWpaKey, 'Fixture WPA2/PSK read-back did not match; values withheld');
      }
      report.wpaReadbackPassed = true;
      report.crudPassed = true;
    } finally {
      if (ssidId) await api('ssid/delete', { id: ssidId });
      if (networkId) {
        await requireEmptyNetwork();
        await api('network/delete', { id: networkId });
        const after = await api('network/list', { pageNum: 1, pageSize: 100 });
        report.cleanupPassed = !after.result.some(item => item.id === networkId);
      }
      fs.writeFileSync(resultFile, JSON.stringify(report), { mode: 0o600 });
      console.log(JSON.stringify(report));
      if (browser) await browser.request('/app/logout');
    }
  }
} else {
  if (phase === 'enable-api-local') assert.equal(process.env.GWN_MANAGER_QUALIFY_ALLOWED, 'true', 'Explicit local API enablement approval required');
  await login(client);
  try {
    let result = await client.request('/app/developer/info');
    assert.ok(result.retCode === 0, 'Developer-info read failed');
    if (phase === 'enable-api-local' && result.data.isOpenApi !== 1) {
      const enabled = await client.request('/app/developer/open');
      assert.ok(enabled.retCode === 0, 'Developer-mode enable failed; inspect before retrying');
      result = await client.request('/app/developer/info');
      assert.ok(result.retCode === 0 && result.data.isOpenApi === 1, 'Developer mode not confirmed');
    }
    if (phase === 'enable-api-local') {
      console.log(JSON.stringify({ developerEnabled: true, credentialFieldNames: Object.keys(result.data) }));
      const appKey = typeof result.data.appKey === 'object' && result.data.appKey !== null ? result.data.appKey : {};
      const appId = result.data.appId ?? result.data.appID ?? appKey.appId ?? appKey.appID ?? appKey.clientId;
      const secretKey = result.data.secretKey ?? result.data.appSecret ?? appKey.secretKey ?? appKey.appSecret ?? appKey.clientSecret;
      assert.ok(appId && secretKey, 'API credential field mapping needs qualification; private values withheld');
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(credentialFile, JSON.stringify({ appId, secretKey }), { mode: 0o600 });
    } else console.log(JSON.stringify({ authenticated: true, developerEnabled: result.data.isOpenApi === 1 }));
  } finally { await client.request('/app/logout'); }
}