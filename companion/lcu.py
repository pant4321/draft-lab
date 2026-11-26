"""Read gameflow, champion select, and reported match roles from the local League clients."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import time
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROLES = {"top": "top", "jungle": "jungle", "middle": "middle", "mid": "middle",
         "bottom": "bottom", "bot": "bottom", "adc": "bottom", "utility": "support", "support": "support"}
READ_PATHS = frozenset(("/lol-gameflow/v1/gameflow-phase", "/lol-champ-select/v1/session"))
MATCH_PHASES = frozenset(("GameStart", "InProgress", "Reconnect"))
MATCH_ROLES = frozenset(ROLES.values())
CHAMPION_KEY = re.compile(r"game_character_displayname_([A-Za-z0-9]+)", re.IGNORECASE)


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


def local_opener(certificate: Path):
    context = ssl.create_default_context(cafile=str(certificate))
    # Riot's certificates do not provide a loopback hostname SAN.
    context.check_hostname = False
    return build_opener(ProxyHandler({}), NoRedirects(), HTTPSHandler(context=context))


class LeagueClient:
    def __init__(self, credentials: Credentials, certificate: Path):
        self.credentials = credentials
        self.opener = local_opener(certificate)

    def get(self, path: str):
        if path not in READ_PATHS:
            raise ValueError("This companion only reads gameflow and champion select.")
        auth = base64.b64encode(("riot:" + self.credentials.password).encode()).decode()
        request = Request(f"https://127.0.0.1:{self.credentials.port}{path}",
                          headers={"Authorization": "Basic " + auth, "Accept": "application/json"}, method="GET")
        with self.opener.open(request, timeout=2) as response:
            return json.load(response)


class LiveGameClient:
    def __init__(self, certificate: Path):
        self.opener = local_opener(certificate)

    def read(self):
        def get(resource):
            url = f"https://127.0.0.1:2999/liveclientdata/{resource}"
            with self.opener.open(url, timeout=2) as response:
                return json.load(response)

        stats = get("gamestats")
        if not isinstance(stats, dict) or not stats.get("mapNumber") or not stats.get("gameMode"):
            return None, False
        if stats.get("mapNumber") != 11 or stats.get("gameMode") != "CLASSIC":
            return None, True
        match = normalize_match(get("playerlist"), get("activeplayername"))
        # Give the game time to report positions. Some queues never assign them.
        game_time = stats.get("gameTime")
        unavailable = match is None and isinstance(game_time, (int, float)) and game_time >= 60
        return match, unavailable


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
    pick_actors = {action.get("actorCellId") for action in actions if action.get("type") == "pick"}
    allies, enemies = [], []
    player_role, player_champion = None, None
    for team_key, output in (("myTeam", allies), ("theirTeam", enemies)):
        for player in session.get(team_key, []):
            cell = player.get("cellId")
            role = ROLES.get(str(player.get("assignedPosition", "")).lower()) if team_key == "myTeam" else None
            champion = positive_id(player.get("championId"))
            # Custom-game bots have selected roster champions but no pick actions.
            selected = cell in locked or bool(session.get("isCustomGame") and cell not in pick_actors)
            if team_key == "myTeam" and cell == local_cell:
                player_role = role
                player_champion = champion if selected else None
                continue
            # The roster reflects champion trades, while completed actions establish lock-in.
            if champion and selected:
                output.append({"id": champion, "role": role})
    if player_role is None:
        teammate_roles = {ROLES.get(str(player.get("assignedPosition", "")).lower())
                          for player in session.get("myTeam", []) if player.get("cellId") != local_cell}
        remaining = set(ROLES.values()) - teammate_roles
        if len(remaining) == 1:
            player_role = remaining.pop()
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


def normalize_match(players, active_name):
    """Keep champion keys and roles only, after resolving the local player in memory."""
    if not isinstance(players, list) or len(players) != 10 or not isinstance(active_name, str) or not active_name:
        return None
    teams = {"ORDER": [], "CHAOS": []}
    keys = set()
    player, player_team = None, None
    for entry in players:
        if not isinstance(entry, dict):
            return None
        team = str(entry.get("team"))
        role = ROLES.get(str(entry.get("position", "")).lower())
        champion = CHAMPION_KEY.fullmatch(str(entry.get("rawChampionName", "")))
        if team not in teams or role is None or champion is None:
            return None
        key = champion[1].lower()
        if key in keys:
            return None
        keys.add(key)
        pick = {"key": key, "role": role}
        teams[team].append(pick)
        if active_name in (entry.get("riotId"), entry.get("summonerName")):
            if player is not None:
                return None
            player, player_team = pick, team
    if player is None or any({pick["role"] for pick in picks} != MATCH_ROLES for picks in teams.values()):
        return None
    enemy_team = "ORDER" if player_team == "CHAOS" else "CHAOS"
    return {"phase": "game", "player": player,
            "allies": [pick for pick in teams[player_team] if pick is not player],
            "enemies": teams[enemy_team]}


class Poller:
    def __init__(self, state, stop, certificate: Path, preferred=None, interval=1):
        self.state, self.stop, self.certificate = state, stop, certificate
        self.preferred, self.interval = preferred, interval
        self.active_folder = preferred
        self.lockfile = None
        self.client = None
        self.live_game = None
        self.next_search = 0
        self.session_number = 0
        self.clear_session()

    def clear_session(self):
        self.session_id = None
        self.draft_bans = []
        self.match_snapshot = None
        self.match_unavailable = False

    def ensure_session(self, pid):
        if self.session_id is None:
            self.session_number += 1
            self.session_id = f"{pid}:{self.session_number}"

    def publish_match(self, pid):
        if self.match_snapshot is None and not self.match_unavailable:
            try:
                if self.live_game is None:
                    self.live_game = LiveGameClient(self.certificate)
                match, self.match_unavailable = self.live_game.read()
                if match is not None:
                    self.ensure_session(pid)
                    self.match_snapshot = {**match, "sessionId": self.session_id, "bans": self.draft_bans}
            except (OSError, ValueError):
                # The game API starts separately from the League client.
                pass
        if self.match_unavailable:
            self.state.publish("connected", "Match in progress", None)
        elif self.match_snapshot is None:
            self.state.publish("in_game", "Waiting for match roles", None)
        else:
            self.state.publish("in_game", "Match roles synced", self.match_snapshot)

    def tick(self):
        preferred = self.preferred
        if preferred != self.active_folder:
            self.active_folder = preferred
            self.lockfile = self.client = None
            self.next_search = 0
            self.clear_session()
        if self.lockfile is None or not self.lockfile.is_file():
            self.lockfile = None
            if time.monotonic() >= self.next_search:
                self.lockfile = find_lockfile(preferred)
                self.next_search = time.monotonic() + 5
            if self.lockfile is None:
                self.client = None
                self.clear_session()
                self.state.publish("waiting_client", "Waiting for League", None)
                return
        try:
            credentials = Credentials.read(self.lockfile)
            if self.client is None or self.client.credentials != credentials:
                if self.session_id is not None and not self.session_id.startswith(f"{credentials.pid}:"):
                    self.clear_session()
                self.client = LeagueClient(credentials, self.certificate)
            phase = self.client.get("/lol-gameflow/v1/gameflow-phase")
            if phase in MATCH_PHASES:
                self.publish_match(credentials.pid)
                return
            if phase != "ChampSelect":
                self.clear_session()
                self.state.publish("connected", "Waiting for champion select", None)
                return
            if self.match_snapshot is not None or self.match_unavailable:
                self.clear_session()
            raw = self.client.get("/lol-champ-select/v1/session")
            if raw.get("allowRerolling") or raw.get("benchEnabled") or not any(
                    player.get("cellId") == raw.get("localPlayerCellId") for player in raw.get("myTeam", [])):
                self.clear_session()
                self.state.publish("unsupported_draft", "Role-based Summoner's Rift drafts only", None)
                return
            self.ensure_session(credentials.pid)
            snapshot = normalize_session(raw)
            self.draft_bans = snapshot["bans"]
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
