import os
from pathlib import Path
import runpy
import sqlite3
import sys
import tempfile
import time
import traceback
from urllib.parse import urlsplit

import requests


def snapshot(source, target):
    if source.is_symlink() or not source.is_file():
        raise RuntimeError("Expected regular Plex database missing")
    temporary = None
    started = time.monotonic()

    def progress(status, remaining, total):
        if time.monotonic() - started > 120:
            raise RuntimeError("Read-only snapshot exceeded its time budget")

    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".snapshot-", delete=False) as output:
            temporary = Path(output.name)
        with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=5) as original:
            with sqlite3.connect(temporary) as backup:
                original.backup(backup, pages=2048, progress=progress)
                if backup.execute("SELECT COUNT(*) FROM metadata_items").fetchone()[0] == 0:
                    raise RuntimeError("Snapshot has no library items")
        temporary.chmod(0o600)
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def block_diagnostic_export():
    original_send = requests.sessions.Session.send

    def send(session, request, **kwargs):
        if urlsplit(request.url).path.rstrip("/") == "/diagnostics/databases":
            raise RuntimeError("Plex diagnostic export is disabled; use the verified snapshot")
        return original_send(session, request, **kwargs)

    requests.sessions.Session.send = send


def main():
    source = Path("/plex/Plug-in Support/Databases/com.plexapp.plugins.library.db")
    target = Path("/config/com.plexapp.plugins.library.db")
    snapshot(source, target)
    block_diagnostic_export()
    os.environ.update({
        "MODE": "report", "SCHEDULE": "", "USE_EXISTING": "True",
        "LOCAL_DB": "False", "IGNORE_RUNNING": "False", "OVERLAYS_ONLY": "False",
        "PHOTO_TRANSCODER": "False", "EMPTY_TRASH": "False",
        "CLEAN_BUNDLES": "False", "OPTIMIZE_DB": "False",
        "TRACE": "False", "LOG_REQUESTS": "False", "GOTIFY_ENABLED": "False",
    })
    sys.argv = ["/imagemaid.py", "--mode", "report"]
    print("Consistent read-only SQLite snapshot ready; diagnostic-export fallback disabled.", flush=True)
    runpy.run_path("/imagemaid.py", run_name="__main__")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        diagnostic = Path("/config/report-error.log")
        diagnostic.write_text(traceback.format_exc())
        diagnostic.chmod(0o600)
        print("ImageMaid report stopped; inspect private diagnostics before retrying.", file=sys.stderr)
        sys.exit(1)