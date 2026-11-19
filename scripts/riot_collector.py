"""Collect a private sample of NA ranked solo/duo matches via the Riot API."""

import argparse
from contextlib import closing
import json
import logging
import os
from pathlib import Path
import random
import re
import signal
import sqlite3
from threading import Event
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


QUEUE = 420
TIERS = ("GOLD", "PLATINUM", "EMERALD")
DIVISIONS = ("I", "II", "III", "IV")
ROLES = {"TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"}
DAY = 86400
LOG = logging.getLogger("riot-collector")


class RiotUnavailable(Exception):
    def __init__(self, message, delay):
        super().__init__(message)
        self.delay = delay


class KeyRejected(Exception):
    pass


class Stopping(Exception):
    pass


class RiotAPI:
    def __init__(self, stopping):
        self.stopping = stopping
        self.next_request = 0.0

    def get(self, route, path, key, **query):
        # A single worker averages fewer than 100 requests per two minutes.
        if self.stopping.wait(max(0, self.next_request - time.monotonic())):
            raise Stopping
        self.next_request = time.monotonic() + 1.3
        suffix = f"?{urlencode(query)}" if query else ""
        request = Request(
            f"https://{route}.api.riotgames.com{path}{suffix}",
            headers={"User-Agent": "DraftEdge-Collector/1.0", "Accept": "application/json"},
        )
        # urllib omits this header from redirected requests.
        request.add_unredirected_header("X-Riot-Token", key)
        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as error:
            with error:
                if error.code in (401, 403):
                    raise KeyRejected from None
                if error.code == 404:
                    return None
                if error.code == 429:
                    try:
                        delay = max(1, int(error.headers.get("Retry-After", "120")))
                    except ValueError:
                        delay = 120
                    raise RiotUnavailable("Riot rate limit reached", delay) from None
                raise RiotUnavailable(f"Riot returned HTTP {error.code}", 60) from None
        except (URLError, OSError, ValueError):
            raise RiotUnavailable("Riot request or response failed", 30) from None


