import base64
import json
import re
import select
import shlex
import socket
import subprocess
import sys
import time
import zlib


GUEST_INSTALLER = r'''
import base64
import getpass
import importlib.util
import json
from pathlib import Path
import zlib
from vyos.configtree import ConfigTree, extract_version

parts = []
while True:
    part = getpass.getpass('OWL_INSTALL_INPUT:')
    if part == 'OWL_INSTALL_END':
        break
    if len(part) > 3000:
        raise RuntimeError('Oversized installer frame')
    parts.append(part)
payload = json.loads(zlib.decompress(base64.b64decode(''.join(parts))))
spec = importlib.util.spec_from_file_location('native_installer', '/usr/libexec/vyos/op_mode/image_installer.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
if not installer.image.is_live_boot():
    raise RuntimeError('Refusing to reinstall a disk-booted system')
if installer.image.get_running_image() != payload['release']:
    raise RuntimeError('Unexpected running image')
disks = installer.find_disks()
if len(disks) != 1:
    raise RuntimeError('Expected exactly one guest disk')
target, size = next(iter(disks.items()))
if Path(target).name != 'sda' or size != 64 * 1024**3:
    raise RuntimeError('Unexpected lab disk identity or size')
if installer.disk.partition_list(target):
    raise RuntimeError('Refusing to erase a disk with existing partitions')
default_config = Path('/opt/vyatta/etc/config.boot.default').read_text()
metadata = extract_version(default_config)[1]
if 'vyos-config-version' not in metadata:
    raise RuntimeError('Native configuration version metadata is missing')
candidate = ConfigTree(payload['candidate'] + '\n' + metadata).to_string()
candidate_file = Path('/run/owl-vyos-lab.config')
candidate_file.write_text(candidate)
candidate_file.chmod(0o600)

def answer_input(prompt, *arguments, **options):
    if prompt == installer.MSG_INPUT_IMAGE_NAME:
        return payload['release']
    if prompt in (installer.MSG_INPUT_PASSWORD, installer.MSG_INPUT_PASSWORD_CONFIRM):
        return payload['password']
    if prompt == installer.MSG_INPUT_CONSOLE_TYPE:
        return 'S'
    if prompt == installer.MSG_INFO_INSTALL_DISK_SELECT:
        return target
    raise RuntimeError('Unexpected installer input; stopped')

def answer_confirmation(prompt, *arguments, **options):
    allowed = ('Would you like to continue?', installer.MSG_INFO_INSTALL_DISK_CONFIRM, installer.MSG_INPUT_ROOT_SIZE_ALL)
    if prompt not in allowed:
        raise RuntimeError('Unexpected installer confirmation; stopped')
    return True

def select_config(entries, title, prompt, *arguments, **options):
    if prompt != installer.MSG_INPUT_CONFIG_CHOOSE or '/opt/vyatta/etc/config.boot.default' not in entries:
        raise RuntimeError('Unexpected installer selection; stopped')
    return str(candidate_file)

native_serial_setup = installer.configure_serial_console
def configure_serial_and_guard(config_file, console_type):
    native_serial_setup(config_file, console_type)
    scripts = Path(config_file).parent / 'scripts'
    scripts.mkdir(exist_ok=True)
    for name, content in payload.get('boot_scripts', {}).items():
        if name not in ('vyos-preconfig-bootup.script', 'vyos-postconfig-bootup.script'):
            raise RuntimeError('Unexpected boot script')
        filename = scripts / name
        filename.write_text(content)
        filename.chmod(0o700)

installer.ask_input = answer_input
installer.ask_yes_no = answer_confirmation
installer.select_entry = select_config
installer.configure_serial_console = configure_serial_and_guard
try:
    installer.install_image()
except SystemExit as completed:
    if completed.code not in (None, 0):
        raise
print('OWL_INSTALL_COMPLETE', flush=True)
'''


def read_until(connection, pattern, timeout):
    deadline = time.monotonic() + timeout
    output = b''
    expression = re.compile(pattern)
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        ready, _, _ = select.select([connection], [], [], max(remaining, 0))
        if not ready:
            break
        chunk = connection.recv(8192)
        if not chunk:
            raise RuntimeError('Lab serial connection closed')
        output += chunk
        if expression.search(output):
            return output
        if len(output) > 2 * 1024 * 1024:
            raise RuntimeError('Unexpectedly large installer response')
    raise RuntimeError('Lab installer response timed out; inspect state before retrying')


