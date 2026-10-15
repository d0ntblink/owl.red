import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const probeSeconds = 8;
const captureSeconds = 14;

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function save(directory, name, content) {
  fs.writeFileSync(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
}

export function validateOptions(options) {
  for (const name of ['client-host', 'observer-host', 'expected-server', 'forbidden-server']) {
    if (isIP(options[name] ?? '') !== 4) throw new Error(`${name} must be an explicit IPv4 address`);
  }
  for (const name of ['client-interface', 'observer-interface']) {
    if (!/^[A-Za-z0-9_.:-]+$/.test(options[name] ?? '')) throw new Error(`Invalid ${name}`);
  }
  if (!/^[1-9][0-9]{0,8}$/.test(options['container-id'] ?? '')) throw new Error('Invalid container-id');
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(options['client-mac'] ?? '')) throw new Error('Invalid client-mac');
  if ((Number.parseInt(options['client-mac'].slice(0, 2), 16) & 3) !== 2) {
    throw new Error('Use a synthetic locally administered unicast client MAC');
  }
  if (options['expected-server'] === options['forbidden-server']) throw new Error('Server identities must differ');
  if (!options.identity || !options['output-dir']) throw new Error('identity and output-dir are required');
}

export function parseProbeXml(xml) {
  const parser = String.raw`import json, sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
finished = root.find('./runstats/finished')
script = root.find('.//script[@id="broadcast-dhcp-discover"]')
offers = []
if script is not None:
    for table in script.iter('table'):
        fields = {element.get('key'): element.text for element in table.findall('elem')}
        if 'Server Identifier' in fields:
            offers.append(fields)
print(json.dumps({'exit': finished.get('exit') if finished is not None else None, 'offers': offers}))`;
  const result = spawnSync('python3', ['-c', parser], { input: xml, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Nmap XML could not be parsed by Python 3');
  return JSON.parse(result.stdout);
}

export function validateOffers(report, expectedServer, forbiddenServer) {
  if (report.exit !== 'success' || !Array.isArray(report.offers) || report.offers.length === 0) {
    throw new Error('No successful positive-control offer; result is inconclusive');
  }
  const servers = report.offers.map(offer => offer['Server Identifier']);
  if (servers.includes(forbiddenServer)) throw new Error('Forbidden DHCP server offered an address');
  if (!servers.includes(expectedServer) || servers.some(server => server !== expectedServer)) {
    throw new Error('Unexpected DHCP authority or missing positive control');
  }
  if (report.offers.some(offer => offer['DHCP Message Type'] !== 'DHCPOFFER')) {
    throw new Error('Unexpected DHCP message type');
  }
}

export async function coordinateCaptures(captures, runProbe) {
  try {
    await Promise.all(captures.map(capture => capture.ready));
    const report = await runProbe();
    const results = await Promise.all(captures.map(capture => capture.done));
    if (results.length !== 2 || results.some(result => !result.ready || result.exitCode !== 0 || result.pcapBytes <= 24)) {
      throw new Error('Both complete, nonempty packet captures are required');
    }
    return { report, captures: results };
  } finally {
    for (const capture of captures) capture.stop();
    await Promise.allSettled(captures.map(capture => capture.done));
  }
}

function sshArguments(options, host, command) {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=6',
    '-i', options.identity, `root@${host}`, command];
}

function startCapture(options, role) {
  const observer = role === 'observer';
  const host = options[observer ? 'observer-host' : 'client-host'];
  const device = options[observer ? 'observer-interface' : 'client-interface'];
  const directory = options['output-dir'];
  const file = path.join(directory, `${role}.pcap`);
  const descriptor = fs.openSync(file, 'wx', 0o600);
  const prefix = observer ? `set -eu\ncontainer_pid=$(lxc-info -n ${quote(options['container-id'])} -pH)\n` : '';
  const namespace = observer ? 'nsenter --target "$container_pid" --net ' : '';
  const command = `${prefix}exec timeout --preserve-status --signal=INT --kill-after=2s ${captureSeconds}s `
    + `${namespace}tcpdump -p -i ${quote(device)} -nn -s 0 -U -w - 'udp and (port 67 or port 68)'`;
  const child = spawn('ssh', sshArguments(options, host, command), { timeout: 25000 });
  let markReady;
  let failReady;
  const ready = new Promise((resolve, reject) => { markReady = resolve; failReady = reject; });
  let diagnostic = '';
  let announced = false;
  child.stdout.on('data', chunk => fs.writeFileSync(descriptor, chunk));
  child.stderr.on('data', chunk => {
    diagnostic += chunk.toString();
    if (!announced && diagnostic.includes(`listening on ${device},`)) {
      announced = true;
      markReady();
    }
  });
  child.on('error', () => failReady(new Error(`${role} capture could not start`)));
  const done = new Promise(resolve => child.on('close', (exitCode, signal) => {
    fs.closeSync(descriptor);
    if (!announced) failReady(new Error(`${role} capture closed before readiness`));
    const result = { role, host, device, ready: announced, exitCode, signal,
      pcapBytes: fs.statSync(file).size, promiscuous: false, boundedSeconds: captureSeconds };
    save(directory, `${role}-capture.log`, diagnostic);
    save(directory, `${role}-capture.json`, JSON.stringify(result, null, 2) + '\n');
    resolve(result);
  }));
  return { ready, done, stop() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); } };
}