def open_database(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    database = sqlite3.connect(path)
    database.executescript("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS players (
            puuid TEXT PRIMARY KEY,
            next_poll INTEGER NOT NULL,
            expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS matches (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            patch TEXT,
            played_at INTEGER,
            picks TEXT,
            builds TEXT
        );
        CREATE INDEX IF NOT EXISTS pending_matches ON matches(status)
            WHERE status = 'pending';
        CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    """)
    with database:
        database.execute("BEGIN IMMEDIATE")
        columns = {column[1] for column in database.execute("PRAGMA table_info(matches)")}
        if "builds" not in columns:
            database.execute("ALTER TABLE matches ADD COLUMN builds TEXT")
    return database


def rune_record(perks):
    if not isinstance(perks, dict):
        return None
    runes = {}
    style_names = {"primaryStyle": "primary", "subStyle": "secondary"}
    styles = perks.get("styles")
    if isinstance(styles, list):
        for style in styles:
            if not isinstance(style, dict) or not isinstance(style.get("description"), str):
                continue
            name = style_names.get(style["description"])
            tree = style.get("style")
            selections = style.get("selections")
            if name is None or type(tree) is not int or tree <= 0 or not isinstance(selections, list):
                continue
            ids = [selection.get("perk") for selection in selections if isinstance(selection, dict)]
            ids = [rune for rune in ids if type(rune) is int and rune > 0]
            if ids:
                runes[name] = {"tree": tree, "ids": ids}
    stat_perks = perks.get("statPerks")
    if isinstance(stat_perks, dict):
        shards = {name: stat_perks.get(name) for name in ("offense", "flex", "defense")}
        shards = {name: shard for name, shard in shards.items() if type(shard) is int and shard > 0}
        if shards:
            runes["stat_shards"] = shards
    return runes or None


def build_record(player, team, role):
    slots = [f"item{slot}" for slot in range(7)]
    items = [player.get(slot, 0) for slot in slots]
    if not any(slot in player for slot in slots) or not all(type(item) is int and item >= 0 for item in items):
        items = None
    runes = rune_record(player.get("perks"))
    if items is None and runes is None:
        return None
    return {"team": team, "role": role, "items": items, "runes": runes}


def match_record(payload):
    """Project a complete ranked match into draft, outcome, and build data."""
    try:
        match = payload["info"]
        if match["queueId"] != QUEUE or match["gameDuration"] < 300:
            return None
        played_at = match["gameStartTimestamp"]
        if type(played_at) is not int or played_at <= 0:
            return None
        version = re.match(r"^(\d+\.\d+)(?:\.|$)", match["gameVersion"])
        if not version or len(match["participants"]) != 10:
            return None
        picks = []
        builds = []
        for player in match["participants"]:
            if player.get("gameEndedInEarlySurrender"):
                return None
            team, role, champion, won = (player[name] for name in (
                "teamId", "teamPosition", "championId", "win"
            ))
            if team not in (100, 200) or role not in ROLES:
                return None
            if type(champion) is not int or champion <= 0 or type(won) is not bool:
                return None
            picks.append((team, role, champion, won))
            build = build_record(player, team, role)
            if build is not None:
                builds.append(build)
        if len({(team, role) for team, role, _, _ in picks}) != 10:
            return None
        if len({(team, won) for team, _, _, won in picks}) != 2:
            return None
        if len({won for _, _, _, won in picks}) != 2:
            return None
        picks_json = json.dumps(sorted(picks), separators=(",", ":"))
        builds.sort(key=lambda build: (build["team"], build["role"]))
        builds_json = json.dumps(builds, separators=(",", ":")) if builds else None
        return version[1], played_at, picks_json, builds_json
    except (KeyError, AttributeError, TypeError, ValueError):
        return None


class Collector:
    def __init__(self, database, api):
        self.database = database
        self.api = api

    def refresh_sample(self, key, now):
        previous = self.database.execute(
            "SELECT value FROM settings WHERE name = 'sample_refreshed'"
        ).fetchone()
        if previous and now - previous[0] < DAY:
            return
        day = now // DAY
        rng = random.Random(day)
        players = set()
        for tier in TIERS:
            division = DIVISIONS[day % len(DIVISIONS)]
            entries = self.api.get("na1", f"/lol/league/v4/entries/RANKED_SOLO_5x5/{tier}/{division}",
                                   key, page=1 + day % 3)
            if not isinstance(entries, list):
                raise RiotUnavailable("Riot league entries returned an unexpected response", 300)
            ids = sorted({entry.get("puuid") for entry in entries if isinstance(entry, dict)
                          and valid_id(entry.get("puuid"), r"[A-Za-z0-9_-]{30,128}")})
            players.update(rng.sample(ids, min(12, len(ids))))
        if not players:
            raise RiotUnavailable("Riot league entries did not provide sample accounts", 300)
        with self.database:
            self.database.execute("DELETE FROM players WHERE expires <= ?", (now,))
            self.database.executemany("""
                INSERT INTO players VALUES (?, ?, ?)
                ON CONFLICT(puuid) DO UPDATE SET expires = excluded.expires
            """, [(player, now, now + 3 * DAY) for player in sorted(players)])
            self.database.execute("INSERT OR REPLACE INTO settings VALUES ('sample_refreshed', ?)", (now,))
        LOG.info("Refreshed sample from %s ranked accounts", len(players))

    def find_matches(self, key, now):
        players = self.database.execute("""
            SELECT puuid FROM players WHERE next_poll <= ? AND expires > ?
            ORDER BY next_poll, puuid LIMIT 3
        """, (now, now)).fetchall()
        for (player,) in players:
            path = f"/lol/match/v5/matches/by-puuid/{quote(player, safe='')}/ids"
            matches = self.api.get("americas", path, key, queue=QUEUE, count=10, startTime=now - 3 * DAY)
            if matches is not None and not isinstance(matches, list):
                raise RiotUnavailable("Riot match IDs returned an unexpected response", 60)
            match_ids = [(match_id,) for match_id in matches or [] if valid_id(match_id, r"NA1_\d+")]
            with self.database:
                self.database.executemany("INSERT OR IGNORE INTO matches (id) VALUES (?)", match_ids)
                self.database.execute("UPDATE players SET next_poll = ? WHERE puuid = ?",
                                      (now + 4 * 3600, player))
        return len(players)

    def save_matches(self, key):
        pending = self.database.execute(
            "SELECT id FROM matches WHERE status = 'pending' ORDER BY rowid LIMIT 10"
        ).fetchall()
        for (match_id,) in pending:
            response = self.api.get("americas", f"/lol/match/v5/matches/{quote(match_id, safe='')}", key)
            record = match_record(response)
            with self.database:
                if record is None:
                    self.database.execute("UPDATE matches SET status = 'skipped' WHERE id = ?", (match_id,))
                else:
                    self.database.execute("""
                        UPDATE matches
                        SET status = 'saved', patch = ?, played_at = ?, picks = ?, builds = ?
                        WHERE id = ?
                    """, (*record, match_id))
        return len(pending)


def valid_id(value, pattern):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def summary(database):
    counts = dict(database.execute("SELECT status, count(*) FROM matches GROUP BY status"))
    patches = dict(database.execute("SELECT patch, count(*) FROM matches WHERE status = 'saved' GROUP BY patch"))
    with_builds, = database.execute("SELECT count(builds) FROM matches WHERE status = 'saved'").fetchone()
    return {"saved": counts.get("saved", 0), "pending": counts.get("pending", 0),
            "skipped": counts.get("skipped", 0), "saved_by_patch": patches, "saved_with_builds": with_builds}


def read_key(path):
    try:
        key = path.read_text(encoding="utf-8-sig").strip()
    except (OSError, UnicodeError):
        return None
    return key if valid_id(key, r"RGAPI-[A-Za-z0-9-]{10,100}") else None


def run(database, key_path, stopping):
    collector = Collector(database, RiotAPI(stopping))
    LOG.info("Collector ready. NA ranked solo/duo, private SQLite storage.")
    rejected_key = None
    waiting_for_key = False
    report_at = 0
    while not stopping.is_set():
        key = read_key(key_path)
        if not key or key == rejected_key:
            if not waiting_for_key:
                LOG.info("Waiting for a valid Riot API key in %s", key_path.name)
                waiting_for_key = True
            stopping.wait(15)
            continue
        waiting_for_key = False
        now = int(time.time())
        try:
            collector.refresh_sample(key, now)
            players = collector.find_matches(key, now)
            matches = collector.save_matches(key)
        except KeyRejected:
            rejected_key = key
            LOG.warning("Riot rejected the API key. Waiting for a replacement.")
            continue
        except RiotUnavailable as error:
            LOG.warning("%s. Retrying in %s seconds.", error, error.delay)
            stopping.wait(error.delay)
            continue
        except Stopping:
            break
        if now >= report_at:
            LOG.info("Match totals %s", json.dumps(summary(database), sort_keys=True))
            report_at = now + 300
        if not players and not matches:
            stopping.wait(30)
    LOG.info("Collector stopped.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/matches.sqlite3"))
    parser.add_argument("--key-file", type=Path, default=Path("riot-api-key.txt"))
    parser.add_argument("--summary", action="store_true", help="print aggregate counts without querying Riot")
    args = parser.parse_args()
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    logging.Formatter.converter = time.gmtime
    with closing(open_database(args.database)) as database:
        if args.summary:
            print(json.dumps(summary(database), sort_keys=True))
            return
        stopping = Event()
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, lambda *_: stopping.set())
        run(database, args.key_file, stopping)


if __name__ == "__main__":
    main()
