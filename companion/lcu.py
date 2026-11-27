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
from threading import Lock
import time
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from companion.loadout import LoadoutSelection, SpellImportError, current_spells, flash_position, order_spells
from companion.rune_import import (
    DraftChanged, RuneImportError, TEMPORARY_PAGE_NAME, active_rune_page, is_recommended_page,
    owned_temporary_page, rune_payload, select_temporary_runes, selected_temporary_page,
)

ROLES = {"top": "top", "jungle": "jungle", "middle": "middle", "mid": "middle",
         "bottom": "bottom", "bot": "bottom", "adc": "bottom", "utility": "support", "support": "support"}
READ_PATHS = frozenset(("/lol-gameflow/v1/gameflow-phase", "/lol-champ-select/v1/session",
                        "/lol-perks/v1/styles", "/lol-perks/v1/pages", "/lol-perks/v1/currentpage"))
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
            raise ValueError("Unsupported League client read.")
        return self._request("GET", path)

    def _request(self, method, path, payload=None):
        auth = base64.b64encode(("riot:" + self.credentials.password).encode()).decode()
        headers = {"Authorization": "Basic " + auth, "Accept": "application/json"}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode()
        request = Request(f"https://127.0.0.1:{self.credentials.port}{path}",
                          headers=headers, data=data, method=method)
        with self.opener.open(request, timeout=2) as response:
            body = response.read()
            return json.loads(body) if body else None

    def save_temporary_runes(self, runes, page_id=None):
        payload = {**runes, "name": TEMPORARY_PAGE_NAME,
                   "isTemporary": True, "isEditable": True, "current": True}
        if page_id is None:
            return self._request("POST", "/lol-perks/v1/pages", payload)
        path = f"/lol-perks/v1/pages/{page_id:d}"
        page = self._request("GET", path)
        if not owned_temporary_page(page) or page["id"] != page_id:
            raise RuneImportError("League's temporary page changed. Try applying the runes again.")
        self._request("PUT", path, {**payload, "id": page_id})
        return self._request("GET", path)

    def select_rune_page(self, page_id):
        return self._request("PUT", "/lol-perks/v1/currentpage", page_id)

    def select_summoner_spells(self, spells):
        return self._request("PATCH", "/lol-champ-select/v1/session/my-selection",
                             dict(zip(("spell1Id", "spell2Id"), spells, strict=True)))


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


def draft_player(session):
    cell = session.get("localPlayerCellId")
    if type(cell) is not int or cell < 0:
        return None
    return next((player for player in session.get("myTeam", []) if player.get("cellId") == cell), None)


def draft_player_champion(session, player):
    champion = positive_id(player.get("championId"))
    if champion is not None:
        return champion
    for phase in reversed(session.get("actions", [])):
        for action in phase:
            if action.get("type") == "pick" and action.get("actorCellId") == player.get("cellId"):
                champion = positive_id(action.get("championId"))
                if champion is not None:
                    return champion
    return positive_id(player.get("championPickIntent"))


