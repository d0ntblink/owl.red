#!/usr/bin/python3
"""Reconcile one qualified lightweight AP through native UCI transactions."""

import copy
import json
import os
from pathlib import Path
import shlex
import time

from ansible.module_utils.basic import AnsibleModule
import requests
from requests.adapters import HTTPAdapter
import urllib3


class APError(Exception):
    pass


class PinnedAdapter(HTTPAdapter):
    def __init__(self, fingerprint):
        self.fingerprint = fingerprint
        super().__init__()

    def init_poolmanager(self, *args, **kwargs):
        kwargs["assert_fingerprint"] = self.fingerprint
        return super().init_poolmanager(*args, **kwargs)


class NativeAP:
    def __init__(self, endpoint, password, fingerprint, session_id=None):
        if endpoint not in ("https://10.10.20.1", "https://10.0.10.40"):
            raise APError("Endpoint is outside the qualified AP management addresses")
        self.endpoint = endpoint
        self.session_id = session_id or "0" * 32
        self.http = requests.Session()
        self.http.trust_env = False
        self.http.mount("https://", PinnedAdapter(fingerprint))
        if session_id is None:
            result = self.call("session", "login", {"username": "root", "password": password, "timeout": 600})
            self.session_id = result["ubus_rpc_session"]

    def call(self, obj, method, values=None):
        try:
            response = self.http.post(
                self.endpoint + "/ubus",
                json={"jsonrpc": "2.0", "id": 1, "method": "call", "params": [self.session_id, obj, method, values or {}]},
                verify=False,
                timeout=(4, 25),
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise APError("Native AP request failed at " + obj + "." + method) from None
        result = payload.get("result", [])
        if not result or result[0] != 0:
            raise APError("Native AP rejected " + obj + "." + method + "; response values suppressed")
        return result[1] if len(result) > 1 else {}


def parse_config(text):
    sections = {}
    current = None
    for line in text.splitlines():
        tokens = shlex.split(line, comments=True)
        if not tokens:
            continue
        if tokens[0] == "config" and len(tokens) == 3:
            if tokens[2] in sections:
                raise APError("Duplicate named UCI section")
            current = {".type": tokens[1]}
            sections[tokens[2]] = current
        elif current is not None and tokens[0] in ("option", "list") and len(tokens) == 3:
            if tokens[0] == "option":
                current[tokens[1]] = tokens[2]
            else:
                current.setdefault(tokens[1], []).append(tokens[2])
        else:
            raise APError("Rendered UCI input is outside the supported named-section grammar")
    return sections


def normalize(values):
    return {name: {key: value for key, value in row.items() if not key.startswith(".") or key == ".type"} for name, row in values.items()}


def save_private(filename, value):
    descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, indent=2)
    os.chmod(filename, 0o600)


def read_configs(client):
    return {name: normalize(client.call("uci", "get", {"config": name})["values"]) for name in ["network", "wireless", "dhcp", "firewall", "uhttpd", "dropbear", "system"]}


def desired_configs(before, rendered):
    result = copy.deepcopy(before)
    for name in ["network", "wireless", "dhcp", "firewall"]:
        result[name] = parse_config(rendered[name])
    main = result["uhttpd"].get("main")
    if main is None or "main" not in result["dropbear"]:
        raise APError("Expected native management service sections are missing")
    main["listen_http"] = ["10.0.10.40:80"]
    main["listen_https"] = ["10.0.10.40:443"]
    main["redirect_https"] = "1"
    result["uhttpd"].pop("guest", None)
    result["dropbear"]["main"]["Interface"] = "lan"
    for row in result["system"].values():
        if row[".type"] == "system":
            row["hostname"] = "ap"
        if row[".type"] == "timeserver":
            row["server"] = ["10.0.10.1"]
            row["enabled"] = "1"
            row["enable_server"] = "0"
    if result["network"]["lan"]["ipaddr"] != "10.0.10.40":
        raise APError("Management address differs from the qualified target")
    if result["dhcp"]["main"]["port"] != "0":
        raise APError("The lightweight AP must not serve DNS")
    if any(row.get("ignore") != "1" for row in result["dhcp"].values() if row[".type"] == "dhcp"):
        raise APError("The lightweight AP must not serve DHCP")
    return result


def stage(client, before, desired):
    changed = [name for name in desired if before[name] != desired[name]]
    for package in changed:
        for section in before[package]:
            if section not in desired[package]:
                client.call("uci", "delete", {"config": package, "section": section})
        for name, row in desired[package].items():
            values = {key: value for key, value in row.items() if key != ".type"}
            old = before[package].get(name)
            if old is not None and old[".type"] != row[".type"]:
                client.call("uci", "delete", {"config": package, "section": name})
                old = None
            if old is None:
                client.call("uci", "add", {"config": package, "type": row[".type"], "name": name, "values": values})
            elif old != row:
                removed = [key for key in old if key != ".type" and key not in values]
                if removed:
                    client.call("uci", "delete", {"config": package, "section": name, "options": removed})
                client.call("uci", "set", {"config": package, "section": name, "values": values})
    return changed


