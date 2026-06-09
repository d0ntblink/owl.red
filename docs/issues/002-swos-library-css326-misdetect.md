# Issue 002: mikrotik-swos 1.3.2 misdetects CSS326 as swos-lite

**Status:** Open (library bug, workaround applied)  
**Severity:** High — causes all field data to return empty  
**Affects:** mikrotik-swos ≤ 1.3.2, CSS326-24G-2S+RM running SwOS 2.18  
**Workaround:** Force platform to `swos` before any library calls  
**Upstream:** https://github.com/rosskouk/python-mikrotik-swos

---

## Symptoms

When using `swos-config` or the Python API against the CSS326:

```
$ swos-config 10.0.10.2 admin ""
...
Model:       (empty)
Identity:    (empty)
Version:     (empty)
```

All `get_system_info()` string fields return empty. `get_links()` returns an empty list. `get_snmp()` returns empty strings for community.

The switch IS reachable and authenticates correctly — HTTP 200 on all real endpoints. The raw `/sys.b` data is fully populated.

---

## Root Cause

The library's platform detection (`detect_platform_from_data` in `swos/platform.py`) uses a three-method fallback:

**Method 1 — Field name format heuristic:**
```python
has_hex_fields = any(k.startswith('i') and len(k) == 3 for k in data.keys())
has_descriptive_fields = 'id' in data or 'ver' in data or 'brd' in data
```

SwOS Lite uses numeric hex field IDs (`i01`, `i05`, etc.). SwOS uses descriptive names (`id`, `ver`, `brd`). However, the CSS326 SwOS response includes **`ivl`** — a 3-character field starting with `i` (interval config). This sets `has_hex_fields = True`.

Because both `has_hex_fields` and `has_descriptive_fields` are True, Method 1 is ambiguous and falls through.

**Method 2 — Model name prefix:**
```python
model_hex = data.get('i07') or data.get('brd', '')
model = decode_hex_string(model_hex)
if model.startswith('CSS'):
    return PlatformType.SWOS_LITE   # ← WRONG for CSS326 running full SwOS
elif model.startswith('CRS') or model.startswith('RB'):
    return PlatformType.SWOS
```

The CSS326 model decodes to `CSS326-24G-2S+`. The logic assumes all `CSS` prefix = SwOS Lite. This is **incorrect** — the CSS326-24G-2S+RM runs full SwOS 2.x, not SwOS Lite.

**Result:** The library uses the SwOS Lite field map (`swos_lite_map.py`) which has completely different field names. All lookups return empty because the field keys don't match the SwOS data structure.

---

## Verification

```python
from swos.core import parse_js_object
from swos.platform import detect_platform_from_data
import requests
from requests.auth import HTTPDigestAuth

r = requests.get("http://10.0.10.2/sys.b", auth=HTTPDigestAuth("admin", ""), timeout=5)
data = parse_js_object(r.text)
print(detect_platform_from_data(data))  # Returns: 'swos-lite' (WRONG)
```

Raw `sys.b` keys include `ivl` which triggers the false positive:
```
upt, cip, mac, mrkt, brd, sid, id, ver, rev, wdt, dsc, pdsc, bld,
ivl,  ← THIS is the culprit (3 chars, starts with 'i')
alla, allm, avln, allp, mgmt, temp, ...
```

---

## Workaround (Applied)

Monkey-patch `detect_platform` before any library calls to force `swos`:

```python
import swos.platform as _p
from swos.platform import PlatformType
_p.detect_platform = lambda url, username, password: PlatformType.SWOS
```

This is implemented in `ansible/library/swos_info.py` (`_force_swos_platform()`).

### Verified with override:

```
Model:    CSS326-24G-2S+
Identity: switch.owl.red
Version:  2.18
MAC:      48:8f:5a:0c:d1:82
Serial:   CAC90C5B5282
Uptime:   68309086 seconds
Ports:    26 parsed (Port1–Port26, SFP1, SFP2)
Active:   ports 1-9, 23 (lnk bitmask 0x004001ff)
SNMP:     enabled=True, community='public'
```

---

## Correct Fix (Upstream)

The detection logic should be fixed in `swos/platform.py`:

1. **Method 1**: Tighten the hex-field heuristic — SwOS Lite fields are `i` + 2 digits (`i01`–`i99`). Require the 2 trailing chars to be numeric:
   ```python
   has_hex_fields = any(k.startswith('i') and len(k) == 3 and k[1:].isdigit() for k in data.keys())
   ```

2. **Method 2**: Don't assume `CSS` = SwOS Lite. The CSS326-24G-2S+RM runs full SwOS. The product line split is more nuanced — check the SwOS version string or a different marker.

A reliable heuristic: **if the response has `ver`, `brd`, `id` with no `i01`/`i05`/`i06` fields, it's SwOS**.

---

## Environment

- Switch: MikroTik CSS326-24G-2S+RM, SwOS 2.18, serial CAC90C5B5282
- Library: mikrotik-swos 1.3.2 (`pip install mikrotik-swos`)
- Python: 3.12.3
- Controller: Ubuntu 24.04 WSL2

---

## References

- SwOS field map: `/home/n0rth/.local/lib/python3.12/site-packages/swos/swos_map.py`
- Detection logic: `/home/n0rth/.local/lib/python3.12/site-packages/swos/platform.py:27`
- Workaround impl: `ansible/library/swos_info.py`
