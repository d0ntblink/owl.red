#!/usr/bin/python3
"""Reconcile a SwOS 2.x login through its native password-only endpoint."""

from ansible.module_utils.basic import AnsibleModule

import requests
from requests.auth import HTTPDigestAuth
from swos.core import build_post_data, decode_hex_string
from swos.platform import PlatformAdapter, PlatformType
from cryptography.hazmat.primitives.ciphers import Cipher
try:
    from cryptography.hazmat.decrepit.ciphers.algorithms import ARC4
except ImportError:
    from cryptography.hazmat.primitives.ciphers.algorithms import ARC4


def encode_password(current_password, new_password):
    for value in (current_password, new_password):
        if not value.isascii() or len(value) > 15 or "\x00" in value:
            raise ValueError("SwOS passwords must be at most 15 ASCII characters without NUL")
    if not new_password:
        raise ValueError("The desired SwOS password must not be blank")
    plaintext = bytearray(
        (current_password + "\x00" + new_password).encode("ascii").ljust(32, b"\x00")
    )
    seed = (current_password or "*").encode("ascii")
    seed = (seed * 16)[:16]
    stream = Cipher(ARC4(seed), mode=None).encryptor().update(bytes(64))
    for index, value in enumerate(stream):
        plaintext[index % 32] ^= value
    return plaintext.hex()


def read_identity(url, username, password):
    adapter = PlatformAdapter(url, username, password, platform_type=PlatformType.SWOS)
    try:
        data = adapter.get("system")
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 401:
            return None
        raise
    return {
        "serial": decode_hex_string(data[adapter.field_map.system_serial]),
        "version": decode_hex_string(data[adapter.field_map.system_version]),
    }


def main():
    module = AnsibleModule(
        argument_spec={
            "host": {"type": "str", "required": True},
            "username": {"type": "str", "default": "admin"},
            "current_password": {"type": "str", "default": "", "no_log": True},
            "new_password": {"type": "str", "required": True, "no_log": True},
            "expected_serial": {"type": "str", "required": True},
        },
        supports_check_mode=True,
    )
    params = module.params
    url = "http://" + params["host"]
    try:
        encoded = encode_password(params["current_password"], params["new_password"])
        desired = read_identity(url, params["username"], params["new_password"])
        if desired is not None:
            if desired["serial"] != params["expected_serial"]:
                module.fail_json(msg="Switch serial mismatch; no password operation permitted")
            module.exit_json(changed=False, verified=True, serial=desired["serial"])
        current = read_identity(url, params["username"], params["current_password"])
        if current is None or current["serial"] != params["expected_serial"]:
            module.fail_json(msg="Current login or switch serial did not match; no password changed")
        if current["version"] != "2.18":
            module.fail_json(msg="This native password operation is qualified only for SwOS 2.18")
        if module.check_mode:
            module.exit_json(changed=True, verified=False, serial=current["serial"])
        try:
            response = requests.post(
                url + "/!pwd.b",
                auth=HTTPDigestAuth(params["username"], params["current_password"]),
                data=build_post_data({"pwd": encoded}),
                headers={"Content-Type": "text/plain"},
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException:
            pass
        verified = read_identity(url, params["username"], params["new_password"])
        if verified is None or verified["serial"] != params["expected_serial"]:
            module.fail_json(msg="Password request outcome is unverified; inspect access before retrying")
        if params["current_password"] != params["new_password"]:
            if read_identity(url, params["username"], params["current_password"]) is not None:
                module.fail_json(msg="Desired login works but the previous login is still accepted")
        module.exit_json(changed=True, verified=True, serial=verified["serial"])
    except ValueError as error:
        module.fail_json(msg=str(error))
    except requests.RequestException:
        module.fail_json(msg="Switch request failed; credential and response values suppressed")
    except (KeyError, TypeError):
        module.fail_json(msg="Unexpected switch identity response; credential values suppressed")


if __name__ == "__main__":
    main()