def is_finalizing(draft):
    return (draft.get("timer") or {}).get("phase") == "FINALIZATION"


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
        self.loadout_lock = Lock()
        self.next_search = 0
        self.session_number = 0
        self.clear_session()

    def clear_session(self):
        self.session_id = None
        self.draft_game_id = None
        self.draft_bans = []
        self.match_snapshot = None
        self.match_unavailable = False
        self.pending_runes = None

    def ensure_session(self, pid):
        if self.session_id is None:
            self.session_number += 1
            self.session_id = f"{pid}:{self.session_number}"

    def verify_loadout_draft(self, client, session_id, game_id):
        draft_context = self.state.read()["champSelect"]
        if (self.stop.is_set() or client is None or self.client is not client
                or not draft_context or draft_context["sessionId"] != session_id
                or client.get("/lol-gameflow/v1/gameflow-phase") != "ChampSelect"):
            raise DraftChanged("Return to champion select and try again.")
        draft = client.get("/lol-champ-select/v1/session")
        if (not isinstance(draft, dict) or (draft.get("timer") or {}).get("phase") == "GAME_STARTING"
                or (game_id is not None and game_id != positive_id(draft.get("gameId")))):
            raise DraftChanged("Return to champion select and try again.")
        return draft

    def apply_runes(self, selection):
        self.apply_loadout(LoadoutSelection(selection.session_id, selection, None, None))

    def apply_loadout(self, selection):
        with self.loadout_lock:
            client, game_id = self.client, self.draft_game_id

            def verify_draft():
                return self.verify_loadout_draft(client, selection.session_id, game_id)

            draft = verify_draft()
            player = draft_player(draft)
            if selection.spells and player is None:
                raise SpellImportError("League's summoner spell slots are unavailable.")
            if selection.runes:
                champion = draft_player_champion(draft, player) if player is not None else None
                payload = rune_payload(selection.runes, client.get("/lol-perks/v1/styles"))
                self.apply_rune_page(client, selection.session_id, game_id, champion, payload, verify_draft)
            if selection.spells:
                try:
                    self.apply_spells(client, selection, verify_draft)
                except (DraftChanged, OSError, ValueError, SpellImportError) as error:
                    if selection.runes:
                        raise SpellImportError("Runes applied. League could not verify the summoner spells.") from error
                    if isinstance(error, DraftChanged):
                        raise
                    raise SpellImportError("League could not verify the summoner spells.") from error

    def apply_spells(self, client, selection, verify_draft):
        player = draft_player(verify_draft())
        if player is None:
            raise SpellImportError("League's summoner spell slots are unavailable.")
        current = current_spells(player)
        chosen = order_spells(selection.spells, selection.flash_position or flash_position(current))
        if current == chosen:
            return
        client.select_summoner_spells(chosen)
        for _ in range(3):
            player = draft_player(verify_draft())
            if player is not None and current_spells(player) == chosen:
                return
            if self.stop.wait(0.15):
                break
        raise SpellImportError("League could not verify the summoner spells.")

    def apply_rune_page(self, client, session_id, game_id, champion, payload, verify_draft):
        self.pending_runes = None
        page_id = select_temporary_runes(client, payload, verify_draft)
        active = active_rune_page(client)
        if selected_temporary_page(active, page_id, payload):
            if champion is not None:
                self.pending_runes = (session_id, client, game_id, champion, page_id, payload)
            return
        if is_recommended_page(active, champion) and is_finalizing(verify_draft()):
            page_id = self.restore_runes(client, session_id, game_id, champion, payload)
            if selected_temporary_page(active_rune_page(client), page_id, payload):
                return
        raise RuneImportError("League switched away from the DraftEdge runes. Check the active page in League.")

    def restore_runes(self, client, session_id, game_id, champion, payload):
        def verify_countdown():
            draft = self.verify_loadout_draft(client, session_id, game_id)
            player = draft_player(draft)
            if (not is_finalizing(draft) or player is None
                    or draft_player_champion(draft, player) != champion):
                raise DraftChanged("Return to champion select and try again.")

        verify_countdown()
        return select_temporary_runes(client, payload, verify_countdown)

    def watch_rune_import(self, draft, champion):
        if self.pending_runes is None or not self.loadout_lock.acquire(blocking=False):
            return
        try:
            if self.pending_runes is None:
                return
            session_id, client, game_id, target, page_id, payload = self.pending_runes
            if (self.session_id != session_id or self.client is not client or champion != target):
                self.pending_runes = None
                return
            active = client.get("/lol-perks/v1/currentpage")
            if selected_temporary_page(active, page_id, payload):
                return
            self.pending_runes = None
            if is_finalizing(draft) and is_recommended_page(active, target):
                self.restore_runes(client, session_id, game_id, target, payload)
        except (OSError, ValueError, RuneImportError):
            # Any write still requires the same active draft and countdown.
            self.pending_runes = None
        finally:
            self.loadout_lock.release()

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
                self.pending_runes = None
                self.publish_match(credentials.pid)
                return
            if phase != "ChampSelect":
                self.clear_session()
                self.state.publish("connected", "Waiting for champion select", None)
                return
            if self.match_snapshot is not None or self.match_unavailable:
                self.clear_session()
            raw = self.client.get("/lol-champ-select/v1/session")
            game_id = positive_id(raw.get("gameId"))
            if self.draft_game_id is not None and game_id is not None and self.draft_game_id != game_id:
                self.clear_session()
            self.draft_game_id = game_id
            self.ensure_session(credentials.pid)
            own = draft_player(raw)
            champ_select = {
                "sessionId": self.session_id,
                "championId": draft_player_champion(raw, own) if own is not None else None,
                "role": ROLES.get(str(own.get("assignedPosition", "")).lower()) if own is not None else None,
                "flashPosition": flash_position(current_spells(own)) if own is not None else None,
            }
            self.watch_rune_import(raw, champ_select["championId"])
            if own is None or raw.get("allowRerolling") or raw.get("benchEnabled"):
                self.state.publish("unsupported_draft", "Role-based Summoner's Rift drafts only", None,
                                   champ_select=champ_select)
                return
            snapshot = normalize_session(raw)
            self.draft_bans = snapshot["bans"]
            snapshot["sessionId"] = self.session_id
            self.state.publish("champ_select", "Champion select connected", snapshot, champ_select=champ_select)
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
