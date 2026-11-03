import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dockerInventory, groupImages, imageReference, kubernetesInventory, proxmoxVersions, sbomComponents } from './software-inventory.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const reference = `ghcr.io/example/service@${digest}`;

test('only observed immutable references are accepted; mutable tags and unmatched IDs stay unresolved', () => {
    assert.equal(imageReference(`docker-pullable://${reference}`), reference);
    assert.equal(imageReference(digest, reference), reference);
    assert.equal(imageReference(digest, 'example/service:latest'), null);
    assert.equal(imageReference(`sha256:${'b'.repeat(64)}`, reference), null);
    assert.equal(imageReference('example/service:latest'), null);
});

test('running Kubernetes metadata is projected without environment, secrets, mounts or node identity material', () => {
    const report = kubernetesInventory({ items: [{
        metadata: { namespace: 'test', name: 'service-123' },
        spec: { nodeName: 'node-one', containers: [{ name: 'app', image: reference,
            env: [{ name: 'PASSWORD', value: 'must-not-export' }], volumeMounts: [{ mountPath: '/private' }] }] },
        status: { containerStatuses: [{ name: 'app', imageID: reference, state: { running: {} } },
            { name: 'waiting', state: { waiting: {} } }] },
    }] }, { items: [{ metadata: { name: 'node-one' }, status: { nodeInfo: {
        osImage: 'Talos', kernelVersion: '1.2.3', machineID: 'must-not-export', systemUUID: 'must-not-export',
    } } }] });
    assert.equal(report.deployments.length, 1);
    assert.equal(report.deployments[0].scanReference, reference);
    assert.equal(report.platforms[0].cpe, null);
    assert.doesNotMatch(JSON.stringify(report), /must-not-export|PASSWORD|volumeMounts|systemUUID|machineID/);
});

test('Docker uses inspected image digests, not tags, and shared images are deduplicated with deployment links', () => {
    const deployments = dockerInventory({ containers: [
        { name: 'first', declaredImage: 'service:latest', imageId: digest, repoDigests: [reference], secret: 'must-not-export' },
        { name: 'second', declaredImage: 'service:latest', imageId: digest, repoDigests: [reference] },
        { name: 'local-only', declaredImage: 'custom:latest', imageId: digest, repoDigests: [] },
    ] });
    assert.equal(deployments[2].scanReference, null);
    const images = groupImages(deployments);
    assert.equal(images.length, 1);
    assert.equal(images[0].assetIds.length, 2);
    assert.doesNotMatch(JSON.stringify(deployments), /must-not-export/);
});

test('native SBOM components retain PURLs and unverified CPE candidates but omit source metadata', () => {
    const components = sbomComponents({ source: { metadata: { environment: 'must-not-export' } }, artifacts: [{
        name: 'example', version: '1.2.3', type: 'python', purl: 'pkg:pypi/example@1.2.3',
        foundBy: 'python-package-cataloger', metadata: { secret: 'must-not-export' },
        cpes: [{ cpe: 'cpe:2.3:a:example:example:1.2.3:*:*:*:*:*:*:*', source: 'declared' }],
    }, { name: 'unmatched', version: 'unknown', cpes: [] }] });
    assert.equal(components[0].cpes[0].reviewStatus, 'unverified');
    assert.equal(components[0].purl, 'pkg:pypi/example@1.2.3');
    assert.equal(components[1].purl, null);
    assert.deepEqual(components[1].cpes, []);
    assert.doesNotMatch(JSON.stringify(components), /must-not-export|environment|metadata/);
    assert.throws(() => sbomComponents({}), /Invalid native/);
});

test('Proxmox native versions retain observed package versions without guessing CPEs', () => {
    assert.deepEqual(proxmoxVersions('pve-manager: 9.0.1 (running version: 9.0.1/example)\n\ninvalid\nqemu-server: 9.0.0\n'), [
        { name: 'pve-manager', version: '9.0.1' }, { name: 'qemu-server', version: '9.0.0' },
    ]);
});