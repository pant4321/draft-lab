"""Read only the local League client's gameflow and champion-select session."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import ssl
import subprocess
import time
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROLES = {"top": "top", "jungle": "jungle", "middle": "middle", "mid": "middle",
         "bottom": "bottom", "bot": "bottom", "adc": "bottom", "utility": "support", "support": "support"}
READ_PATHS = frozenset(("/lol-gameflow/v1/gameflow-phase", "/lol-champ-select/v1/session"))


@dataclass(frozen=True)
class Credentials:
    port: int
    password: str = field(repr=False)
    pid: int = 0

    @classmethod
    def read(cls, path: Path) -> "Credentials":
        parts = path.read_text(encoding="utf-8").strip().split(":")
        if len(parts) != 5 or parts[4] != "https":
            raise ValueError("Invalid League lockfile format.")
        _, pid, port, password, _ = parts
        if not 1 <= int(port) <= 65535 or not password or int(pid) <= 0:
            raise ValueError("Invalid League lockfile values.")
        return cls(int(port), password, int(pid))


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LeagueClient:
    def __init__(self, credentials: Credentials, certificate: Path):
        self.credentials = credentials
        context = ssl.create_default_context(cafile=str(certificate))
        # Riot's local certificate does not provide a loopback hostname SAN.
        # Verify the certificate chain against Riot's bundled CA on fixed 127.0.0.1.
        context.check_hostname = False
        self.opener = build_opener(ProxyHandler({}), NoRedirects(), HTTPSHandler(context=context))

    def get(self, path: str):
        if path not in READ_PATHS:
            raise ValueError("This companion only reads gameflow and champion select.")
        auth = base64.b64encode(("riot:" + self.credentials.password).encode()).decode()
        request = Request(f"https://127.0.0.1:{self.credentials.port}{path}",
                          headers={"Authorization": "Basic " + auth, "Accept": "application/json"}, method="GET")
        with self.opener.open(request, timeout=2) as response:
            return json.load(response)


def find_lockfile(preferred: Path | None = None, *, inspect_process=True) -> Path | None:
    candidates = []
    if preferred:
        candidates += [preferred, preferred / "lockfile", preferred.parent / "lockfile"]
    for drive in "CDEFG":
        candidates.append(Path(f"{drive}:/Riot Games/League of Legends/lockfile"))
    for path in candidates:
        if path.is_file() and path.name == "lockfile":
            return path
    if inspect_process and os.name == "nt":
        command = ("Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" "
                   "| Select-Object -ExpandProperty ExecutablePath | ConvertTo-Json -Compress")
        try:
            result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                    capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            paths = json.loads(result.stdout or "null")
            for executable in ([paths] if isinstance(paths, str) else paths or []):
                path = Path(executable).parent / "lockfile"
                if path.is_file():
                    return path
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    return None


def positive_id(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def normalize_session(session: dict) -> dict:
    """Exclude identities and unrevealed selections; keep only draft information."""
    local_cell = session.get("localPlayerCellId")
    actions = [action for phase in session.get("actions", []) for action in phase]
    locked = {action.get("actorCellId") for action in actions
              if action.get("type") == "pick" and action.get("completed") is True}
    allies, enemies = [], []
    player_role, player_champion = None, None
    for team_key, output in (("myTeam", allies), ("theirTeam", enemies)):
        for player in session.get(team_key, []):
            cell = player.get("cellId")
            role = ROLES.get(str(player.get("assignedPosition", "")).lower()) if team_key == "myTeam" else None
            champion = positive_id(player.get("championId"))
            if team_key == "myTeam" and cell == local_cell:
                player_role = role
                player_champion = champion if cell in locked else None
                continue
            # The roster reflects champion trades, while completed actions establish lock-in.
            if champion and cell in locked:
                output.append({"id": champion, "role": role})
    bans = []
    for key in ("myTeamBans", "theirTeamBans"):
        for value in session.get("bans", {}).get(key, []):
            champion = positive_id(value)
            if champion and champion not in bans:
                bans.append(champion)
    for action in actions:
        champion = positive_id(action.get("championId"))
        if action.get("type") == "ban" and action.get("completed") is True and champion and champion not in bans:
            bans.append(champion)
    return {"playerRole": player_role, "playerChampion": player_champion,
            "allies": allies[:4], "enemies": enemies[:5], "bans": bans}


class Poller:
    def __init__(self, state, stop, certificate: Path, preferred=None, interval=1):
        self.state, self.stop, self.certificate = state, stop, certificate
        self.preferred, self.interval = preferred, interval
        self.lockfile = None
        self.client = None
        self.next_search = 0
        self.session_number = 0
        self.session_id = None

    def tick(self):
        if self.lockfile is None or not self.lockfile.is_file():
            self.lockfile = None
            if time.monotonic() >= self.next_search:
                self.lockfile = find_lockfile(self.preferred)
                self.next_search = time.monotonic() + 5
            if self.lockfile is None:
                self.client = None
                self.state.publish("waiting_client", "Waiting for League", None)
                return
        try:
            credentials = Credentials.read(self.lockfile)
            if self.client is None or self.client.credentials != credentials:
                if self.client is not None and self.client.credentials.pid != credentials.pid:
                    self.session_id = None
                self.client = LeagueClient(credentials, self.certificate)
            phase = self.client.get("/lol-gameflow/v1/gameflow-phase")
            if phase != "ChampSelect":
                self.session_id = None
                message = "Match in progress" if phase in ("InProgress", "GameStart", "Reconnect") else "Waiting for champion select"
                self.state.publish("connected", message, None)
                return
            raw = self.client.get("/lol-champ-select/v1/session")
            if raw.get("allowRerolling") or raw.get("benchEnabled") or not any(
                    player.get("cellId") == raw.get("localPlayerCellId") for player in raw.get("myTeam", [])):
                self.session_id = None
                self.state.publish("unsupported_draft", "Role-based Summoner's Rift drafts only", None)
                return
            if self.session_id is None:
                self.session_number += 1
                self.session_id = f"{credentials.pid}:{self.session_number}"
            snapshot = normalize_session(raw)
            snapshot["sessionId"] = self.session_id
            self.state.publish("champ_select", "Champion select connected", snapshot)
        except ssl.SSLError:
            self.state.publish("connection_error", "League certificate could not be verified", None)
        except Exception:
            # Network exceptions can include authentication context. Never expose their text.
            self.client = None
            self.state.publish("reconnecting", "Reconnecting to League", None)

    def run(self):
        while not self.stop.is_set():
            self.tick()
            self.stop.wait(self.interval)