def main():
    transport = json.load(sys.stdin)
    password = transport.get('password', '')
    if len(password) < 32:
        raise RuntimeError('Verified vault password is required')
    vm_id = int(transport.get('vm_id', 102))
    if vm_id not in (102, 103):
        raise RuntimeError('Only the two isolated router preparation VMs are allowed')
    configuration = json.loads(subprocess.check_output([
        'pvesh', 'get', f'/nodes/edge/qemu/{vm_id}/config', '--output-format', 'json'
    ]))
    lab_network = ' '.join([
        '-netdev hubport,id=owl_lab_wan,hubid=0',
        '-device virtio-net-pci,netdev=owl_lab_wan,mac=02:76:79:00:00:01,id=owl_lab_wan_nic',
        '-netdev user,id=owl_lab_lan,restrict=on,net=192.0.2.0/24,host=192.0.2.254,dhcpstart=192.0.2.250,hostfwd=tcp:127.0.0.1:22102-192.0.2.1:22',
        '-device virtio-net-pci,netdev=owl_lab_lan,mac=02:76:79:00:00:02,id=owl_lab_lan_nic',
    ])
    production_network = ' '.join([
        '-netdev hubport,id=owl_stage_wan,hubid=0',
        '-device virtio-net-pci,netdev=owl_stage_wan,mac=e0:d4:e8:ef:2b:f2,id=owl_stage_wan_nic',
        '-netdev user,id=owl_stage_lan,restrict=on,net=10.0.10.0/24,host=10.0.10.254,dhcpstart=10.0.10.250,hostfwd=tcp:127.0.0.1:22103-10.0.10.1:22',
        '-device virtio-net-pci,netdev=owl_stage_lan,mac=6c:fe:54:70:08:31,id=owl_stage_lan_nic',
    ])
    expected_name, expected_network = ('edge-lab.owl.red', lab_network) if vm_id == 102 else ('edge-next.owl.red', production_network)
    if configuration.get('name') != expected_name or configuration.get('args') != expected_network:
        raise RuntimeError('Unexpected router VM identity or isolated network attachment')
    if any(re.fullmatch(r'(hostpci|net|usb)\d+', key) for key in configuration):
        raise RuntimeError('Refusing a lab with host or production network devices')
    if not configuration.get('sata0', '').startswith(f'local-lvm:vm-{vm_id}-disk-'):
        raise RuntimeError('Unexpected lab storage ownership')
    payload = {
        'password': password,
        'release': transport['release'],
        'candidate': transport['candidate'],
        'boot_scripts': transport.get('boot_scripts', {}),
    }
    encoded_payload = base64.b64encode(zlib.compress(json.dumps(payload).encode()))
    if len(encoded_payload) > 65536:
        raise RuntimeError('Installer input exceeds the total transport limit')
    program = base64.b64encode(GUEST_INSTALLER.encode()).decode()
    command = f"sudo -n python3 -c {shlex.quote('import base64; exec(base64.b64decode(' + repr(program) + '))')}\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.connect(f'/run/qemu-server/{vm_id}.serial0')
        connection.sendall(b'\r')
        read_until(connection, rb'login:\s*$', 30)
        connection.sendall(b'vyos\r')
        read_until(connection, rb'Password:\s*$', 15)
        connection.sendall(b'vyos\r')
        read_until(connection, rb'vyos@[^\r\n]*[\$#]\s*$', 30)
        connection.sendall(command.encode())
        read_until(connection, rb'OWL_INSTALL_INPUT:', 30)
        for offset in range(0, len(encoded_payload), 3000):
            connection.sendall(encoded_payload[offset:offset + 3000] + b'\n')
            read_until(connection, rb'OWL_INSTALL_INPUT:', 30)
        connection.sendall(b'OWL_INSTALL_END\n')
        read_until(connection, rb'OWL_INSTALL_COMPLETE', 300)
        connection.sendall(b'exit\r')
    print(json.dumps({'vm_id': vm_id, 'installed': True, 'password_source': 'verified-vault-reference', 'cold_boot_required': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'installed': False, 'reason': str(error)}))
        raise SystemExit(1)