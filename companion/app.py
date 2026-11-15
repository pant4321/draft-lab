"""Single-file Windows launcher and authenticated loopback bridge."""
from __future__ import annotations

import argparse
import ctypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
import threading
from urllib.parse import urlsplit, urlencode
import webbrowser

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.lcu import Poller
from companion.updates import UpdateChecker

VERSION = "0.1.6"
LIVE_SITE = "https://pant4321.github.io/draft-lab/"
LIVE_ORIGIN = "https://pant4321.github.io"
BRIDGE_PROTOCOL = 1


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.value = {"status": "starting", "message": "Starting companion", "snapshot": None,
                      "revision": 0, "companionVersion": VERSION, "bridgeProtocol": BRIDGE_PROTOCOL,
                      "update": {"status": "not_checked"}}

    def publish(self, status, message, snapshot):
        with self.lock:
            if (status, message, snapshot) != (self.value["status"], self.value["message"], self.value["snapshot"]):
                self.value.update(status=status, message=message, snapshot=snapshot, revision=self.value["revision"] + 1)

    def read(self):
        with self.lock:
            return dict(self.value)

    def publish_update(self, update):
        with self.lock:
            if update != self.value["update"]:
                self.value.update(update=dict(update), revision=self.value["revision"] + 1)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, state, stop):
        if address[0] != "127.0.0.1":
            raise ValueError("The bridge must bind only to loopback.")
        super().__init__(address, BridgeHandler)
        self.state, self.stop = state, stop
        self.session_token = secrets.token_urlsafe(32)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    @property
    def launch_url(self):
        return LIVE_SITE + "#" + urlencode({"companion": self.session_token, "port": self.server_port})


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log headers, local session tokens, or client data.

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        if self.host_allowed() and self.headers.get("Origin") == LIVE_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", LIVE_ORIGIN)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def host_allowed(self):
        expected = urlsplit(self.server.origin).netloc
        return self.headers.get("Host") == expected and self.headers.get("Origin", self.server.origin) in (self.server.origin, LIVE_ORIGIN)

    def authorized(self):
        return self.host_allowed() and secrets.compare_digest(self.headers.get("X-DraftLab-Session", "").encode(), self.server.session_token.encode())

    def do_OPTIONS(self):
        path = urlsplit(self.path).path
        expected = {"/api/state": "GET", "/api/quit": "POST"}.get(path)
        headers = {item.strip().lower() for item in self.headers.get("Access-Control-Request-Headers", "").split(",") if item.strip()}
        if not self.host_allowed() or self.headers.get("Origin") != LIVE_ORIGIN or not expected or self.headers.get("Access-Control-Request-Method") != expected or headers != {"x-draftlab-session"}:
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", expected)
        self.send_header("Access-Control-Allow-Headers", "X-DraftLab-Session")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.host_allowed():
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path == "/api/state":
            if not self.authorized():
                self.send_json({"error": "Local companion session required."}, 403)
            else:
                self.send_json(self.server.state.read())
            return
        if path.startswith("/api/"):
            self.send_error(404)
            return
        self.send_error(404)

    def do_POST(self):
        if not self.authorized():
            self.send_json({"error": "Local companion session required."}, 403)
            return
        if urlsplit(self.path).path != "/api/quit":
            self.send_error(404)
            return
        self.send_json({"stopping": True})
        self.server.stop.set()


def resource_root():
    return Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent


def settings_path():
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local/share"))) / "DraftLab" / "settings.json"


