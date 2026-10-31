import html.parser
import http.client
import http.cookiejar
import ipaddress
import json
import os
from pathlib import Path
import selectors
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


NAMESPACE = 'owl-guest-accept'
CLIENT_MAC = '02:6f:77:30:04:04'


def run(arguments, **options):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=20, **options)


def require(arguments):
    result = run(arguments)
    if result.returncode != 0:
        raise RuntimeError('Native acceptance operation failed: ' + arguments[0])
    return result.stdout


def tcp_reachable(address, port):
    try:
        with socket.create_connection((address, port), timeout=2):
            return True
    except OSError:
        return False


def wait_for_native_auth(client_mac, started, deadline):
    observer = subprocess.Popen(['inotifywait', '-m', '-e', 'modify,create,moved_to', '--format', '%f', '/tmp/ndslog'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    try:
        selector.register(observer.stdout, selectors.EVENT_READ)
        while time.monotonic() < deadline:
            log = Path('/tmp/ndslog/binauthlog.log')
            for line in log.read_text().splitlines() if log.exists() else []:
                fields = dict(part.split('=', 1) for part in line.split(', ') if '=' in part)
                if fields.get('clientmac') == client_mac and fields.get('method') == 'ndsctl_auth' and int(fields.get('session_start', '0')) >= started:
                    return
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            os.read(observer.stdout.fileno(), 65536)
        raise RuntimeError('Native Authmon did not confirm the production client')
    finally:
        selector.close()
        observer.terminate()
        observer.communicate(timeout=5)


def client_acceptance(directory):
    address = (directory / 'lease').read_text().splitlines()[0]
    ipaddress.IPv4Address(address)
    shield_cast_expected = os.environ.get('OWL_SHIELD_CAST_EXPECTED') == '1'
    if shield_cast_expected:
        import dns.resolver

        mdns = dns.resolver.Resolver(configure=False)
        mdns.nameservers = ['10.0.30.1']
        mdns.port = 5353
        mdns.timeout = 2
        mdns.lifetime = 2
        instance = 'SHIELD-Android-TV-48ca569af8f5ca9a97a5cac5a1dd6b35._googlecast._tcp.local.'
        host = '48ca569a-f8f5-ca9a-97a5-cac5a1dd6b35.local.'
        assert [record.target.canonicalize().to_text() for record in mdns.resolve('_services._dns-sd._udp.local.', 'PTR')] == ['_googlecast._tcp.local.'], 'Unexpected guest discovery services'
        assert [record.target.canonicalize().to_text() for record in mdns.resolve('_googlecast._tcp.local.', 'PTR')] == [instance.lower()], 'Unexpected Cast receiver inventory'
        service = mdns.resolve(instance, 'SRV')
        assert len(service) == 1 and service[0].priority == 0 and service[0].weight == 0 and service[0].port == 8009 and service[0].target.canonicalize().to_text() == host, 'Unexpected Shield control endpoint'
        assert [record.address for record in mdns.resolve(host, 'A')] == ['10.0.20.100'], 'Unexpected Shield address'
        assert not tcp_reachable('10.0.20.100', 8009), 'Unauthenticated Shield control is open'
    answer = require(['dig', '+short', '+time=3', '+tries=1', '@10.0.30.30', 'example.com', 'A'])
    server = next(line for line in answer.splitlines() if line and line[0].isdigit())
    ipaddress.IPv4Address(server)
    request = ['curl', '--noproxy', '*', '-fsS', '--connect-timeout', '2', '--max-time', '4', '--resolve', 'example.com:443:' + server, 'https://example.com/', '-o', '/dev/null']
    assert run(request).returncode != 0, 'Unauthenticated internet access is open'
    discovery = require(['curl', '--noproxy', '*', '-sS', '--max-time', '8', '--resolve', 'example.com:80:' + server, '-D', '-', '-o', '/dev/null', 'http://example.com/'])
    location = next(line.split(':', 1)[1].strip() for line in discovery.splitlines() if line.lower().startswith('location:'))
    target = urllib.parse.urlsplit(location)
    assert target.scheme == 'https' and target.hostname == 'guest.owl.red' and target.port in (None, 443)
    journal = require(['journalctl', '-u', 'opennds', '-b', '-g', 'nat_traversal_poll_interval', '-o', 'json', '--no-pager'])
    entered = int(require(['systemctl', 'show', 'opennds', '-p', 'ActiveEnterTimestampMonotonic', '--value']).strip())
    assert any(int(event.get('__MONOTONIC_TIMESTAMP', '0')) >= entered and 'nat_traversal_poll_interval' in event.get('MESSAGE', '') for event in map(json.loads, journal.splitlines())), 'Authmon startup clearing is not complete'
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    class Offer(html.parser.HTMLParser):
        value = None

        def handle_starttag(self, tag, attributes):
            fields = dict(attributes)
            if tag == 'input' and fields.get('name') == 'offer':
                self.value = fields.get('value')
    parser = Offer()
    with opener.open(location, timeout=15) as response:
        parser.feed(response.read().decode())
    assert parser.value, 'Production HTTPS handoff did not produce a signed offer'
    started = int(time.time())
    consent = urllib.request.Request('https://guest.owl.red/', data=urllib.parse.urlencode({'offer': parser.value, 'consent': 'yes'}).encode(), headers={'Origin': 'https://guest.owl.red'})
    with opener.open(consent, timeout=15) as response:
        assert response.status == 200
    wait_for_native_auth(CLIENT_MAC, started, time.monotonic() + 25)
    assert run(request).returncode == 0, 'Consented production client has no internet access'
    if shield_cast_expected:
        assert tcp_reachable('10.0.20.100', 8009), 'Consented client cannot reach Shield control'
        for port in [22, 5555, 8008]:
            assert not tcp_reachable('10.0.20.100', port), 'Unapproved Shield service is reachable'
    for destination in ['10.0.10.1', '10.0.20.1', '10.0.40.1', '10.0.50.1']:
        assert run(['curl', '--noproxy', '*', '-ksS', '--connect-timeout', '1', '--max-time', '2', 'https://' + destination + '/', '-o', '/dev/null']).returncode != 0, 'Guest reached a private gateway'
    administration = run(['curl', '--noproxy', '*', '-sS', '--max-time', '5', '--resolve', 'dns.owl.red:443:10.0.10.201', '-o', '/dev/null', '-w', '%{http_code}', 'https://dns.owl.red/'])
    assert administration.stdout == '403', 'Shared ingress exposes an administrative hostname to guests'
    context = ssl.create_default_context()
    payload = b'GET / HTTP/1.1\r\nHost: example.com\r\nConnection: keep-alive\r\n\r\n'
    with socket.create_connection((server, 443), timeout=5) as transport:
        with context.wrap_socket(transport, server_hostname='example.com') as connection:
            connection.settimeout(3)
            connection.sendall(payload)
            response = http.client.HTTPResponse(connection)
            response.begin()
            assert response.status == 200 and not response.will_close
            response.read()
            (directory / 'deauth-issued').touch(exist_ok=False)
            deauth = require(['ndsctl', 'deauth', address])
            assert 'deauthenticated.' in deauth
            try:
                connection.sendall(payload)
                leaked = bool(connection.recv(1))
            except (TimeoutError, ConnectionError, ssl.SSLError):
                leaked = False
            assert not leaked, 'Revoked production TLS connection still passes application data'
    assert run(request).returncode != 0, 'Revoked production client regained internet access'
    if shield_cast_expected:
        assert not tcp_reachable('10.0.20.100', 8009), 'Revoked client retained Shield control access'
    require(['ip', '-6', 'address', 'add', 'fdca:30::2/64', 'dev', 'owl-accept-nic', 'nodad'])
    require(['ip', '-6', 'route', 'add', 'default', 'via', 'fdca:30::1'])
    require(['ip', '-6', 'neigh', 'replace', 'fdca:30::1', 'lladdr', '02:6f:77:30:03:04', 'nud', 'permanent', 'dev', 'owl-accept-nic'])
    assert run(['ping', '-6', '-c', '1', '-W', '2', '2606:4700:4700::1111']).returncode != 0
    print('PRODUCTION_GUEST_DHCP_HTTPS_CONSENT_REVOKE_PRIVATE_IPV6_PASS')
    if shield_cast_expected:
        print('PRODUCTION_GUEST_SHIELD_DISCOVERY_CONSENT_REVOKE_ISOLATION_PASS')


def main():
    if len(sys.argv) == 3 and sys.argv[1] == '--client':
        client_acceptance(Path(sys.argv[2]))
        return
    assert not Path('/run/netns/' + NAMESPACE).exists(), 'Refusing an existing test namespace'
    assert '10.0.30.1/24' in require(['ip', '-4', 'address', 'show', 'dev', 'br-guest'])
    assert require(['systemctl', 'is-active', 'opennds']).strip() == 'active'
    directory = Path(tempfile.mkdtemp(prefix='owl-guest-production-', dir='/var/tmp'))
    directory.chmod(0o700)
    resolver = Path('/etc/netns') / NAMESPACE
    assert not resolver.exists(), 'Refusing an existing namespace resolver'
    dhcp = None
    try:
        require(['ip', 'netns', 'add', NAMESPACE])
        require(['ip', 'link', 'add', 'owl-accept-peer', 'type', 'veth', 'peer', 'name', 'owl-accept-nic'])
        require(['ip', 'link', 'set', 'owl-accept-peer', 'master', 'br-guest'])
        require(['ip', 'link', 'set', 'owl-accept-peer', 'up'])
        require(['ip', 'link', 'set', 'owl-accept-nic', 'netns', NAMESPACE])
        for arguments in [['ip', 'link', 'set', 'lo', 'up'], ['ip', 'link', 'set', 'owl-accept-nic', 'address', CLIENT_MAC], ['ip', 'link', 'set', 'owl-accept-nic', 'up']]:
            require(['ip', 'netns', 'exec', NAMESPACE, *arguments])
        resolver.mkdir(mode=0o700, parents=True)
        (resolver / 'resolv.conf').write_text('nameserver 10.0.30.30\noptions timeout:2 attempts:1\n')
        callback = directory / 'dhcp-script'
        callback.write_text('#!/bin/sh\nset -eu\ncase "$1" in\n bound|renew)\n test "$interface" = owl-accept-nic\n test "$subnet" = 255.255.255.0\n test "$router" = 10.0.30.1\n test "$dns" = 10.0.30.30\n ip address replace "$ip/24" dev "$interface"\n ip route replace default via "$router" dev "$interface"\n printf "%s\\n" "$ip" > "$OWL_LEASE_FILE"\n ;;\nesac\n')
        callback.chmod(0o700)
        dhcp = subprocess.Popen(['ip', 'netns', 'exec', NAMESPACE, 'udhcpc', '-f', '-n', '-R', '-t', '4', '-T', '2', '-i', 'owl-accept-nic', '-s', str(callback)], env={**os.environ, 'OWL_LEASE_FILE': str(directory / 'lease')}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        selector = selectors.DefaultSelector()
        try:
            selector.register(dhcp.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + 20
            while not (directory / 'lease').exists() and time.monotonic() < deadline:
                if not selector.select(max(0, deadline - time.monotonic())):
                    break
                output = os.read(dhcp.stdout.fileno(), 65536)
                with (directory / 'dhcp.log').open('ab') as log:
                    log.write(output)
                if dhcp.poll() is not None:
                    break
            assert (directory / 'lease').exists(), 'No genuine production Technitium DHCP lease'
        finally:
            selector.close()
        require(['systemctl', 'start', 'owl-portal-leases.service'])
        address = (directory / 'lease').read_text().strip()
        assert any(line.split()[1:3] == [CLIENT_MAC, address] for line in Path('/var/lib/opennds/technitium.leases').read_text().splitlines()), 'Genuine lease not exported to the native gateway'
        result = subprocess.run(['ip', 'netns', 'exec', NAMESPACE, 'python3', str(Path(__file__).resolve()), '--client', str(directory)], capture_output=True, text=True, timeout=100)
        (directory / 'client.log').write_text(result.stdout + result.stderr)
        assert result.returncode == 0, 'Production client acceptance failed; private diagnostics: ' + str(directory)
        print(result.stdout.strip())
    finally:
        if (directory / 'lease').exists() and not (directory / 'deauth-issued').exists():
            (directory / 'deauth-issued').touch(exist_ok=False)
            run(['ndsctl', 'deauth', (directory / 'lease').read_text().strip()])
        if dhcp is not None:
            dhcp.terminate()
            dhcp.communicate(timeout=5)
        run(['ip', 'netns', 'del', NAMESPACE])
        run(['ip', 'link', 'del', 'owl-accept-peer'])
        if resolver.exists():
            (resolver / 'resolv.conf').unlink(missing_ok=True)
            resolver.rmdir()


if __name__ == '__main__':
    main()