async function runProbe(options) {
  const scriptArguments = `broadcast-dhcp-discover.mac=${options['client-mac']},broadcast-dhcp-discover.timeout=${probeSeconds}s`;
  const command = `exec timeout 18s nmap -sn -e ${quote(options['client-interface'])} `
    + `--script broadcast-dhcp-discover --script-args ${quote(scriptArguments)} -oX -`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn('ssh', sshArguments(options, options['client-host'], command), { timeout: 23000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', () => reject(new Error('Probe SSH could not start')));
    child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
  save(options['output-dir'], 'probe.xml', result.stdout);
  save(options['output-dir'], 'probe.log', result.stderr);
  if (result.exitCode !== 0) throw new Error('Bounded Nmap probe failed; inspect retained evidence before retrying');
  const report = parseProbeXml(result.stdout);
  save(options['output-dir'], 'offers.json', JSON.stringify(report, null, 2) + '\n');
  validateOffers(report, options['expected-server'], options['forbidden-server']);
  return report;
}

async function main() {
  const names = ['client-host', 'observer-host', 'container-id', 'client-interface', 'observer-interface',
    'client-mac', 'expected-server', 'forbidden-server', 'identity', 'output-dir'];
  const { values } = parseArgs({ options: Object.fromEntries([
    ...names.map(name => [name, { type: 'string' }]), ['help', { type: 'boolean' }],
  ]) });
  if (values.help) {
    console.log('Usage: node scripts/capture-dhcp-authority.mjs ' + names.map(name => `--${name} VALUE`).join(' '));
    console.log('DISCOVER only; captures must be reviewed for matching client identity and transaction. No lease or interface changes.');
    return;
  }
  validateOptions(values);
  fs.accessSync(values.identity, fs.constants.R_OK);
  fs.mkdirSync(values['output-dir'], { mode: 0o700 });
  const startedAt = new Date().toISOString();
  save(values['output-dir'], 'configuration.json', JSON.stringify(values, null, 2) + '\n');
  const captures = [startCapture(values, 'observer'), startCapture(values, 'client')];
  try {
    const result = await coordinateCaptures(captures, () => runProbe(values));
    const summary = { startedAt, completedAt: new Date().toISOString(),
      status: 'EVIDENCE_READY_PACKET_REVIEW_REQUIRED', discoverOnly: true, probeSeconds,
      serverIdentifiers: result.report.offers.map(offer => offer['Server Identifier']),
      captures: result.captures, outputDirectory: values['output-dir'] };
    save(values['output-dir'], 'summary.json', JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    save(values['output-dir'], 'failure.json', JSON.stringify({ observedAt: new Date().toISOString(),
      status: 'FAILED_OR_INCONCLUSIVE', message: error.message }, null, 2) + '\n');
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}