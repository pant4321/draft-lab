from copy import deepcopy
from pathlib import Path
from threading import Event
import unittest
from unittest.mock import patch

from companion.app import State
from companion.lcu import Credentials, LeagueClient, Poller
from companion.loadout import LoadoutSelection, SpellImportError
from companion.rune_import import DraftChanged, RuneImportError, RuneSelection, TEMPORARY_PAGE_NAME


SELECTION = {
    "sessionId": "123:1",
    "primary": [8112, 8139, 8140, 8106],
    "secondary": [8210, 8226], "shards": [5005, 5008, 5011],
}
STYLES = [
    {"id": style, "allowedSubStyles": [other], "slots": [{"perks": row} for row in rows]}
    for style, other, rows in (
        (8100, 8200, [[8112], [8139], [8140], [8106], [5005], [5008], [5011]]),
        (8200, 8100, [[8214], [8226, 8275], [8210], [8237], [5005], [5008], [5011]]),
    )
]


class LeagueFixture(LeagueClient):
    def __init__(self):
        self.credentials = Credentials(1234, "fixture", 123)
        self.phase = "ChampSelect"
        self.game_id = 1
        self.champion = None
        self.timer_phase = "PLANNING"
        self.spells = (4, 12)
        self.accepts_spells = True
        self.saves_as_temporary = True
        self.activates_on_save = True
        self.explicit_selection = False
        self.calls = []
        self.pages = {
            1: {"id": 1, "name": TEMPORARY_PAGE_NAME, "isTemporary": False, "isEditable": True},
            2: {"id": 2, "name": "My page", "isTemporary": False, "isEditable": True},
            -1: {"id": -1, "name": "Recommended", "isTemporary": True, "isEditable": True},
        }
        self.current = 2

    def _request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path == "/lol-gameflow/v1/gameflow-phase":
            return self.phase
        if path == "/lol-champ-select/v1/session":
            return {"gameId": self.game_id, "timer": {"phase": self.timer_phase}, "localPlayerCellId": 0,
                    "myTeam": [{"cellId": 0, "championId": self.champion,
                                "spell1Id": self.spells[0], "spell2Id": self.spells[1]}], "actions": []}
        if method == "PATCH" and path == "/lol-champ-select/v1/session/my-selection":
            if self.accepts_spells:
                self.spells = payload["spell1Id"], payload["spell2Id"]
            return None
        if path == "/lol-perks/v1/styles":
            return STYLES
        if path == "/lol-perks/v1/currentpage":
            if method == "PUT":
                self.current = payload
                self.explicit_selection = True
                return None
            return {**self.pages[self.current], "current": True}
        if path == "/lol-perks/v1/pages":
            if method == "GET":
                return deepcopy(list(self.pages.values()))
            page = {**payload, "id": -100, "isTemporary": self.saves_as_temporary, "isValid": True}
            self.pages[-100] = page
            self.explicit_selection = False
            if page["isTemporary"] and page["current"] and self.activates_on_save:
                self.current = -100
            return deepcopy(page)
        if path == "/lol-perks/v1/pages/-100":
            if method == "PUT":
                self.pages[-100] = {**payload, "isValid": True}
                self.explicit_selection = False
                if payload["current"] and self.activates_on_save:
                    self.current = -100
                return None
            return deepcopy(self.pages[-100])
        raise AssertionError(f"Unexpected League operation {method} {path}")