def read_settings():
    try:
        value = json.loads(settings_path().read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def launcher(server, poller, stop, updates, title="Draft Lab Companion"):
    import tkinter as tk
    from tkinter import filedialog, ttk
    window = tk.Tk()
    window.title(title)
    window.geometry("460x285")
    window.resizable(False, False)
    window.configure(bg="#101719")
    icon = resource_root() / "companion/assets/draftlab.ico"
    if icon.is_file():
        window.iconbitmap(str(icon))
    tk.Label(window, text="DRAFT LAB", bg="#101719", fg="#b2e7c3", font=("Segoe UI", 19, "bold")).pack(pady=(22, 8))
    message = tk.StringVar(value="Starting companion")
    tk.Label(window, textvariable=message, bg="#101719", fg="#e5efeb", font=("Segoe UI", 12)).pack(pady=7)
    tk.Label(window, text="Leave this open while drafting.", bg="#101719", fg="#91a6a5", font=("Segoe UI", 10)).pack(pady=4)
    buttons = tk.Frame(window, bg="#101719")
    buttons.pack(pady=18)

    def choose_folder():
        folder = filedialog.askdirectory(title="Choose the League of Legends install folder")
        if folder:
            poller.preferred = Path(folder)
            poller.lockfile, poller.client, poller.next_search = None, None, 0
            path = settings_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"leagueFolder": folder}), encoding="utf-8")

    ttk.Button(buttons, text="Open Draft Lab", command=lambda: webbrowser.open(server.launch_url)).pack(side="left", padx=5)
    ttk.Button(buttons, text="League folder…", command=choose_folder).pack(side="left", padx=5)
    ttk.Button(buttons, text="Quit", command=stop.set).pack(side="left", padx=5)
    update_row = tk.Frame(window, bg="#101719")
    update_row.pack(fill="x", padx=24, pady=(0, 12))
    installed_version = updates.current_version
    update_message = tk.StringVar(value=f"v{installed_version} · Checking for updates…")
    tk.Label(update_row, textvariable=update_message, bg="#101719", fg="#91a6a5", font=("Segoe UI", 9)).pack(side="left")
    update_button = ttk.Button(update_row)
    last_update = None
    window.protocol("WM_DELETE_WINDOW", stop.set)

    def refresh():
        nonlocal last_update
        if stop.is_set():
            window.destroy()
            return
        value = server.state.read()
        message.set(value["message"])
        update = value["update"]
        if update != last_update:
            last_update = update
            update_button.pack_forget()
            status = update["status"]
            text = "Checking for updates…" if status == "checking" else "Up to date" if status == "current" else "Update check unavailable"
            if status == "available":
                text = f"v{update['latestVersion']} available"
                update_button.configure(text="Download update", command=lambda url=update["downloadUrl"]: webbrowser.open(url))
                update_button.pack(side="right")
            elif status == "unavailable":
                update_button.configure(text="Retry", command=updates.start)
                update_button.pack(side="right")
            elif status == "disabled":
                text = "Update check off"
            update_message.set(f"v{installed_version} · {text}")
        window.after(300, refresh)

    refresh()
    window.mainloop()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Draft Lab local League companion")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--league-folder", type=Path)
    parser.add_argument("--headless", action="store_true", help="Run without the launcher window, for integration tests.")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--no-update-check", action="store_true", help="Skip the public GitHub update check, for offline tests.")
    parser.add_argument("--ready-file", type=Path, help="Write local startup info for integration tests.")
    parser.add_argument("--ca-file", type=Path, help="Alternate local client CA for integration tests.")
    args = parser.parse_args(argv)
    mutex = None
    if os.name == "nt" and not args.headless:
        ctypes.windll.kernel32.CreateMutexW.restype = ctypes.c_void_p
        ctypes.windll.kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\DraftLabCompanion")
        if ctypes.windll.kernel32.GetLastError() == 183:
            ctypes.windll.user32.MessageBoxW(None, "Draft Lab is already running. Use Open Draft Lab in its launcher window.", "Draft Lab", 0)
            ctypes.windll.kernel32.CloseHandle(mutex)
            return 0
    root = resource_root()
    stop, state = threading.Event(), State()
    try:
        try:
            server = BridgeServer(("127.0.0.1", args.port), state, stop)
        except OSError:
            server = BridgeServer(("127.0.0.1", 0), state, stop)
        preferred = args.league_folder or read_settings().get("leagueFolder")
        poller = Poller(state, stop, args.ca_file or root / "companion/assets/riotgames.pem",
                        Path(preferred) if preferred else None)
        threads = [threading.Thread(target=server.serve_forever, daemon=True), threading.Thread(target=poller.run, daemon=True)]
        for thread in threads:
            thread.start()
        updates = UpdateChecker(state, stop, VERSION)
        if args.no_update_check:
            state.publish_update({"status": "disabled"})
        else:
            worker = updates.start()
            if worker is not None:
                threads.append(worker)
        if args.ready_file:
            args.ready_file.write_text(json.dumps({"url": server.launch_url, "pid": os.getpid()}), encoding="utf-8")
        if not args.no_browser:
            webbrowser.open(server.launch_url)
        try:
            if args.headless:
                stop.wait()
            else:
                launcher(server, poller, stop, updates)
        finally:
            stop.set()
            server.shutdown()
            server.server_close()
            for thread in threads:
                thread.join(timeout=6)
        return 0
    finally:
        if mutex:
            ctypes.windll.kernel32.CloseHandle(mutex)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        if os.name == "nt":
            ctypes.windll.user32.MessageBoxW(None, "Draft Lab could not start. Close any previous companion and try again.", "Draft Lab", 0x10)
        raise
