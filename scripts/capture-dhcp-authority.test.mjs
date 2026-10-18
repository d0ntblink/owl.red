import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProbeCommand, coordinateCaptures, parseProbeXml, validateOffers, validateOptions } from './capture-dhcp-authority.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function fakeCapture(role, bytes = 300) {
  const readiness = deferred();
  const completion = deferred();
  const result = { role, ready: true, exitCode: 0, pcapBytes: bytes };
  return { readiness, completion, stopped: false, ready: readiness.promise, done: completion.promise,
    stop() { this.stopped = true; completion.resolve(result); } };
}

const validOptions = {
  'client-host': '10.0.10.11', 'observer-host': '10.0.10.3', 'container-id': '200',
  'client-interface': 'vmbr0', 'observer-interface': 'eth0', 'client-mac': '02:00:00:00:00:01',
  'expected-server': '10.0.10.1', 'forbidden-server': '10.0.10.30', identity: '/private/key', 'output-dir': '/private/capture',
};
const validReport = { exit: 'success', offers: [
  { 'Server Identifier': '10.0.10.1', 'DHCP Message Type': 'DHCPOFFER' },
] };

test('requires explicit addresses, safe interfaces and a synthetic client identity', () => {
  assert.doesNotThrow(() => validateOptions(validOptions));
  for (const [name, value] of [['client-host', 'host; command'], ['client-interface', 'vmbr0; command'],
    ['container-id', '200; command'], ['client-mac', '00:00:00:00:00:01'], ['client-mac', '03:00:00:00:00:01']]) {
    assert.throws(() => validateOptions({ ...validOptions, [name]: value }));
  }
});

test('parses real Nmap XML structure using the standard XML parser', () => {
  const report = parseProbeXml('<nmaprun><prescript><script id="broadcast-dhcp-discover">'
    + '<table key="Response 1 of 1:"><elem key="Server Identifier">10.0.10.1</elem>'
    + '<elem key="DHCP Message Type">DHCPOFFER</elem></table></script></prescript>'
    + '<runstats><finished exit="success"/></runstats></nmaprun>');
  assert.deepEqual(report, validReport);
});

test('VLAN captures use only the accepted namespace, interface and authority pair', () => {
  for (const [vlan, observer] of [['20', 'eth1'], ['40', 'eth2'], ['50', 'eth3']]) {
    const options = { ...validOptions, vlan, 'client-interface': `owl-wifi-${vlan}`,
      'observer-interface': observer, 'client-mac': `02:76:79:${vlan}:00:fe`,
      'expected-server': `10.0.${vlan}.1`, 'forbidden-server': `10.0.${vlan}.30` };
    assert.doesNotThrow(() => validateOptions(options));
    assert.match(buildProbeCommand(options), new RegExp(`ip netns exec owl-wifi-${vlan} nmap -sn -e 'owl-wifi-${vlan}'`));
    for (const changed of [{ vlan: '30' }, { 'client-host': '10.0.10.12' },
      { 'observer-interface': 'eth0' }, { 'expected-server': '10.0.10.1' }]) {
      assert.throws(() => validateOptions({ ...options, ...changed }), /accepted cp1/);
    }
  }
  assert.doesNotMatch(buildProbeCommand(validOptions), /netns/);
});

test('requires a positive control rather than accepting silence', () => {
  assert.doesNotThrow(() => validateOffers(validReport, '10.0.10.1', '10.0.10.30'));
  assert.throws(() => validateOffers({ exit: 'success', offers: [] }, '10.0.10.1', '10.0.10.30'), /inconclusive/);
});

test('rejects a forbidden server, an unknown authority and non-offer replies', () => {
  for (const server of ['10.0.10.30', '10.0.10.42']) {
    assert.throws(() => validateOffers({ ...validReport, offers: [...validReport.offers,
      { 'Server Identifier': server, 'DHCP Message Type': 'DHCPOFFER' }] }, '10.0.10.1', '10.0.10.30'));
  }
  assert.throws(() => validateOffers({ exit: 'success', offers: [
    { 'Server Identifier': '10.0.10.1', 'DHCP Message Type': 'DHCPACK' },
  ] }, '10.0.10.1', '10.0.10.30'));
});

test('does not probe until both captures are ready', async () => {
  const observer = fakeCapture('observer');
  const client = fakeCapture('client');
  let probeCalled = false;
  const running = coordinateCaptures([observer, client], async () => {
    probeCalled = true;
    observer.completion.resolve({ role: 'observer', ready: true, exitCode: 0, pcapBytes: 300 });
    client.completion.resolve({ role: 'client', ready: true, exitCode: 0, pcapBytes: 300 });
    return validReport;
  });
  observer.readiness.resolve();
  await Promise.resolve();
  assert.equal(probeCalled, false);
  client.readiness.resolve();
  const result = await running;
  assert.equal(probeCalled, true);
  assert.equal(result.captures.length, 2);
  assert.ok(observer.stopped && client.stopped);
});

test('a capture readiness failure prevents the probe and cleans up both captures', async () => {
  const observer = fakeCapture('observer');
  const client = fakeCapture('client');
  let probeCalled = false;
  const running = coordinateCaptures([observer, client], async () => { probeCalled = true; });
  client.readiness.resolve();
  observer.readiness.reject(new Error('capture unavailable'));
  await assert.rejects(running, /capture unavailable/);
  assert.equal(probeCalled, false);
  assert.ok(observer.stopped && client.stopped);
});

test('header-only captures cannot be reported as evidence ready', async () => {
  const observer = fakeCapture('observer', 24);
  const client = fakeCapture('client');
  observer.readiness.resolve();
  client.readiness.resolve();
  observer.completion.resolve({ ready: true, exitCode: 0, pcapBytes: 24 });
  client.completion.resolve({ ready: true, exitCode: 0, pcapBytes: 300 });
  await assert.rejects(coordinateCaptures([observer, client], async () => validReport), /nonempty/);
});