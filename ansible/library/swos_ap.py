#!/usr/bin/python3
"""Reconcile the bounded AP trunk without changing native management ports."""

import copy
import json
import os
from pathlib import Path

from ansible.module_utils.basic import AnsibleModule
import requests
import swos.platform as swos_platform
from swos import get_vlans, set_vlans
from swos.platform import PlatformType


def desired_table(table, declared):
    base = {20: [2, 18, 25], 40: [18, 25], 50: [18, 25]}
    attached = {20: [2, 18, 24, 25], 40: [18, 25], 50: [18, 25]}
    local_iot = {**attached, 40: [18, 24, 25]}
    active_iot = {**local_iot, 50: [18, 24, 25]}
    allowed = {int(key): value for key, value in declared.items()}
    if allowed not in (base, attached, local_iot, active_iot):
        raise ValueError("Only the reviewed AP, DNS trunk and retained cp1 membership is allowed")
    result = copy.deepcopy(table)
    for vlan, members in allowed.items():
        matches = [row for row in result if row["vlan_id"] == vlan]
        if len(matches) != 1:
            raise ValueError("Missing or duplicate target switch VLAN")
        prior = ([2, 25], base[20], attached[20]) if vlan == 20 else ([5], base[vlan], active_iot[vlan])
        if sorted(matches[0]["member_ports"]) not in prior:
            raise ValueError("Unexpected AP VLAN membership; refusing overwrite")
        matches[0]["member_ports"] = members
        matches[0]["learning"] = True
    return result


def test_table(table, declared):
    result = desired_table(table, declared)
    for row in result:
        if row["vlan_id"] in [40, 50]:
            row["member_ports"] = sorted(set(row["member_ports"]) | {2})
    return result


def main():
    module = AnsibleModule(argument_spec={
        "password": {"type": "str", "required": True, "no_log": True},
        "phase": {"type": "str", "choices": ["prepare", "test", "apply", "rollback"], "default": "prepare"},
        "declared": {"type": "dict", "required": True},
        "recovery_directory": {"type": "path", "required": True},
    }, supports_check_mode=True)
    params = module.params
    directory = Path(params["recovery_directory"]).resolve()
    if directory.parent != Path.home() / ".local/state/owl-red" or not directory.name.startswith(("openwrt-rebuild-", "technitium-vlan-")) or not directory.is_dir():
        module.fail_json(msg="An existing private AP rebuild recovery directory is required")
    if not params["password"]:
        module.fail_json(msg="The existing Bitwarden switch login is required")
    swos_platform.detect_platform = lambda *args: PlatformType.SWOS
    from swos import get_system_info, get_links, get_port_vlans

    def snapshot():
        args = ("http://10.0.10.2", "admin", params["password"])
        system = get_system_info(*args)
        if system["serial_number"] != "CAC90C5B5282" or system["version"] != "2.18":
            raise ValueError("Switch identity mismatch")
        ports, native = get_links(*args), get_port_vlans(*args)
        if len(ports) != 26 or len(native) != 26:
            raise ValueError("Incomplete switch response")
        for number, name in [(2, "cp1.pve"), (18, "ap.owl.red"), (22, "cab-trunk"), (24, "edge.pve-mgmt"), (25, "sfp1-vyos")]:
            port, vlan = ports[number - 1], native[number - 1]
            if port["port_name"] != name or not port["enabled"] or not port["link_up"]:
                raise ValueError("A required AP/native management port is not ready")
            if vlan["default_vlan_id"] != 1 or vlan["vlan_mode"] != "Optional" or vlan["force_vlan_id"] or vlan["vlan_receive"] != "Any":
                raise ValueError("Native management VLAN settings changed")
        return {
            "ports": [{key: port[key] for key in ["port_number", "port_name", "enabled", "auto_negotiation"]} for port in ports],
            "port_vlans": native,
            "vlans": get_vlans(*args),
        }

    try:
        filename = directory / "ap-switch-before.json"
        current = snapshot()
        if params["phase"] == "prepare":
            desired_table(current["vlans"], params["declared"])
            if filename.exists() and json.loads(filename.read_text()) != current:
                raise ValueError("Existing recovery preimage differs")
            if not filename.exists() and not module.check_mode:
                descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "w") as output:
                    json.dump(current, output, indent=2)
            module.exit_json(changed=False, verified=True)
        before = json.loads(filename.read_text())
        expected = copy.deepcopy(before)
        expected["vlans"] = desired_table(before["vlans"], params["declared"])
        testing = copy.deepcopy(before)
        testing["vlans"] = test_table(before["vlans"], params["declared"])
        if current not in (before, expected, testing):
            raise ValueError("Unrelated switch drift; refusing apply/rollback")
        target = testing if params["phase"] == "test" else expected if params["phase"] == "apply" else before
        if current == target or module.check_mode:
            module.exit_json(changed=current != target, verified=current == target)
        try:
            set_vlans("http://10.0.10.2", "admin", params["password"], target["vlans"])
        except requests.RequestException:
            pass
        if snapshot() != target:
            raise ValueError("Switch apply/rollback outcome is not verified")
        module.exit_json(changed=True, verified=True, operator_port_22_unchanged=True)
    except (ValueError, KeyError, OSError, requests.RequestException):
        module.fail_json(msg="Scoped AP switch operation failed; values suppressed, inspect private preimage")


if __name__ == "__main__":
    main()