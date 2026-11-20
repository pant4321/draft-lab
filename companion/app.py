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
import time
from urllib.parse import urlsplit, urlencode
import webbrowser

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.lcu import Poller
from companion.pairing import LIVE_ORIGINS, PAIRING_PORTS, PendingPairings, allowed_origin
from companion.updates import UpdateChecker
from companion.windows_launch import WindowsActivation, parse_activation_args

VERSION = "0.1.11"
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

    def __init__(self, address, state, stop, *, activation=None):
        if address[0] != "127.0.0.1":
            raise ValueError("The bridge must bind only to loopback.")
        super().__init__(address, BridgeHandler)
        self.state, self.stop = state, stop
        self.activation = activation
        self.lifecycle = threading.Lock()
        self.session_token = secrets.token_urlsafe(32)
        self.pairings = PendingPairings(settings_path().parent / "pairing")
        self.paired_tokens = {}
        self.reconnect_keys = {}

    def request_stop(self, acknowledge=None):
        with self.lifecycle:
            if self.activation is not None:
                self.activation.mark_stopping()
            try:
                if acknowledge is not None:
                    acknowledge()
            finally:
                self.stop.set()

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
        origin = self.headers.get("Origin")
        if self.host_allowed() and allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def host_allowed(self):
        expected = urlsplit(self.server.origin).netloc
        return (self.headers.get("Host") == expected
                and allowed_origin(self.headers.get("Origin", self.server.origin)))

    def authorized(self):
        if not self.host_allowed():
            return False
        origin = self.headers.get("Origin", self.server.origin)
        token = self.headers.get("X-DraftLab-Session", "").encode()
        if origin in (self.server.origin, *LIVE_ORIGINS) and secrets.compare_digest(token, self.server.session_token.encode()):
            return True
        expected = self.server.paired_tokens.get(origin)
        return expected is not None and secrets.compare_digest(token, expected.encode())

    def do_OPTIONS(self):
        path = urlsplit(self.path).path
        routes = {"/api/state": ("GET", "X-DraftLab-Session"),
                  "/api/quit": ("POST", "X-DraftLab-Session"),
                  "/api/pair": ("POST", "X-DraftLab-Pairing"),
                  "/api/reconnect": ("POST", "X-DraftLab-Reconnect")}
        expected, header = routes.get(path, ("", ""))
        headers = {item.strip().lower() for item in self.headers.get("Access-Control-Request-Headers", "").split(",") if item.strip()}
        if (not self.host_allowed() or not allowed_origin(self.headers.get("Origin")) or not expected
                or self.headers.get("Access-Control-Request-Method") != expected or headers != {header.lower()}):
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", expected)
        self.send_header("Access-Control-Allow-Headers", header)
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
        url = urlsplit(self.path)
        if url.path == "/api/state":
            if not self.authorized():
                self.send_json({"error": "Local companion session required."}, 403)
            else:
                state = self.server.state.read()
                origin = self.headers.get("Origin")
                # An authenticated browser can request a separate, process-lifetime key.
                if url.query == "remember=1" and allowed_origin(origin) and not self.server.stop.is_set():
                    state["reconnectKey"] = self.server.reconnect_keys.setdefault(origin, secrets.token_urlsafe(32))
                self.send_json(state)
            return
        self.send_error(404)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path == "/api/pair":
            origin = self.headers.get("Origin")
            if not self.host_allowed() or not allowed_origin(origin):
                self.send_error(403)
                return
            ticket = self.headers.get("X-DraftLab-Pairing", "")
            with self.server.lifecycle:
                if self.server.stop.is_set():
                    self.send_error(503)
                    return
                if not self.server.pairings.claim(origin, self.server.server_port, ticket):
                    self.send_error(404)
                    return
                token = self.server.paired_tokens.setdefault(origin, secrets.token_urlsafe(32))
            self.send_json({"token": token, "port": self.server.server_port})
            return
        if path == "/api/reconnect":
            origin = self.headers.get("Origin")
            key = self.headers.get("X-DraftLab-Reconnect", "").encode()
            with self.server.lifecycle:
                expected = self.server.reconnect_keys.get(origin)
                if (not self.host_allowed() or self.server.stop.is_set() or expected is None
                        or not secrets.compare_digest(key, expected.encode())):
                    self.send_json({"error": "Companion pairing required."}, 403)
                    return
                token = self.server.paired_tokens.setdefault(origin, secrets.token_urlsafe(32))
            self.send_json({"token": token, "port": self.server.server_port})
            return
        if not self.authorized():
            self.send_json({"error": "Local companion session required."}, 403)
            return
        if path != "/api/quit":
            self.send_error(404)
            return
        self.server.request_stop(lambda: self.send_json({"stopping": True}))


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


