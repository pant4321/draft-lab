"""Single-file Windows launcher and authenticated loopback bridge."""
from __future__ import annotations

import argparse
import ctypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
import threading
from urllib.parse import urlsplit
import webbrowser

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.lcu import Poller

VERSION = "0.1.1"


class State:
    def __init__(self):
        self.lock = threading.Lock()
        self.value = {"status": "starting", "message": "Starting companion", "snapshot": None,
                      "revision": 0, "companionVersion": VERSION}

    def publish(self, status, message, snapshot):
        with self.lock:
            if (status, message, snapshot) != (self.value["status"], self.value["message"], self.value["snapshot"]):
                self.value.update(status=status, message=message, snapshot=snapshot, revision=self.value["revision"] + 1)

    def read(self):
        with self.lock:
            return dict(self.value)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, web_root, state, stop):
        super().__init__(address, partial(BridgeHandler, directory=str(web_root)))
        self.state, self.stop, self.web_root = state, stop, web_root
        self.session_token = secrets.token_urlsafe(32)

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server_port}"

    @property
    def launch_url(self):
        return self.origin + "/#companion=" + self.session_token


class BridgeHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Do not log headers, local session tokens, or client data.

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def host_allowed(self):
        expected = urlsplit(self.server.origin).netloc
        return self.headers.get("Host") == expected and self.headers.get("Origin", self.server.origin) == self.server.origin

    def authorized(self):
        return self.host_allowed() and secrets.compare_digest(self.headers.get("X-DraftLab-Session", ""), self.server.session_token)

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
        candidate = Path(self.translate_path(self.path)).resolve()
        root = self.server.web_root.resolve()
        if not candidate.is_relative_to(root) or candidate.is_dir() and not (candidate / "index.html").is_file():
            self.send_error(404)
            return
        # Windows' default MIME mapping does not consistently recognize .mjs.
        super().do_GET()

    def guess_type(self, path):
        return "text/javascript" if str(path).endswith(".mjs") else super().guess_type(path)

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


def launcher(server, poller, stop):
    import tkinter as tk
    from tkinter import filedialog, ttk
    window = tk.Tk()
    window.title("Draft Lab Companion")
    window.geometry("460x245")
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
    window.protocol("WM_DELETE_WINDOW", stop.set)

    def refresh():
        if stop.is_set():
            window.destroy()
            return
        message.set(server.state.read()["message"])
        window.after(300, refresh)

    refresh()
    window.mainloop()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Draft Lab local League companion")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--league-folder", type=Path)
    parser.add_argument("--headless", action="store_true", help="Run without the launcher window, for integration tests.")
    parser.add_argument("--no-browser", action="store_true")
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
    web_root = root / ("web" if getattr(sys, "frozen", False) else "dist")
    stop, state = threading.Event(), State()
    try:
        try:
            server = BridgeServer(("127.0.0.1", args.port), web_root, state, stop)
        except OSError:
            server = BridgeServer(("127.0.0.1", 0), web_root, state, stop)
        preferred = args.league_folder or read_settings().get("leagueFolder")
        poller = Poller(state, stop, args.ca_file or root / "companion/assets/riotgames.pem",
                        Path(preferred) if preferred else None)
        threads = [threading.Thread(target=server.serve_forever, daemon=True), threading.Thread(target=poller.run, daemon=True)]
        for thread in threads:
            thread.start()
        if args.ready_file:
            args.ready_file.write_text(json.dumps({"url": server.launch_url, "pid": os.getpid()}), encoding="utf-8")
        if not args.no_browser:
            webbrowser.open(server.launch_url)
        try:
            if args.headless:
                stop.wait()
            else:
                launcher(server, poller, stop)
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
