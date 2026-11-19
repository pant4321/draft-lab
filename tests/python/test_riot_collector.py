from contextlib import closing
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
from threading import Event
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from scripts import riot_collector as riot


def fixture_match():
    return {"info": {
        "queueId": 420,
        "gameDuration": 1500,
        "gameStartTimestamp": 1795000000000,
        "gameVersion": "16.23.123.456",
        "participants": [
            {"teamId": team, "teamPosition": role, "championId": index + 1,
             "win": team == 100, "riotIdGameName": "private-player", "puuid": "private-puuid",
             "item0": 3006, "item6": 3340, "perks": {
                 "styles": [
                     {"description": "subStyle", "style": 8300, "selections": [{"perk": 8304}, {"perk": 8347}]},
                     {"description": "primaryStyle", "style": 8000, "selections": [{"perk": 8005, "var1": 3}]},
                 ],
                 "statPerks": {"offense": 5005, "flex": 5008, "defense": 5011},
             }}
            for team in (100, 200) for index, role in enumerate(sorted(riot.ROLES))
        ],
    }}


class CollectorTests(unittest.TestCase):
    def test_resume_deduplicates_matches_and_persists_only_draft_fields(self):
        class API:
            unavailable = True

            def get(self, route, path, key, **query):
                if path.endswith("/ids"):
                    return ["NA1_123", "NA1_123"]
                if self.unavailable:
                    raise riot.RiotUnavailable("offline", 30)
                return fixture_match()

        api = API()
        with tempfile.TemporaryDirectory() as temp:
            database_path = Path(temp) / "matches.sqlite3"
            with closing(riot.open_database(database_path)) as db:
                with db:
                    db.executemany("INSERT INTO players VALUES (?, ?, ?)", [("a", 0, 2000), ("b", 0, 2000)])
                collector = riot.Collector(db, api)
                self.assertEqual(collector.find_matches("test-key", 1000), 2)
                with self.assertRaises(riot.RiotUnavailable):
                    collector.save_matches("test-key")
                self.assertEqual(riot.summary(db)["pending"], 1)

            api.unavailable = False
            with closing(riot.open_database(database_path)) as db:
                collector = riot.Collector(db, api)
                self.assertEqual(collector.find_matches("test-key", 1001), 0)
                self.assertEqual(collector.save_matches("test-key"), 1)
                self.assertEqual(collector.save_matches("test-key"), 0)
                self.assertEqual(riot.summary(db)["saved_by_patch"], {"16.23": 1})
                self.assertEqual(riot.summary(db)["saved_with_builds"], 1)
                picks, builds = db.execute("SELECT picks, builds FROM matches").fetchone()
                self.assertEqual(len(json.loads(picks)), 10)
                self.assertNotIn("private-", picks + builds)
                rows = json.loads(builds)
                self.assertEqual(len(rows), 10)
                self.assertEqual(rows[0], {
                    "team": 100, "role": "BOTTOM", "items": [3006, 0, 0, 0, 0, 0, 3340],
                    "runes": {
                        "primary": {"tree": 8000, "ids": [8005]},
                        "secondary": {"tree": 8300, "ids": [8304, 8347]},
                        "stat_shards": {"offense": 5005, "flex": 5008, "defense": 5011},
                    },
                })

    def test_existing_matches_keep_their_drafts_without_a_build(self):
        with tempfile.TemporaryDirectory() as temp:
            database_path = Path(temp) / "matches.sqlite3"
            with closing(sqlite3.connect(database_path)) as legacy:
                legacy.executescript("""
                    CREATE TABLE matches (id TEXT PRIMARY KEY, status TEXT, patch TEXT, played_at INTEGER, picks TEXT);
                    INSERT INTO matches VALUES ('NA1_1', 'saved', '16.22', 1795000000000, '[[100,"TOP",1,true]]');
                """)
            with closing(riot.open_database(database_path)) as db:
                picks, builds = db.execute("SELECT picks, builds FROM matches WHERE id = 'NA1_1'").fetchone()
                self.assertEqual(json.loads(picks), [[100, "TOP", 1, True]])
                self.assertIsNone(builds)
                self.assertEqual(riot.summary(db)["saved_with_builds"], 0)

    def test_unavailable_build_fields_do_not_discard_the_draft(self):
        match = fixture_match()
        for player in match["info"]["participants"]:
            player.pop("item0")
            player.pop("item6")
            player["perks"] = {"styles": [{"description": [], "style": 8000}]}
        _, _, picks, builds = riot.match_record(match)
        self.assertEqual(len(json.loads(picks)), 10)
        self.assertIsNone(builds)

    def test_unassigned_positions_and_remakes_are_skipped(self):
        match = fixture_match()
        match["info"]["participants"][0]["teamPosition"] = ""
        self.assertIsNone(riot.match_record(match))
        match = fixture_match()
        match["info"]["participants"][0]["gameEndedInEarlySurrender"] = True
        self.assertIsNone(riot.match_record(match))

    def test_rate_limit_uses_riot_retry_after_and_auth_errors_pause(self):
        for status, expected in ((429, riot.RiotUnavailable), (403, riot.KeyRejected)):
            with self.subTest(status=status):
                error = HTTPError("https://na1.api.riotgames.com/", status, "", {"Retry-After": "73"}, BytesIO())
                with patch.object(riot, "urlopen", side_effect=error) as request:
                    with self.assertRaises(expected) as caught:
                        riot.RiotAPI(Event()).get("na1", "/", "test-key")
                if status == 429:
                    self.assertEqual(caught.exception.delay, 73)
                sent = request.call_args.args[0]
                self.assertEqual(sent.get_header("User-agent"), "DraftEdge-Collector/1.0")
                self.assertEqual(sent.get_header("Accept"), "application/json")
                self.assertEqual(sent.unredirected_hdrs["X-riot-token"], "test-key")
                self.assertNotIn("test-key", sent.full_url)
