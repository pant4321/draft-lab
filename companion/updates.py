"""Check this repository's public release metadata without downloading software."""
from __future__ import annotations

import json
import ctypes
from hashlib import sha256
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

REPOSITORY_URL = "https://github.com/pant4321/draft-lab"
LATEST_API_URL = "https://api.github.com/repos/pant4321/draft-lab/releases/latest"
MAX_RESPONSE_BYTES = 512 * 1024
INSTALLER_NAME = "DraftEdgeCompanionSetup.exe"
PORTABLE_NAME = "DraftLab.exe"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\DraftEdgeCompanion_is1"
MAX_INSTALLER_BYTES = 64 * 1024 * 1024
ASSET_HOSTS = {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,6}\.\d{1,6}\.\d{1,6}", value):
        raise ValueError("Invalid companion version.")
    return tuple(map(int, value.split(".")))


def release_update(release, current_version):
    """Accept uploaded assets from stable companion releases in this repo."""
    if not isinstance(release, dict) or release.get("draft") is not False or release.get("prerelease") is not False:
        raise ValueError("No stable release available.")
    tag = release.get("tag_name", "")
    if not isinstance(tag, str) or not tag.startswith("companion-v"):
        raise ValueError("Not a companion release.")
    latest = tag[len("companion-v"):]
    if version_tuple(latest) <= version_tuple(current_version):
        return {"status": "current", "latestVersion": latest}
    assets = release.get("assets")
    for name in (INSTALLER_NAME, PORTABLE_NAME):
        download = f"{REPOSITORY_URL}/releases/download/{tag}/{name}"
        for asset in assets if isinstance(assets, list) else ():
            if (not isinstance(asset, dict) or asset.get("name") != name
                    or asset.get("state") != "uploaded" or type(asset.get("size")) is not int
                    or asset["size"] <= 0 or asset.get("browser_download_url") != download):
                continue
            result = {"status": "available", "latestVersion": latest, "downloadUrl": download}
            digest = asset.get("digest")
            if (name == INSTALLER_NAME and asset["size"] <= MAX_INSTALLER_BYTES
                    and isinstance(digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
                result["installer"] = {"size": asset["size"], "sha256": digest.removeprefix("sha256:")}
            return result
    raise ValueError("Release download is not ready.")


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


def installed_executable():
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return None
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_KEY) as key:
            directory, _ = winreg.QueryValueEx(key, "InstallLocation")
        exe = Path(sys.executable).resolve(strict=True)
        if (Path(directory) / PORTABLE_NAME).resolve(strict=True) == exe:
            return exe
    except (OSError, TypeError, ValueError):
        pass
    return None


class ReleaseAssetRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        parsed = urlsplit(newurl)
        if (parsed.scheme != "https" or parsed.hostname not in ASSET_HOSTS
                or parsed.port not in (None, 443) or parsed.username is not None):
            raise ValueError("Unexpected update download host.")
        return super().redirect_request(request, file, code, message, headers, newurl)


def download_installer(update, directory, stop):
    version = update["latestVersion"]
    version_tuple(version)
    url = f"{REPOSITORY_URL}/releases/download/companion-v{version}/{INSTALLER_NAME}"
    size = update["installer"]["size"]
    expected_digest = update["installer"]["sha256"]
    if (update["downloadUrl"] != url or type(size) is not int or not 0 < size <= MAX_INSTALLER_BYTES
            or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)):
        raise ValueError("Invalid installer metadata.")

    request = Request(url, headers={"User-Agent": "DraftEdge Companion"})
    opener = build_opener(ReleaseAssetRedirects())
    deadline = time.monotonic() + 180
    digest, received = sha256(), 0
    installer = directory / INSTALLER_NAME
    with opener.open(request, timeout=10) as source, installer.open("xb") as destination:
        while True:
            if stop.is_set() or time.monotonic() >= deadline:
                raise TimeoutError("Update download stopped.")
            block = source.read(256 * 1024)
            if not block:
                break
            received += len(block)
            if received > size:
                raise ValueError("Installer exceeds its published size.")
            digest.update(block)
            destination.write(block)
    if received != size or digest.hexdigest() != expected_digest:
        raise ValueError("Installer verification failed.")
    return installer


def launch_installer(installer, executable):
    # Keep the script in the command line so it can outlive the frozen app's extraction directory.
    script = (Path(__file__).resolve().parent / "assets" / "apply_update.ps1").read_text(encoding="utf-8")
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    environment = {
        **os.environ,
        "DRAFTEDGE_UPDATE_INSTALLER": str(installer),
        "DRAFTEDGE_UPDATE_EXE": str(executable),
        "PYINSTALLER_RESET_ENVIRONMENT": "1",
    }
    extracted = getattr(sys, "_MEIPASS", None)
    if extracted:
        ctypes.windll.kernel32.SetDllDirectoryW(None)
    try:
        helper = subprocess.Popen(
            [str(powershell), "-NoProfile", "-NonInteractive", "-Command", script],
            cwd=powershell.parent, env=environment, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    finally:
        if extracted:
            ctypes.windll.kernel32.SetDllDirectoryW(ctypes.c_wchar_p(extracted))
    marker = installer.parent / "ready"
    deadline = time.monotonic() + 10
    while not marker.is_file():
        if helper.poll() is not None:
            raise OSError("Update helper could not start.")
        if time.monotonic() >= deadline:
            helper.terminate()
            helper.wait(timeout=5)
            raise TimeoutError("Update helper did not start.")
        time.sleep(.05)
    return helper


class UpdateChecker:
    def __init__(self, state, stop, current_version, fetch=check_latest, *, request_stop=None):
        self.state, self.stop, self.current_version, self.fetch = state, stop, current_version, fetch
        self.request_stop = request_stop or stop.set
        self.executable = installed_executable()
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

    def can_install(self, update):
        return self.executable is not None and "installer" in update

    def install(self, update):
        if not self.can_install(update) or self.stop.is_set() or not self.busy.acquire(blocking=False):
            return None
        self.state.publish_update({**update, "status": "downloading"})

        def run():
            directory = None
            try:
                directory = Path(tempfile.mkdtemp(prefix="DraftEdge-update-"))
                installer = download_installer(update, directory, self.stop)
                if self.stop.is_set():
                    return
                self.state.publish_update({**update, "status": "installing"})
                launch_installer(installer, self.executable)
                directory = None  # The helper now owns the installer and its temporary directory.
                self.request_stop()
            except Exception:
                if not self.stop.is_set():
                    self.state.publish_update({**update, "status": "install_failed"})
            finally:
                if directory is not None:
                    try:
                        (directory / INSTALLER_NAME).unlink(missing_ok=True)
                        (directory / "ready").unlink(missing_ok=True)
                        directory.rmdir()
                    except OSError:
                        pass
                self.busy.release()

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        return worker
