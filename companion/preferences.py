"""Local launcher preferences shared by installed and portable copies."""
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile


def settings_path():
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "DraftLab" / "settings.json"


def read_settings():
    try:
        value = json.loads(settings_path().read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def update_settings(**changes):
    path = settings_path()
    value = read_settings()
    value.update(changes)
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False)
    try:
        with pending:
            json.dump(value, pending)
        Path(pending.name).replace(path)
    finally:
        Path(pending.name).unlink(missing_ok=True)
