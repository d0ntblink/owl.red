import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = path.join(os.homedir(), '.local/state/owl-red/software-inventory');
const digestReference = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;
const syftVersion = '1.56.0';
const syftBinary = path.join(os.homedir(), `.local/share/owl-red/tools/syft/${syftVersion}/syft`);

export function imageReference(observed, declared = '') {
    const actual = String(observed ?? '').replace(/^(docker-pullable|docker|containerd):\/\//, '');
    if (digestReference.test(actual)) return actual;
    if (/^sha256:[a-f0-9]{64}$/.test(actual) && digestReference.test(declared) && declared.endsWith(`@${actual}`)) return declared;
    return null;
}

export function kubernetesInventory(pods, nodes) {
    const deployments = [];
    for (const pod of pods.items ?? []) {
        const specification = [...(pod.spec?.containers ?? []), ...(pod.spec?.initContainers ?? []), ...(pod.spec?.ephemeralContainers ?? [])];
        const statuses = [...(pod.status?.containerStatuses ?? []), ...(pod.status?.initContainerStatuses ?? []), ...(pod.status?.ephemeralContainerStatuses ?? [])];
        for (const container of statuses.filter(item => item.state?.running)) {
            const declared = specification.find(item => item.name === container.name)?.image ?? '';
            deployments.push({
                assetId: `kubernetes:${pod.metadata.namespace}:${pod.metadata.name}:${container.name}`,
                kind: 'container', runtime: 'kubernetes', namespace: pod.metadata.namespace,
                workload: pod.metadata.name, container: container.name, node: pod.spec.nodeName,
                declaredImage: declared, runtimeImageId: container.imageID,
                scanReference: imageReference(container.imageID, declared),
                evidence: 'running-container-status',
            });
        }
    }
    const platforms = (nodes.items ?? []).map(node => {
        const info = node.status?.nodeInfo ?? {};
        return {
            assetId: `kubernetes-node:${node.metadata.name}`, kind: 'platform',
            name: node.metadata.name, os: info.osImage, kernel: info.kernelVersion,
            kubernetes: info.kubeletVersion, containerRuntime: info.containerRuntimeVersion,
            architecture: info.architecture, evidence: 'kubernetes-node-status',
            cpe: null, identityStatus: 'not-mapped',
        };
    });
    return { deployments, platforms };
}

export function dockerInventory(snapshot) {
    return snapshot.containers.map(container => ({
        assetId: `docker:nas:${container.name}`, kind: 'container', runtime: 'docker',
        workload: container.name, node: 'nas', declaredImage: container.declaredImage,
        runtimeImageId: container.imageId,
        scanReference: container.repoDigests.find(reference => digestReference.test(reference)) ?? null,
        evidence: 'running-container-image-inspection',
    }));
}

export function groupImages(deployments) {
    const images = new Map();
    for (const deployment of deployments) {
        if (!deployment.scanReference) continue;
        const identity = deployment.scanReference.split('@')[1];
        if (!images.has(identity)) images.set(identity, { digest: identity, reference: deployment.scanReference, assetIds: [] });
        images.get(identity).assetIds.push(deployment.assetId);
    }
    return [...images.values()].sort((left, right) => left.digest.localeCompare(right.digest));
}

export function sbomComponents(bom) {
    assert(Array.isArray(bom.artifacts), 'Invalid native Syft SBOM.');
    return bom.artifacts.map(component => ({
        name: component.name, version: component.version, ecosystem: component.type,
        purl: component.purl || null, discoveredBy: component.foundBy,
        cpes: (component.cpes ?? []).map(candidate => ({
            value: typeof candidate === 'string' ? candidate : candidate.cpe,
            source: typeof candidate === 'string' ? 'syft' : candidate.source,
            reviewStatus: 'unverified',
        })).filter(candidate => typeof candidate.value === 'string' && candidate.value.startsWith('cpe:2.3:')),
    }));
}

export function proxmoxVersions(output) {
    return output.split('\n').flatMap(line => {
        const match = line.match(/^([A-Za-z0-9+.-]+):\s+(\S+)/);
        return match ? [{ name: match[1], version: match[2] }] : [];
    });
}

function execute(command, args, input) {
    const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
    assert(result.status === 0, `Inventory command failed: ${path.basename(command)}; no raw response printed.`);
    return result.stdout;
}

function sshArguments(address, command) {
    return ['-T', '-i', path.join(os.homedir(), '.ssh/id_ed25519_owl_ansible'),
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
        `root@${address}`, command];
}

function readProxmox() {
    const projection = String.raw`import json,sys,yaml
inventory=yaml.safe_load(open(sys.argv[1]))
targets={}
def visit(node):
    for name,value in (node.get('hosts') or {}).items():
        if isinstance(value,dict) and value.get('platform')=='proxmox':
            targets[name]=value['ansible_host']
    for child in (node.get('children') or {}).values():
        visit(child)
visit(inventory['all'])
print(json.dumps(targets))`;
    const targets = JSON.parse(execute(path.join(repository, '.venv/bin/python'), ['-c', projection,
        path.join(repository, 'ansible/inventory/hosts.yml')]));
    return Object.entries(targets).map(([name, address]) => {
        assert(/^10\.0\.10\.\d{1,3}$/.test(address), 'Unexpected Proxmox inventory address.');
        const packages = proxmoxVersions(execute('ssh', sshArguments(address, 'pveversion --verbose')));
        assert(packages.some(component => component.name === 'pve-manager'), 'Proxmox version response missing.');
        return { assetId: `proxmox:${name}`, kind: 'platform', name, os: 'Proxmox VE', packages,
            evidence: 'native-pveversion', cpe: null, identityStatus: 'not-mapped' };
    });
}

function readNas() {
    const program = String.raw`<?php
set_exception_handler(function($error){fwrite(STDERR,"Read-only Docker inventory failed\n");exit(1);});
function readDocker($path){
    $curl=curl_init('http://localhost'.$path);
    curl_setopt_array($curl,[CURLOPT_UNIX_SOCKET_PATH=>'/var/run/docker.sock',CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>30]);
    $body=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_HTTP_CODE);curl_close($curl);
    if($status!==200)throw new Exception('Docker read failed');
    return json_decode($body,true,512,JSON_THROW_ON_ERROR);
}
$containers=[];
foreach(readDocker('/containers/json?all=0') as $summary){
    $container=readDocker('/containers/'.$summary['Id'].'/json');
    if(!($container['State']['Running']??false))continue;
    $image=readDocker('/images/'.$container['Image'].'/json');
    $containers[]=['name'=>ltrim($container['Name'],'/'),'declaredImage'=>$container['Config']['Image'],
        'imageId'=>$container['Image'],'repoDigests'=>$image['RepoDigests']??[]];
}
$version=readDocker('/version');
$unraid=parse_ini_file('/etc/unraid-version');
echo json_encode(['containers'=>$containers,'unraid'=>$unraid['version']??null,
    'dockerVersion'=>$version['Version'],'kernel'=>$version['KernelVersion']],JSON_THROW_ON_ERROR);
`;
    return JSON.parse(execute('ssh', sshArguments('10.0.10.5', 'php'), program));
}

export function collect() {
    const observedAt = new Date().toISOString();
    const pods = JSON.parse(execute('kubectl', ['get', 'pods', '--all-namespaces', '-o', 'json']));
    const nodes = JSON.parse(execute('kubectl', ['get', 'nodes', '-o', 'json']));
    const kubernetes = kubernetesInventory(pods, nodes);
    const nas = readNas();
    const deployments = [...kubernetes.deployments, ...dockerInventory(nas)];
    return {
        schemaVersion: 1, observedAt, scope: 'running-kubernetes-and-nas-containers-and-platforms',
        deployments, images: groupImages(deployments),
        platforms: [...kubernetes.platforms, ...readProxmox(), {
            assetId: 'host:nas', kind: 'platform', name: 'nas', os: 'Unraid', version: nas.unraid,
            kernel: nas.kernel, docker: nas.dockerVersion, evidence: 'native-version-and-docker-api',
            cpe: null, identityStatus: 'not-mapped',
        }],
        limitations: ['Image contents exclude runtime-installed packages and bind-mounted applications.',
            'No CPE is inferred from an image name, banner or hardware vendor.',
            'Appliances, endpoints and host package inventories are not covered by this initial collection.'],
    };
}

function writeReport(filename, report) {
    const temporary = `${filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, filename);
}

export function enrich(report, maximum = 8) {
    assert(Number.isInteger(maximum) && maximum >= 1 && maximum <= 64, 'SBOM batch size must be 1 through 64.');
    assert(fs.existsSync(syftBinary) && fs.statSync(syftBinary).isFile(), 'Install the pinned Syft binary using the inventory guide.');
    assert(execute(syftBinary, ['version', '-o', 'json']).includes(`"${syftVersion}"`), 'Unexpected Syft version.');
    const cache = path.join(stateDirectory, 'sboms', syftVersion);
    fs.mkdirSync(cache, { recursive: true, mode: 0o700 });
    const images = [];
    let attempted = 0;
    for (const image of report.images) {
        const native = path.join(cache, `${image.digest.slice(7)}.syft.json`);
        const failure = native.replace('.syft.json', '.failure.json');
        let outcome = 'cached';
        if (!fs.existsSync(native)) {
            if (fs.existsSync(failure) && Date.now() - Date.parse(JSON.parse(fs.readFileSync(failure, 'utf8')).attemptedAt) < 86400000) {
                images.push({ ...image, status: 'scan-failed', components: [] });
                continue;
            }
            if (attempted >= maximum) { images.push({ ...image, status: 'pending', components: [] }); continue; }
            const space = fs.statfsSync(stateDirectory);
            assert(space.bavail * space.bsize >= 10 * 1024 ** 3, 'Less than 10 GiB available; SBOM collection stopped.');
            attempted += 1;
            const temporary = fs.mkdtempSync(path.join(cache, '.scan-'));
            const result = spawnSync(syftBinary, ['scan', `registry:${image.reference}`, '--quiet',
                '--config', path.join(repository, 'ansible/vars/software-inventory-syft.yml'),
                '-o', `syft-json=${path.join(temporary, 'native.json')}`,
                '-o', `cyclonedx-json=${path.join(temporary, 'cyclonedx.json')}`], {
                encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
                env: { PATH: process.env.PATH, HOME: os.homedir(), GOMEMLIMIT: '1GiB',
                    SYFT_CACHE_DIR: path.join(stateDirectory, 'syft-cache'), TMPDIR: temporary },
            });
            try {
                if (result.status !== 0) {
                    writeReport(failure, { attemptedAt: new Date().toISOString(), reason: result.error?.code ?? 'native-scan-failed' });
                    fs.writeFileSync(native.replace('.syft.json', '.error.log'), result.stderr ?? '', { mode: 0o600 });
                    images.push({ ...image, status: 'scan-failed', components: [] });
                    continue;
                }
                sbomComponents(JSON.parse(fs.readFileSync(path.join(temporary, 'native.json'), 'utf8')));
                fs.renameSync(path.join(temporary, 'cyclonedx.json'), native.replace('.syft.json', '.cdx.json'));
                fs.renameSync(path.join(temporary, 'native.json'), native);
                fs.rmSync(failure, { force: true });
                outcome = 'scanned';
            } finally {
                fs.rmSync(temporary, { recursive: true, force: true });
            }
        }
        const bom = JSON.parse(fs.readFileSync(native, 'utf8'));
        images.push({ ...image, status: outcome, sbomGeneratedAt: fs.statSync(native).mtime.toISOString(), components: sbomComponents(bom) });
    }
    return { schemaVersion: 1, generatedAt: new Date().toISOString(), inventoryObservedAt: report.observedAt,
        generator: { name: 'syft', version: syftVersion }, platforms: report.platforms, images,
        scope: report.scope, limitations: [...report.limitations,
            'CPEs are native tool candidates, not approved NVD matches or confirmed vulnerabilities.',
            'Unidentified application binaries and runtime modifications may be missing from SBOMs.'] };
}

function main() {
    const argumentsList = process.argv.slice(2);
    const locked = argumentsList[0] === '--locked';
    if (locked) argumentsList.shift();
    assert(argumentsList.length === 1 && ['collect', 'refresh'].includes(argumentsList[0]), 'Use software-inventory.mjs collect or refresh.');
    const phase = argumentsList[0];
    process.umask(0o077);
    fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    if (!locked) {
        const result = spawnSync('flock', ['--nonblock', '--conflict-exit-code', '75',
            path.join(stateDirectory, 'refresh.lock'), process.execPath, fileURLToPath(import.meta.url), '--locked', phase], { stdio: 'inherit' });
        assert(!result.error, 'Cannot acquire native inventory lock.');
        process.exitCode = result.status ?? 1;
        return;
    }
    const report = collect();
    const filename = path.join(stateDirectory, 'inventory.json');
    writeReport(filename, report);
    if (phase === 'refresh') {
        const feed = enrich(report);
        writeReport(path.join(stateDirectory, 'feed-input.json'), feed);
        console.log(JSON.stringify({ sbomImages: feed.images.filter(image => ['cached', 'scanned'].includes(image.status)).length,
            pendingImages: feed.images.filter(image => image.status === 'pending').length,
            failedImages: feed.images.filter(image => image.status === 'scan-failed').length,
            components: feed.images.reduce((total, image) => total + image.components.length, 0) }));
    }
    writeReport(path.join(stateDirectory, 'last-attempt.json'), { status: 'complete', observedAt: report.observedAt });
    console.log(JSON.stringify({ observedAt: report.observedAt, containers: report.deployments.length,
        uniqueImages: report.images.length, platforms: report.platforms.length,
        unresolvedImages: report.deployments.filter(item => !item.scanReference).length, report: filename }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error) {
        if (fs.existsSync(stateDirectory)) writeReport(path.join(stateDirectory, 'last-attempt.json'), {
            status: 'failed', attemptedAt: new Date().toISOString(), previousReportMayBeStale: true });
        console.error(error instanceof assert.AssertionError ? error.message : 'Inventory failed; previous report retained.');
        process.exitCode = 1;
    }
}