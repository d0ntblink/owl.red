import argparse
import datetime
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request


def select_leases(payload, scope, subnet, now):
    if payload.get('status') != 'ok':
        raise ValueError('Lease API did not report success')
    leases = payload.get('response', {}).get('leases')
    if not isinstance(leases, list) or len(leases) > 4096:
        raise ValueError('Invalid lease list')
    network = ipaddress.IPv4Network(subnet)
    selected = {}
    addresses = set()
    for lease in leases:
        if lease.get('scope') != scope:
            continue
        if lease.get('type') not in ('Dynamic', 'Reserved'):
            raise ValueError('Unsupported guest lease type')
        address = ipaddress.IPv4Address(lease['address'])
        if address not in network or address in (network.network_address, network.broadcast_address):
            raise ValueError('Guest lease outside its subnet')
        mac = lease['hardwareAddress'].replace('-', ':').lower()
        if not re.fullmatch(r'(?:[0-9a-f]{2}:){5}[0-9a-f]{2}', mac) or int(mac[:2], 16) & 1 or mac == '00:00:00:00:00:00':
            raise ValueError('Invalid unicast client identity')
        expires = datetime.datetime.fromisoformat(lease['leaseExpires'].replace('Z', '+00:00'))
        if expires.tzinfo is None:
            raise ValueError('Lease expiry must include a timezone')
        expiry = int(expires.timestamp())
        if expiry <= now:
            continue
        if mac in selected or str(address) in addresses:
            raise ValueError('Conflicting guest lease identity')
        selected[mac] = (str(address), expiry)
        addresses.add(str(address))
    return sorted((address, mac, expiry) for mac, (address, expiry) in selected.items())


def publish(leases, output, freshness_seconds, now):
    commands = [{'flush': {'set': {'family': 'inet', 'table': 'owl_portal_guard', 'name': 'technitium_leases'}}}]
    if leases:
        commands.append({'add': {'element': {
            'family': 'inet', 'table': 'owl_portal_guard', 'name': 'technitium_leases',
            'elem': [{'elem': {'val': address, 'timeout': min(freshness_seconds, expiry - now)}} for address, mac, expiry in leases],
        }}})
    subprocess.run(['nft', '-j', '-f', '-'], input=json.dumps({'nftables': commands}), text=True, capture_output=True, check=True, timeout=5)
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.leases-', dir=output.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(''.join(f'{expiry} {mac} {address} * *\n' for address, mac, expiry in leases))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scope', default='vlan30-guest-net')
    parser.add_argument('--subnet', default='10.0.30.0/24')
    parser.add_argument('--api-url')
    parser.add_argument('--token-file', type=Path)
    parser.add_argument('--stdin', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('/var/lib/opennds/technitium.leases'))
    parser.add_argument('--freshness-seconds', type=int, default=30)
    arguments = parser.parse_args()
    if not 5 <= arguments.freshness_seconds <= 60:
        parser.error('Freshness must be between 5 and 60 seconds')
    try:
        if arguments.stdin:
            payload = json.load(sys.stdin)
        else:
            endpoint = urllib.parse.urlsplit(arguments.api_url or '')
            if endpoint.path != '/api/dhcp/leases/list' or endpoint.query or endpoint.username or endpoint.fragment:
                raise ValueError('Use only the native read-only lease endpoint')
            if endpoint.scheme != 'https' and not (endpoint.scheme == 'http' and endpoint.hostname in ('127.0.0.1', '::1', 'localhost')):
                raise ValueError('Remote API requires verified HTTPS')
            if arguments.token_file is None or arguments.token_file.stat().st_mode & 0o077:
                raise ValueError('A private token file is required')
            token = arguments.token_file.read_text().strip()
            if not token:
                raise ValueError('Empty API token')
            request = urllib.request.Request(arguments.api_url, data=urllib.parse.urlencode({'token': token}).encode())
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read(2 * 1024 * 1024))
        now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
        leases = select_leases(payload, arguments.scope, arguments.subnet, now)
        if not arguments.check_only:
            publish(leases, arguments.output, arguments.freshness_seconds, now)
        print(json.dumps({'scope': arguments.scope, 'activeGuestLeases': len(leases), 'checkOnly': arguments.check_only}))
    except Exception:
        if not arguments.check_only:
            try:
                publish([], arguments.output, arguments.freshness_seconds, 0)
            except Exception:
                pass
        print('Lease synchronization failed; credentials and lease identities withheld. Freshness must expire closed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())