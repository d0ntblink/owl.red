#!/usr/bin/python3
"""Apply one guarded VLAN membership change while retaining the native LAN."""

import copy
import json
import os
from pathlib import Path

from ansible.module_utils.basic import AnsibleModule
import requests
import swos.platform as swos_platform
from swos.platform import PlatformType
from swos import get_links, get_port_vlans, get_system_info, get_vlans, set_vlans


def desired_table(table, members):
    if members != [2, 25]:
        raise ValueError("Only the reviewed cp1/router VLAN-20 membership is allowed")
    result = copy.deepcopy(table)
    matches = [entry for entry in result if entry["vlan_id"] == 20]
    if len(matches) != 1 or sorted(matches[0]["member_ports"]) not in ([5], members):
        raise ValueError("Unexpected existing VLAN-20 membership; refusing overwrite")
    matches[0]["member_ports"] = members
    matches[0]["learning"] = True
    return result


def snapshot(args):
    system = get_system_info(*args)
    if system["serial_number"] != "CAC90C5B5282" or system["version"] != "2.18":
        raise ValueError("Unexpected switch serial or firmware")
    ports = get_links(*args)
    port_vlans = get_port_vlans(*args)
    if len(ports) != 26 or len(port_vlans) != 26:
        raise ValueError("Incomplete physical port response")
    for port_number, name in [(2, "cp1.pve"), (22, "cab-trunk"), (25, "sfp1-vyos")]:
        port = ports[port_number - 1]
        vlan = port_vlans[port_number - 1]
        if port["port_name"] != name or not port["enabled"] or not port["link_up"]:
            raise ValueError("A required physical pilot/operator port is not ready")
        if vlan["vlan_mode"] != "Optional" or vlan["default_vlan_id"] != 1:
            raise ValueError("Native management port assumptions changed")
        if vlan["vlan_receive"] != "Any" or vlan["force_vlan_id"]:
            raise ValueError("Unexpected native VLAN receive/force settings")
    return {
        "system": {key: system[key] for key in ["identity", "current_ip", "static_ip", "address_acquisition"]},
        "ports": [{key: port[key] for key in ["port_number", "port_name", "enabled", "auto_negotiation"]} for port in ports],
        "port_vlans": port_vlans,
        "vlans": get_vlans(*args),
    }


def main():
    module = AnsibleModule(
        argument_spec={
            "host": {"type": "str", "required": True},
            "username": {"type": "str", "default": "admin"},
            "password": {"type": "str", "required": True, "no_log": True},
            "phase": {"type": "str", "choices": ["prepare", "apply", "rollback"], "required": True},
            "members": {"type": "list", "elements": "int", "required": True},
            "recovery_directory": {"type": "path", "required": True},
        },
        supports_check_mode=True,
    )
    params = module.params
    directory = Path(params["recovery_directory"]).resolve()
    root = Path.home() / ".local/state/owl-red"
    if params["host"] != "10.0.10.2" or params["username"] != "admin" or not params["password"]:
        module.fail_json(msg="Only the authenticated existing switch endpoint is allowed")
    if directory.parent != root or not directory.name.startswith("vlan20-wired-") or not directory.is_dir():
        module.fail_json(msg="An existing private pilot recovery directory is required")
    swos_platform.detect_platform = lambda *args: PlatformType.SWOS
    args = ("http://10.0.10.2", params["username"], params["password"])
    filename = directory / "switch-before.json"
    try:
        current = snapshot(args)
        if params["phase"] == "prepare":
            desired_table(current["vlans"], params["members"])
            if filename.exists():
                if json.loads(filename.read_text()) != current:
                    raise ValueError("Existing recovery snapshot differs; use a fresh pilot directory")
            elif not module.check_mode:
                descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "w") as output:
                    json.dump(current, output, indent=2)
            module.exit_json(changed=False, verified=True, phase="prepare")
        before = json.loads(filename.read_text())
        expected = copy.deepcopy(before)
        expected["vlans"] = desired_table(before["vlans"], params["members"])
        if current not in (before, expected):
            raise ValueError("Switch configuration drifted outside the single reviewed membership change")
        target = expected if params["phase"] == "apply" else before
        if current == target or module.check_mode:
            module.exit_json(changed=current != target, verified=current == target, phase=params["phase"])
        try:
            set_vlans(*args, target["vlans"])
        except requests.RequestException:
            pass
        if snapshot(args) != target:
            raise ValueError("Switch membership outcome is unverified; inspect recovery evidence")
        module.exit_json(changed=True, verified=True, phase=params["phase"], members=params["members"])
    except (ValueError, KeyError, OSError) as error:
        module.fail_json(msg=str(error))
    except requests.RequestException:
        module.fail_json(msg="Switch API request failed; credentials suppressed")


if __name__ == "__main__":
    main()