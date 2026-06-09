# Issue 005 — Plex server identity reset after Unraid VM restart

**Date:** 2026-05-20
**Affected host:** nas.owl.red (10.0.10.5), Plex container (hotio/plex:release 1.43.2.10687)
**Severity:** High — Plex inaccessible, all existing client links broken
**Status:** Fixed

---

## Symptoms

- Plex container stuck in `Created` state, never starts
- After `/dev/dri` device mapping removed: container restarts in a crash loop
- `docker logs plex` shows:
  ```
  /config/Preferences.xml:1.1: Document is empty
  s6-rc: warning: unable to start service init-setup-app: command exited 3
  ```
- `/mnt/ssd/appdata/plex/Preferences.xml` exists but is **0 bytes**
- After deleting the empty file and restarting: Plex comes up but `claimed="0"`, new `MachineIdentifier`
- All existing Plex clients, bookmarks, and shared library links stop working (server not found)

---

## Root Cause

Two compounding failures:

**1. `/dev/dri` device mapping with no GPU in VM**

The Plex container template had a `/dev/dri` device mapping configured for Intel QuickSync hardware transcoding. This device does not exist in the Unraid VM (no GPU passed through). Docker refuses to start a container that references a non-existent device:

```
error gathering device information while adding custom device "/dev/dri": no such file or directory
```

**2. `Preferences.xml` wiped to 0 bytes**

When the container crashed mid-startup (after the `/dev/dri` fix was applied but before Plex fully initialized), the hotio container init wrote an empty `Preferences.xml`. Subsequent startups then failed because an empty file is not valid XML. Plex was caught in a loop: crashing before it could write a valid config, but leaving behind a 0-byte file that prevented clean initialization.

The `Preferences.xml` contains `MachineIdentifier` (UUID) and `ProcessedMachineIdentifier` (the externally-visible server ID used in all client URLs and plex.tv API calls). Once wiped and regenerated, the new `ProcessedMachineIdentifier` does not match the one registered with plex.tv or cached by clients.

---

## Fix

### Step 1 — Remove `/dev/dri` device mapping from Plex container

In the Unraid WebUI, edit the Plex container template and remove any `/dev/dri` device extra parameter. This is only valid if a GPU is actually passed through to the VM.

### Step 2 — Delete the 0-byte `Preferences.xml`

```bash
docker stop plex
rm /mnt/ssd/appdata/plex/Preferences.xml
# Confirm deleted
ls /mnt/ssd/appdata/plex/Preferences.xml 2>/dev/null || echo "deleted ok"
```

### Step 3 — Start Plex and claim the server

```bash
docker start plex
sleep 8
docker ps --filter name=plex --format "{{.Status}}"
```

Navigate to `http://10.0.10.5:32400/web` from a browser on the local network. Sign in with your plex.tv account to claim the server. Plex will generate a new `MachineIdentifier` and `ProcessedMachineIdentifier`.

Verify it is claimed:

```bash
curl -s http://localhost:32400/identity
# claimed="1" confirms successful link to plex.tv
```

### Step 4 — Restore the old server identity

Plex clients and bookmarks use the `ProcessedMachineIdentifier` (the hex string in all Plex URLs) to locate the server. After a fresh config, this ID changes and all existing links break.

Plex reads `ProcessedMachineIdentifier` from `Preferences.xml` on startup and does **not** recalculate it from `MachineIdentifier`. This means it can be injected directly.

Find the old `ProcessedMachineIdentifier` from plugin logs:

```bash
grep -r "Machine identifier is" /mnt/ssd/appdata/plex/Logs/PMS\ Plugin\ Logs/ 2>/dev/null | head -1
# e.g.: Machine identifier is 536a1ae18c5f643dedd6710d4b4787aafe17bc29
```

Stop Plex and inject the old value:

```bash
docker stop plex

OLD_PMID="536a1ae18c5f643dedd6710d4b4787aafe17bc29"   # replace with actual value from logs

sed -i "s/ProcessedMachineIdentifier=\"[^\"]*\"/ProcessedMachineIdentifier=\"$OLD_PMID\"/" \
  /mnt/ssd/appdata/plex/Preferences.xml

# Confirm
grep -o 'ProcessedMachineIdentifier="[^"]*"' /mnt/ssd/appdata/plex/Preferences.xml
```

Start Plex and verify the API reports the restored identity:

```bash
docker start plex
sleep 6
curl -s http://localhost:32400/identity
# machineIdentifier="536a1ae18c5f643dedd6710d4b4787aafe17bc29" claimed="1"
```

All existing client links and bookmarks using the old server ID will reconnect without reconfiguration.

---

## Verification

```bash
# Container running
docker ps --filter name=plex --format "{{.Names}}\t{{.Status}}"

# Identity and claim status
curl -s http://localhost:32400/identity

# Preferences written correctly
grep -o 'ProcessedMachineIdentifier="[^"]*"\|claimed="[^"]*"' /mnt/ssd/appdata/plex/Preferences.xml
```

---

## Operational notes

- **Library database is not affected.** `/mnt/ssd/appdata/plex/Plug-in Support/Databases/` holds the full library and metadata. Only `Preferences.xml` was lost — no rescan needed after recovery.
- **`/dev/dri` in container template:** Only add this if a GPU (Intel iGPU, AMD, NVIDIA) is actually passed through to the VM. The I350 NIC passthrough provides no GPU. Hardware transcoding is not available in this VM configuration.
- **Plugin logs are the recovery source.** They contain `Machine identifier is <ProcessedMachineIdentifier>` going back years. If they are rotated out, the next fallback is searching old PMS log files for the hex string in plex.tv API request URLs (e.g. `shared_sources/owned?machineIdentifier=...`).
- **Plex does not recalculate `ProcessedMachineIdentifier` from `MachineIdentifier`** — confirmed on version 1.43.2. The XML value is trusted as-is. This may change in future versions.
