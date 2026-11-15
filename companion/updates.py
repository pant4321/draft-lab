"""Check this repository's public release metadata without downloading software."""
from __future__ import annotations

import json
import re
import threading
from urllib.request import Request, urlopen

REPOSITORY_URL = "https://github.com/pant4321/draft-lab"
LATEST_API_URL = "https://api.github.com/repos/pant4321/draft-lab/releases/latest"
MAX_RESPONSE_BYTES = 512 * 1024


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,6}\.\d{1,6}\.\d{1,6}", value):
        raise ValueError("Invalid companion version.")
    return tuple(map(int, value.split(".")))


def release_update(release, current_version):
    """Accept only stable companion tags with an uploaded executable in our repo."""
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False:
        raise ValueError("No stable release available.")
    tag = release.get("tag_name", "")
    if not isinstance(tag, str) or not tag.startswith("companion-v"):
        raise ValueError("Not a companion release.")
    latest = tag[len("companion-v"):]
    if version_tuple(latest) <= version_tuple(current_version):
        return {"status": "current", "latestVersion": latest}
    download = f"{REPOSITORY_URL}/releases/download/{tag}/DraftLab.exe"
    assets = release.get("assets")
    if not isinstance(assets, list) or not any(
            isinstance(asset, dict) and asset.get("name") == "DraftLab.exe"
            and asset.get("state") == "uploaded" and type(asset.get("size")) is int
            and asset["size"] > 0 and asset.get("browser_download_url") == download
            for asset in assets):
        raise ValueError("Release download is not ready.")
    return {"status": "available", "latestVersion": latest, "downloadUrl": download}


def check_latest(current_version):
    request = Request(LATEST_API_URL, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": f"DraftLab/{current_version}",
        "X-GitHub-Api-Version": "2026-03-10",
    })
    with urlopen(request, timeout=5) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("Release metadata is too large.")
    return release_update(json.loads(body), current_version)


class UpdateChecker:
    def __init__(self, state, stop, current_version, fetch=check_latest):
        self.state, self.stop, self.current_version, self.fetch = state, stop, current_version, fetch
        self.busy = threading.Lock()

    def start(self):
        if self.stop.is_set() or not self.busy.acquire(blocking=False):
            return None
        self.state.publish_update({"status": "checking"})

        def run():
            try:
                try:
                    result = self.fetch(self.current_version)
                except Exception:
                    result = {"status": "unavailable"}
                if not self.stop.is_set():
                    self.state.publish_update(result)
            finally:
                self.busy.release()

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        return worker