class RuneImportTests(unittest.TestCase):
    def setUp(self):
        state = State()
        state.publish("unsupported_draft", "", None, champ_select={"sessionId": "123:1", "championId": None})
        self.poller = Poller(state, Event(), Path("unused"))
        self.client = self.poller.client = LeagueFixture()
        self.poller.draft_game_id = 1
        self.poller.session_id = "123:1"

    def apply(self, **changes):
        self.poller.apply_runes(RuneSelection.parse({**SELECTION, **changes}))

    def writes(self):
        return [(method, path) for method, path, _ in self.client.calls if method != "GET"]

    def loadout(self, *, runes=True, spells=(4, 14), position=None):
        picks = {key: SELECTION[key] for key in ("primary", "secondary", "shards")} if runes else None
        return LoadoutSelection.parse({"sessionId": "123:1", "runes": picks,
                                       "spells": list(spells), "flashPosition": position})

    def test_applies_both_parts_with_flash_in_the_requested_slot(self):
        with patch("companion.rune_import.time.sleep"):
            self.poller.apply_loadout(self.loadout(position="right"))
        self.assertEqual(self.client.current, -100)
        self.assertEqual(self.client.spells, (14, 4))
        self.assertIn(("PATCH", "/lol-champ-select/v1/session/my-selection", {"spell1Id": 14, "spell2Id": 4}),
                      self.client.calls)

    def test_keeps_current_flash_slot_when_unset_and_order_for_flashless_pairs(self):
        self.client.spells = (12, 4)
        self.poller.apply_loadout(self.loadout(runes=False))
        self.assertEqual(self.client.spells, (14, 4))
        self.poller.apply_loadout(self.loadout(runes=False, spells=(6, 11), position="right"))
        self.assertEqual(self.client.spells, (6, 11))

    def test_reports_the_result_when_league_does_not_keep_the_spells(self):
        self.client.accepts_spells = False
        with patch("companion.rune_import.time.sleep"), patch.object(self.poller.stop, "wait", return_value=False):
            with self.assertRaisesRegex(SpellImportError, "Runes applied"):
                self.poller.apply_loadout(self.loadout(position="right"))
        self.assertEqual(self.client.current, -100)
        self.assertEqual(self.client.spells, (4, 12))

    def test_loadout_never_writes_after_champion_select(self):
        self.client.timer_phase = "GAME_STARTING"
        with self.assertRaises(DraftChanged):
            self.poller.apply_loadout(self.loadout())
        self.assertEqual(self.writes(), [])

    def test_create_and_reuse_only_the_temporary_page_before_a_pick(self):
        original_pages = deepcopy(self.client.pages)
        with patch("companion.rune_import.time.sleep"):
            self.apply()
            self.apply()
        self.assertEqual(self.client.current, -100)
        self.assertEqual(self.client.pages[-100]["selectedPerkIds"],
                         [8112, 8139, 8140, 8106, 8226, 8210, 5005, 5008, 5011])
        for page_id, original in original_pages.items():
            self.assertEqual(self.client.pages[page_id], original)
        self.assertEqual(self.writes(), [
            ("POST", "/lol-perks/v1/pages"), ("PUT", "/lol-perks/v1/currentpage"),
            ("PUT", "/lol-perks/v1/pages/-100"), ("PUT", "/lol-perks/v1/currentpage"),
        ])

    def test_explicitly_selects_the_page_even_when_save_makes_it_current(self):
        def recommend_if_no_page_selected(_delay):
            if not self.client.explicit_selection:
                self.client.current = -1

        with patch("companion.rune_import.time.sleep", side_effect=recommend_if_no_page_selected):
            self.apply()
        self.assertEqual(self.client.current, -100)
        self.assertEqual(self.writes(), [
            ("POST", "/lol-perks/v1/pages"), ("PUT", "/lol-perks/v1/currentpage"),
        ])

    def test_detects_the_recommender_replacing_the_page_after_activation(self):
        def recommend_during_verification(_delay):
            self.client.current = -1

        with patch("companion.rune_import.time.sleep", side_effect=recommend_during_verification):
            with self.assertRaisesRegex(RuneImportError, "switched away"):
                self.apply()
        self.assertEqual(self.client.current, -1)
        self.assertEqual(self.writes(), [
            ("POST", "/lol-perks/v1/pages"), ("PUT", "/lol-perks/v1/currentpage"),
        ])

    def test_never_select_a_page_without_temporary_confirmation(self):
        self.client.saves_as_temporary = False
        with self.assertRaises(RuneImportError):
            self.apply()
        self.assertEqual(self.client.current, 2)
        self.assertEqual(self.writes(), [("POST", "/lol-perks/v1/pages")])

    def recommend(self):
        self.client.pages[-1].update(runeRecommendationId="riot:1", recommendationChampionId=32)
        self.client.pages.pop(-100)
        self.client.current = -1

    def watch(self):
        draft = self.client.get("/lol-champ-select/v1/session")
        self.poller.watch_rune_import(draft, self.client.champion)

    def test_restores_a_recommended_replacement_once_during_finalization(self):
        self.client.champion = 32
        with patch("companion.rune_import.time.sleep"):
            self.apply()
        self.client.timer_phase = "FINALIZATION"
        self.recommend()
        self.watch()
        self.assertEqual(self.client.current, -100)
        self.recommend()
        self.watch()
        self.assertEqual(self.client.current, -1)
        self.assertEqual(self.writes(), [
            ("POST", "/lol-perks/v1/pages"), ("PUT", "/lol-perks/v1/currentpage"),
        ] * 2)

    def test_restores_a_replacement_during_the_initial_verification_in_finalization(self):
        self.client.champion = 32
        self.client.timer_phase = "FINALIZATION"

        def recommend_on_first_check(_delay):
            if pause.call_count == 1:
                self.recommend()

        with patch("companion.rune_import.time.sleep", side_effect=recommend_on_first_check) as pause:
            self.apply()
        self.assertEqual(self.client.current, -100)
        self.assertIsNone(self.poller.pending_runes)

    def test_does_not_restore_over_a_saved_page_or_after_game_start(self):
        self.client.champion = 32
        with patch("companion.rune_import.time.sleep"):
            self.apply()
        self.client.timer_phase = "FINALIZATION"
        self.client.current = 2
        self.watch()
        self.assertEqual(self.client.current, 2)
        self.assertIsNone(self.poller.pending_runes)
        with patch("companion.rune_import.time.sleep"):
            self.apply()
        self.recommend()
        self.client.phase = "InProgress"
        self.watch()
        self.assertEqual(self.client.current, -1)
        self.assertEqual(len(self.writes()), 4)

    def test_does_not_restore_after_the_selected_champion_changes(self):
        self.client.champion = 32
        with patch("companion.rune_import.time.sleep"):
            self.apply()
        self.client.champion = 103
        self.client.timer_phase = "FINALIZATION"
        self.recommend()
        self.watch()
        self.assertEqual(self.client.current, -1)
        self.assertIsNone(self.poller.pending_runes)
        self.assertEqual(len(self.writes()), 2)

    def test_rejects_old_drafts_and_illegal_rune_pages_before_any_write(self):
        with self.assertRaises(DraftChanged):
            self.apply(sessionId="old-draft")
        self.client.game_id = 2
        with self.assertRaises(DraftChanged):
            self.apply()
        self.client.game_id = 1
        with self.assertRaises(RuneImportError):
            self.apply(secondary=[8226, 8275])
        self.client.phase = "InProgress"
        with self.assertRaises(DraftChanged):
            self.apply()
        self.assertEqual(self.writes(), [])
