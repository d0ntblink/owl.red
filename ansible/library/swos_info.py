#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ansible module: swos_info
Gather facts from a MikroTik SwOS switch via HTTP API.

Works around a known bug in mikrotik-swos 1.3.2 where CSS-series switches
running full SwOS (not SwOS Lite) are incorrectly detected as 'swos-lite'.
The 'ivl' field in CSS326 sys.b responses is 3 characters starting with 'i',
which triggers the SwOS Lite heuristic. Platform is forced to 'swos'.

Requirements:
  pip install mikrotik-swos  (tested with 1.3.2)

EXAMPLES:
  - name: Gather CSS326 switch facts
    swos_info:
      host: 10.0.10.2
      username: admin
      password: ""
    register: switch_facts
"""

from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: swos_info
short_description: Gather facts from a MikroTik SwOS switch
description:
  - Connects to a SwOS switch via HTTP Digest auth and returns system info,
    port link states, and SNMP configuration.
  - Works around mikrotik-swos 1.3.2 platform misdetection for CSS-series
    switches by forcing platform_type to swos.
options:
  host:
    description: Switch IP address or hostname.
    required: true
    type: str
  username:
    description: SwOS username.
    required: true
    type: str
  password:
    description: SwOS password.
    required: false
    type: str
    default: ""
  port:
    description: HTTP port for the SwOS web interface.
    required: false
    type: int
    default: 80
'''

RETURN = r'''
system:
  description: Switch system information.
  type: dict
  returned: always
  sample:
    model: "CSS326-24G-2S+"
    identity: "switch.owl.red"
    version: "2.18"
    mac_address: "48:8f:5a:0c:d1:82"
    serial_number: "CAC90C5B5282"
    uptime: 68299573
    current_ip: "10.0.10.2"
ports:
  description: List of port states (one entry per physical port).
  type: list
  returned: always
  sample:
    - port_number: 1
      port_name: "Port1"
      link_up: true
      enabled: true
      speed: "100M"
      full_duplex: true
snmp:
  description: SNMP configuration.
  type: dict
  returned: always
  sample:
    enabled: false
    community: "public"
    contact: ""
    location: ""
platform_detected: "swos"
'''

from ansible.module_utils.basic import AnsibleModule

try:
    import swos.platform as _swos_platform
    from swos.platform import PlatformType
    HAS_SWOS = True
except ImportError:
    HAS_SWOS = False


def _force_swos_platform():
    """
    Monkey-patch swos.platform.detect_platform to always return PlatformType.SWOS.

    This works around mikrotik-swos 1.3.2 bug: the CSS326 SwOS response contains
    'ivl' (interval config field), which is 3 chars starting with 'i', falsely
    triggering the SwOS Lite hex-field heuristic. The CSS326 model name starting
    with 'CSS' then causes Method 2 to return swos-lite. We bypass detection
    entirely and force swos since CSS326 runs full SwOS 2.x.
    """
    _swos_platform.detect_platform = lambda url, username, password: PlatformType.SWOS


def run_module():
    module_args = dict(
        host=dict(type='str', required=True),
        username=dict(type='str', required=True),
        password=dict(type='str', required=False, default='', no_log=True),
        port=dict(type='int', required=False, default=80),
    )

    result = dict(changed=False, system={}, ports=[], snmp={}, platform_detected='swos')

    module = AnsibleModule(argument_spec=module_args, supports_check_mode=True)

    if not HAS_SWOS:
        module.fail_json(msg="mikrotik-swos library is required. Run: pip install mikrotik-swos")

    host = module.params['host']
    username = module.params['username']
    password = module.params['password']
    port = module.params['port']

    url = f"http://{host}" if port == 80 else f"http://{host}:{port}"

    # Apply platform override before any library calls
    _force_swos_platform()

    # Import after patching to ensure the module-level cache is clean
    from swos import get_system_info, get_links, get_snmp

    try:
        sys_info = get_system_info(url, username, password)
    except Exception as e:
        module.fail_json(msg=f"Failed to get system info from {url}: {e}")

    result['system'] = {
        'model':         sys_info.get('model', ''),
        'identity':      sys_info.get('identity', ''),
        'version':       sys_info.get('version', ''),
        'mac_address':   sys_info.get('mac_address', ''),
        'serial_number': sys_info.get('serial_number', ''),
        'uptime':        sys_info.get('uptime', 0),
        'current_ip':    sys_info.get('current_ip', ''),
        'static_ip':     sys_info.get('static_ip', ''),
        'address_acquisition': sys_info.get('address_acquisition', ''),
    }

    try:
        links = get_links(url, username, password)
        ports = []
        for i, link in enumerate(links):
            ports.append({
                'port_number': i + 1,
                'port_name':   link.get('port_name', f'Port{i + 1}'),
                'link_up':     link.get('link_up', False),
                'enabled':     link.get('enabled', False),
                'speed':       link.get('speed', ''),
                'full_duplex': link.get('full_duplex', False),
            })
        result['ports'] = ports
    except Exception as e:
        # Non-fatal — return empty ports rather than failing
        result['ports'] = []
        result['ports_error'] = str(e)

    try:
        snmp = get_snmp(url, username, password)
        result['snmp'] = {
            'enabled':   snmp.get('enabled', False),
            'community': snmp.get('community', ''),
            'contact':   snmp.get('contact', ''),
            'location':  snmp.get('location', ''),
        }
    except Exception as e:
        result['snmp'] = {}
        result['snmp_error'] = str(e)

    module.exit_json(**result)


def main():
    run_module()


if __name__ == '__main__':
    main()
