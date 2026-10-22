import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('lease_adapter', Path(__file__).resolve().parents[1] / 'ansible/files/opennds-technitium-leases.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class LeaseContractTests(unittest.TestCase):
    def setUp(self):
        self.payload = {'status': 'ok', 'response': {'leases': [{
            'scope': 'vlan30-guest-net', 'type': 'Dynamic', 'address': '10.0.30.100',
            'hardwareAddress': '02-00-00-00-00-01', 'leaseExpires': '2026-10-22T12:00:00Z',
        }]}}

    def select(self, payload=None):
        return adapter.select_leases(payload or self.payload, 'vlan30-guest-net', '10.0.30.0/24', 1792627200)

    def test_active_lease_normalized(self):
        self.assertEqual(self.select()[0][:2], ('10.0.30.100', '02:00:00:00:00:01'))

    def test_other_scope_excluded(self):
        self.payload['response']['leases'][0]['scope'] = 'vlan20-private-net'
        self.assertEqual(self.select(), [])

    def test_expired_lease_excluded(self):
        self.payload['response']['leases'][0]['leaseExpires'] = '2020-01-01T00:00:00Z'
        self.assertEqual(self.select(), [])

    def test_selected_scope_outside_subnet_rejected(self):
        self.payload['response']['leases'][0]['address'] = '10.0.10.1'
        with self.assertRaises(ValueError):
            self.select()

    def test_conflicting_identity_rejected(self):
        self.payload['response']['leases'].append(copy.deepcopy(self.payload['response']['leases'][0]))
        with self.assertRaises(ValueError):
            self.select()

    def test_multicast_identity_rejected(self):
        self.payload['response']['leases'][0]['hardwareAddress'] = '01-00-00-00-00-01'
        with self.assertRaises(ValueError):
            self.select()

    def test_naive_expiry_rejected(self):
        self.payload['response']['leases'][0]['leaseExpires'] = '2026-10-22T12:00:00'
        with self.assertRaises(ValueError):
            self.select()

    def test_api_failure_rejected(self):
        with self.assertRaises(ValueError):
            self.select({'status': 'invalid-token'})

    def test_native_timeout_is_seconds_and_bounded_by_expiry(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(adapter.subprocess, 'run') as native:
            output = Path(directory) / 'leases'
            adapter.publish([('10.0.30.100', '02:00:00:00:00:01', 103)], output, 30, 100)
            commands = json.loads(native.call_args.kwargs['input'])['nftables']
            self.assertEqual(commands[1]['add']['element']['elem'][0]['elem']['timeout'], 3)
            self.assertEqual(output.stat().st_mode & 0o077, 0)
            self.assertEqual(output.read_text(), '103 02:00:00:00:00:01 10.0.30.100 * *\n')


if __name__ == '__main__':
    unittest.main()