import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];
assert.ok(process.argv.length === 3 && ['export', 'seal'].includes(action), 'Usage: node scripts/iot-wifi-csv.mjs export|seal');
const encrypted = path.join(root, 'ansible/vars/iot-wifi.csv.vault');
const plaintext = path.join(root, 'ansible/artifacts/iot-wifi/owl-red-iot-import.csv');
const itemId = 'd2a6f51f-982b-4c08-b384-b50501789341';
const fieldName = 'import_csv_vault_password';
const stored = parseEnv(fs.readFileSync(path.join(root, 'env.secret'), 'utf8'));
const environment = { ...process.env, BW_SECRET: stored.BW_SECRET,
  BITWARDENCLI_APPDATA_DIR: path.join(os.homedir(), '.local/state/owl-red/bitwarden-cli-2026.7.0') };
delete environment.BW_SESSION;
const binary = path.join(os.homedir(), '.local/share/owl-red/tools/bitwarden/2026.7.0/bw');
function run(command, argumentsList, input) {
  const result = spawnSync(command, argumentsList, { cwd: root, env: environment,
    input, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
  assert.ok(result.status === 0, 'Private operation failed; output withheld. Inspect state before retrying.');
  return result.stdout;
}
function vault(argumentsList, input) { return run(binary, argumentsList, input).trim(); }
function validate(bytes, password) {
  const code = `import csv,io,json,sys
request=json.load(sys.stdin)
reader=csv.DictReader(io.StringIO(request['csv'],newline=''))
assert reader.fieldnames==['Account Name','Wi-Fi Password','Max Num of Access Clients','MAC','VLAN','Upload Limit (Kbps)','Download Limit (Kbps)','Email']
rows=list(reader)
assert rows and len({row['Account Name'] for row in rows})==len(rows)
assert len({row['MAC'] for row in rows})==len(rows)
assert all(None not in row and row['Wi-Fi Password']==request['password'] and row['VLAN'] in ['40','50'] and row['Max Num of Access Clients']=='1' for row in rows)
`;
  run('python3', ['-c', code], JSON.stringify({ csv: bytes, password }));
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-iot-csv-'));
try {
  environment.BW_SESSION = vault(['unlock', '--passwordenv', 'BW_SECRET', '--raw']);
  vault(['sync']);
  let item = JSON.parse(vault(['get', 'item', itemId]));
  assert.ok(item.name === 'owl-red-wifi-iot' && item.login?.password, 'Unexpected IoT vault item');
  const matches = (item.fields ?? []).filter(field => field.name === fieldName);
  assert.ok(matches.length <= 1, 'Duplicate encryption-key fields');
  let key = matches[0]?.value;
  assert.ok(key || (action === 'seal' && !fs.existsSync(encrypted)), 'Encryption key missing; do not replace it');
  let bytes;
  if (action === 'seal') {
    bytes = fs.readFileSync(plaintext, 'utf8');
    validate(bytes, item.login.password);
    if (!key) {
      key = crypto.randomBytes(32).toString('base64url');
      item.fields = [...(item.fields ?? []), { name: fieldName, value: key, type: 1 }];
      vault(['edit', 'item', itemId], Buffer.from(JSON.stringify(item)).toString('base64'));
      item = JSON.parse(vault(['get', 'item', itemId]));
      assert.ok(item.fields.find(field => field.name === fieldName)?.value === key, 'Encryption key readback failed');
    }
  }
  const keyFile = path.join(temporary, 'key');
  fs.writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  const ansibleVault = path.join(root, '.venv/bin/ansible-vault');
  const options = ['--vault-password-file', keyFile];
  if (action === 'seal') {
    const inputFile = path.join(temporary, 'input.csv');
    fs.writeFileSync(inputFile, bytes, { mode: 0o600 });
    const sealed = run(ansibleVault, ['encrypt', ...options, '--output', '-', inputFile]);
    assert.ok(sealed.startsWith('$ANSIBLE_VAULT;1.1;AES256\n'), 'Unexpected encrypted format');
    const candidate = path.join(temporary, 'candidate.vault');
    fs.writeFileSync(candidate, sealed, { mode: 0o600 });
    const decrypted = path.join(temporary, 'decrypted.csv');
    run(ansibleVault, ['decrypt', ...options, '--output', decrypted, candidate]);
    assert.ok(fs.readFileSync(decrypted, 'utf8') === bytes, 'Encrypted CSV round-trip mismatch');
    fs.writeFileSync(encrypted, sealed, { mode: 0o600 });
  } else {
    const decrypted = path.join(temporary, 'decrypted.csv');
    run(ansibleVault, ['decrypt', ...options, '--output', decrypted, encrypted]);
    bytes = fs.readFileSync(decrypted, 'utf8');
    validate(bytes, item.login.password);
    fs.mkdirSync(path.dirname(plaintext), { recursive: true, mode: 0o700 });
    fs.writeFileSync(plaintext, bytes, { mode: 0o600 });
    fs.chmodSync(plaintext, 0o600);
  }
  console.log(action === 'seal' ? 'Encrypted CSV saved and round-trip verified: ansible/vars/iot-wifi.csv.vault'
    : 'Import CSV exported: ansible/artifacts/iot-wifi/owl-red-iot-import.csv');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}