def launcher(server, poller, stop, updates, title="DraftEdge Companion", *, activation=None):
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
    tk.Label(window, text="DRAFTEDGE", bg="#101719", fg="#b2e7c3", font=("Segoe UI", 19, "bold")).pack(pady=(22, 8))
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

    ttk.Button(buttons, text="Open DraftEdge", command=lambda: webbrowser.open_new_tab(server.launch_url)).pack(side="left", padx=5)
    ttk.Button(buttons, text="League folder…", command=choose_folder).pack(side="left", padx=5)
    ttk.Button(buttons, text="Quit", command=server.request_stop).pack(side="left", padx=5)
    update_row = tk.Frame(window, bg="#101719")
    update_row.pack(fill="x", padx=24, pady=(0, 12))
    installed_version = updates.current_version
    update_message = tk.StringVar(value=f"v{installed_version} · Checking for updates…")
    tk.Label(update_row, textvariable=update_message, bg="#101719", fg="#91a6a5", font=("Segoe UI", 9)).pack(side="left")
    update_button = ttk.Button(update_row)
    last_update = None
    window.protocol("WM_DELETE_WINDOW", server.request_stop)

    def refresh():
        nonlocal last_update
        if stop.is_set():
            window.destroy()
            return
        if activation is not None and activation.requested():
            window.deiconify()
            window.lift()
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
    try:
        argv, pairing = parse_activation_args(sys.argv[1:] if argv is None else argv)
    except ValueError:
        return 2
    parser = argparse.ArgumentParser(description="Draft Lab local League companion")
    parser.add_argument("--port", type=int, default=PAIRING_PORTS[0])
    parser.add_argument("--league-folder", type=Path)
    parser.add_argument("--headless", action="store_true", help="Run without the launcher window, for integration tests.")
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-update-check", action="store_true", help="Skip the public GitHub update check, for offline tests.")
    parser.add_argument("--ready-file", type=Path, help="Write local startup info for integration tests.")
    parser.add_argument("--ca-file", type=Path, help="Alternate local client CA for integration tests.")
    args = parser.parse_args(argv)
    if pairing is not None:
        PendingPairings(settings_path().parent / "pairing").offer(*pairing)
    if os.name == "nt" and not args.headless:
        deadline = time.monotonic() + 5
        while True:
            with WindowsActivation() as activation:
                if activation.primary:
                    return run(args, activation)
                if activation.can_forward() and (pairing is not None or activation.notify()):
                    return 0
            # Drop our handle between attempts so the retiring instance can release the mutex.
            if time.monotonic() >= deadline:
                if pairing is None:
                    ctypes.windll.user32.MessageBoxW(
                        None, "Close the running companion before reopening DraftEdge Companion.",
                        "DraftEdge Companion", 0)
                return 1
            time.sleep(.05)
    return run(args)


def run(args, activation=None):
    root = resource_root()
    stop, state = threading.Event(), State()
    ports = PAIRING_PORTS if args.port == PAIRING_PORTS[0] else (args.port,)
    for port in (*ports, 0):
        try:
            server = BridgeServer(("127.0.0.1", port), state, stop, activation=activation)
            break
        except OSError:
            if port == 0:
                raise
    threads = []
    serving = None
    try:
        preferred = args.league_folder or read_settings().get("leagueFolder")
        poller = Poller(state, stop, args.ca_file or root / "companion/assets/riotgames.pem",
                        Path(preferred) if preferred else None)
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        polling = threading.Thread(target=poller.run, daemon=True)
        polling.start()
        threads.append(polling)
        updates = UpdateChecker(state, stop, VERSION)
        if args.no_update_check:
            state.publish_update({"status": "disabled"})
        else:
            worker = updates.start()
            if worker is not None:
                threads.append(worker)
        if args.ready_file:
            args.ready_file.write_text(json.dumps({"url": server.launch_url, "pid": os.getpid()}), encoding="utf-8")
        if args.headless:
            stop.wait()
        else:
            launcher(server, poller, stop, updates, activation=activation)
        return 0
    finally:
        server.request_stop()
        if serving is not None and serving.is_alive():
            server.shutdown()
            serving.join(timeout=6)
        server.server_close()
        if activation is not None:
            activation.close()
        for thread in threads:
            thread.join(timeout=6)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        if os.name == "nt":
            ctypes.windll.user32.MessageBoxW(None, "Draft Lab could not start. Close any previous companion and try again.", "Draft Lab", 0x10)
        raise
