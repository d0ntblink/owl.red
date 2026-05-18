#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ansible module: swos_set_port_names
Rename switch ports on a MikroTik SwOS switch in a single API round-trip.

Sends ONE GET (link.b) + ONE POST (link.b) to rename all specified ports,
regardless of how many ports are being renamed.  Idempotent: returns
changed=False if all names already match.

Works around the mikrotik-swos 1.3.2 CSS326 misdetection bug by forcing
platform_type to swos.  See notes/issues/002-swos-library-css326-misdetect.md.

Requirements:
  pip install mikrotik-swos  (tested with 1.3.2)

EXAMPLES:
  - name: Apply port names from switch_configs/css326.yml
    swos_set_port_names:
      host: 10.0.10.2
      username: admin
      password: ""
      port_names:
        1: "cp1.pve"
        2: "cp2.pve"
        17: "rtr-trunk"
    register: result
"""

from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: swos_set_port_names
short_description: Rename ports on a MikroTik SwOS switch (bulk, single API call)
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
  port_names:
    description: >
      Dict mapping 1-based port number (int or str) to desired port name (str).
      Ports not listed are left unchanged.
      Port names must be ≤15 characters (SwOS limit).
    required: true
    type: dict
  port:
    description: HTTP port for the SwOS web interface.
    required: false
    type: int
    default: 80
'''

RETURN = r'''
changed_ports:
  description: List of ports whose names were updated.
  type: list
  returned: always
  sample:
    - {port_number: 1, old_name: "Port1", new_name: "cp1.pve"}
already_correct:
  description: List of ports whose names already matched and were not changed.
  type: list
  returned: always
'''

from ansible.module_utils.basic import AnsibleModule

try:
    import swos.platform as _swos_platform
    from swos.platform import PlatformType, PlatformAdapter
    from swos.core import decode_hex_string, encode_hex_string, build_post_data
    HAS_SWOS = True
except ImportError:
    HAS_SWOS = False

MAX_PORT_NAME_LEN = 15


def _force_swos_platform():
    """
    Patch swos.platform.detect_platform to always return swos.
    See notes/issues/002-swos-library-css326-misdetect.md for root cause.
    """
    _swos_platform.detect_platform = lambda url, username, password: PlatformType.SWOS


def run_module():
    module_args = dict(
        host=dict(type='str', required=True),
        username=dict(type='str', required=True),
        password=dict(type='str', required=False, default='', no_log=True),
        port_names=dict(type='dict', required=True),
        port=dict(type='int', required=False, default=80),
    )

    result = dict(
        changed=False,
        changed_ports=[],
        already_correct=[],
    )

    module = AnsibleModule(argument_spec=module_args, supports_check_mode=True)

    if not HAS_SWOS:
        module.fail_json(msg="mikrotik-swos library is required. Run: pip install mikrotik-swos")

    host = module.params['host']
    username = module.params['username']
    password = module.params['password']
    http_port = module.params['port']
    desired = {int(k): v for k, v in module.params['port_names'].items()}

    # Validate name lengths
    for port_num, name in desired.items():
        if len(name) > MAX_PORT_NAME_LEN:
            module.fail_json(
                msg=f"Port {port_num} name '{name}' is {len(name)} chars; SwOS limit is {MAX_PORT_NAME_LEN}."
            )

    url = f"http://{host}" if http_port == 80 else f"http://{host}:{http_port}"

    _force_swos_platform()

    adapter = PlatformAdapter(url, username, password, platform_type=PlatformType.SWOS)
    fm = adapter.field_map

    # Single GET — fetch current link.b state
    try:
        data = adapter.get('link')
    except Exception as e:
        module.fail_json(msg=f"Failed to read link.b from {url}: {e}")

    names_field = fm.port_names
    current_names = data.get(names_field, [])
    num_ports = len(current_names)

    needs_update = False
    for port_num, new_name in desired.items():
        idx = port_num - 1
        if idx < 0 or idx >= num_ports:
            module.fail_json(msg=f"Port number {port_num} out of range (switch has {num_ports} ports).")
        current_name = decode_hex_string(current_names[idx])
        if current_name != new_name:
            result['changed_ports'].append({
                'port_number': port_num,
                'old_name': current_name,
                'new_name': new_name,
            })
            needs_update = True
        else:
            result['already_correct'].append({'port_number': port_num, 'name': new_name})

    if not needs_update:
        module.exit_json(**result)

    result['changed'] = True

    if module.check_mode:
        module.exit_json(**result)

    # Apply all name changes in memory
    for change in result['changed_ports']:
        idx = change['port_number'] - 1
        data[names_field][idx] = encode_hex_string(change['new_name'])

    # Single POST — send updated link.b state back
    writable_data = {
        fm.port_enabled:      data[fm.port_enabled],
        fm.port_names:        data[fm.port_names],
        fm.port_auto_neg:     data[fm.port_auto_neg],
        fm.port_speed:        data[fm.port_speed],
        fm.port_duplex_config: data[fm.port_duplex_config],
        fm.port_flow_tx:      data[fm.port_flow_tx],
        fm.port_flow_rx:      data[fm.port_flow_rx],
    }

    try:
        post_data = build_post_data(writable_data)
        adapter.post('link', post_data)
    except Exception as e:
        module.fail_json(msg=f"Failed to POST updated port names to {url}: {e}")

    module.exit_json(**result)


def main():
    run_module()


if __name__ == '__main__':
    main()
