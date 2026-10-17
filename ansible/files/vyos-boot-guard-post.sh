#!/bin/sh
set -eu
python3 - <<'PY'
import json
import subprocess
for family in ('ip', 'ip6'):
    entries = json.loads(subprocess.check_output(['nft', '-j', 'list', 'table', family, 'vyos_filter']))['nftables']
    hooks = {entry['chain']['hook']: entry['chain']['name'] for entry in entries if entry.get('chain', {}).get('hook') in ('input', 'forward')}
    if set(hooks) != {'input', 'forward'}:
        raise SystemExit('Native input/forward hooks absent; boot guard retained')
    for chain in hooks.values():
        rules = [entry['rule'] for entry in entries if entry.get('rule', {}).get('chain') == chain]
        if not any(rule.get('comment', '').endswith('default-action drop') and any('drop' in expression for expression in rule.get('expr', [])) for rule in rules):
            raise SystemExit('Native default-deny policy absent; boot guard retained')
PY
if nft list table inet owl_boot_guard >/dev/null 2>&1; then
    nft delete table inet owl_boot_guard
fi