def main():
    module = AnsibleModule(
        argument_spec={
            "endpoint": {"type": "str", "required": True},
            "password": {"type": "str", "required": True, "no_log": True},
            "certificate_sha256": {"type": "str", "required": True},
            "recovery_directory": {"type": "path", "required": True},
            "phase": {"type": "str", "choices": ["inspect", "qualify", "plan", "trial", "verify", "confirm", "rollback", "finish"], "default": "inspect"},
            "rendered": {"type": "dict", "default": {}, "no_log": True},
            "apply_allowed": {"type": "bool", "default": False},
            "expected_version": {"type": "str", "default": "25.12.2", "choices": ["25.12.2", "25.12.6"]},
        },
        supports_check_mode=True,
    )
    params = module.params
    directory = Path(params["recovery_directory"]).resolve()
    if directory.parent != Path.home() / ".local/state/owl-red" or not directory.name.startswith("openwrt-rebuild-") or not directory.is_dir():
        module.fail_json(msg="A fresh private AP recovery directory is required")
    fingerprint = params["certificate_sha256"]
    if len(fingerprint) != 64 or any(character not in "0123456789abcdef" for character in fingerprint):
        module.fail_json(msg="A trusted SSH-derived AP certificate fingerprint is required")
    phase = params["phase"]
    if phase not in ["inspect", "plan", "verify"] and not params["apply_allowed"]:
        module.fail_json(msg="Explicit AP apply approval is required")
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    try:
        transaction_file = directory / "transaction.json"
        transaction = json.loads(transaction_file.read_text()) if transaction_file.exists() else {}
        session_id = transaction.get("session") if phase in ["confirm", "rollback"] else None
        client = NativeAP(params["endpoint"], params["password"], fingerprint, session_id)
        board = client.call("system", "board")
        if board["board_name"] != "dlink,dir-885l" or board["release"]["version"] != params["expected_version"]:
            raise APError("Unexpected AP board or firmware")
        if phase == "confirm":
            client.call("uci", "confirm")
            save_private(directory / "confirmed.json", {"confirmed": True})
            module.exit_json(changed=True, verified=True, phase=phase)
        if phase == "rollback":
            client.call("uci", "rollback")
            module.exit_json(changed=True, phase=phase)
        current = read_configs(client)
        if phase == "inspect":
            if not (directory / "before.json").exists():
                save_private(directory / "before.json", current)
            module.exit_json(changed=False, verified=True, board=board["board_name"], version=board["release"]["version"])
        if phase == "qualify":
            section = next(name for name, row in current["system"].items() if row[".type"] == "system")
            if current["system"][section].get("hostname") == "ap" and (directory / "qualified.json").exists():
                module.exit_json(changed=False, verified=True, phase=phase)
            save_private(directory / "before-qualification.json", current)
            client.call("uci", "set", {"config": "system", "section": section, "values": {"hostname": "ap"}})
            save_private(directory / "qualification-session.json", {"session": client.session_id})
            client.call("uci", "apply", {"rollback": True, "timeout": 60})
            fresh = NativeAP(params["endpoint"], params["password"], fingerprint, client.session_id)
            converged = False
            for attempt in range(12):
                if fresh.call("system", "board")["hostname"] == "ap":
                    converged = True
                    break
                if attempt < 11:
                    time.sleep(1)
            if not converged:
                raise APError("Low-risk native transaction did not converge")
            fresh.call("uci", "confirm")
            save_private(directory / "before.json", read_configs(fresh))
            save_private(directory / "qualified.json", {"native_apply_confirm": True})
            module.exit_json(changed=True, verified=True, phase=phase)
        before = json.loads((directory / "before.json").read_text())
        desired = desired_configs(before, params["rendered"])
        changed = [name for name in desired if current[name] != desired[name]]
        if phase == "plan" or module.check_mode:
            module.exit_json(changed=bool(changed), changed_packages=changed, phase="plan")
        if phase == "verify":
            if changed:
                raise APError("Live AP configuration does not match the declared candidate")
            interfaces = client.call("network.interface", "dump").get("interface", [])
            lan = next((row for row in interfaces if row.get("interface") == "lan"), {})
            if not lan.get("up") or not any(row["address"] == "10.0.10.40" and row["mask"] == 24 for row in lan.get("ipv4-address", [])):
                raise APError("Wired management interface has not converged")
            wireless = client.call("network.wireless", "status")
            active = []
            for radio in wireless.values():
                if not radio.get("up"):
                    raise APError("A required radio is not up")
                for interface in radio.get("interfaces", []):
                    config = interface.get("config", {})
                    active.append(config.get("ssid"))
            expected = [config["ssid"] for config in desired["wireless"].values() if config.get(".type") == "wifi-iface" and config.get("disabled", "0") == "0"]
            if sorted(active) != sorted(expected):
                raise APError("Enabled/disabled SSID runtime does not match the target")
            module.exit_json(changed=False, verified=True, active_ssids=active, management="10.0.10.40/24")
        if phase == "finish":
            if changed or not (directory / "confirmed.json").exists():
                raise APError("Service retirement requires confirmed matching AP configuration")
            module.exit_json(changed=False, verified=True, service_retirement_ready=True)
        if current not in (before, desired):
            raise APError("AP drift differs from both the private preimage and declared target")
        if not changed:
            module.exit_json(changed=False, verified=True, phase="trial")
        staged = client.call("uci", "changes").get("changes", {})
        if any(staged.values()):
            raise APError("Uncommitted UCI changes exist in this transaction")
        stage(client, current, desired)
        save_private(directory / "transaction.json", {"session": client.session_id})
        save_private(directory / "desired.json", desired)
        try:
            client.call("uci", "apply", {"rollback": True, "timeout": 300})
        except APError:
            module.exit_json(changed=True, trial_pending=True, apply_response_unknown=True)
        module.exit_json(changed=True, trial_pending=True, apply_response_unknown=False)
    except APError as error:
        save_private(directory / "failure.json", {"phase": phase, "reason": str(error)})
        module.fail_json(msg="AP phase " + phase + " failed; inspect the private sanitized failure record")
    except (KeyError, OSError, ValueError) as error:
        save_private(directory / "failure.json", {"phase": phase, "reason": type(error).__name__})
        module.fail_json(msg="AP phase " + phase + " failed; sensitive configuration and response values suppressed")


if __name__ == "__main__":
    main()