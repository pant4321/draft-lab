import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

from companion.build_catalog import BuildCatalog, purchase_limits
from companion.champion_builds import API, NO_BOOTS, draft_build, fetch_build, get_build, parse_build


class ChampionBuildTests(unittest.TestCase):
    def test_selects_high_sample_items_and_preserves_ability_level_sequence(self):
        payload = {
            "header": {"cid": 103, "lane": "middle", "patch": "30", "wr": 51.4, "n": 3200},
            "summary": {"pick": {"runes": {"wr": 52, "n": 1200, "set": {
                "pri": [8112, 8139, 8140, 8106], "sec": [8226, 8210], "mod": [5005, 5008, 5011],
            }}}},
            "startSet": [["1056_2003_2003", 52, 48, 1500]],
            "boots": [[1001, 30, 10, 400], [3020, 52, 30, 960], [3158, 58, 1, 32]],
            "skillOrder": [["QWE", 52, 70, 2240]],
            "skill15": [[213114121242233, 52, 45, 1440]],
            "spells": [["4_12", 50, 20, 640], ["4_7", 100, 1, 32], ["4_14", 53, 70, 2240],
                       ["4_21", 51, 3, 96], ["4", 61, 5, 160]],
        }
        with patch("companion.champion_builds.urlopen") as open_url:
            response = open_url.return_value.__enter__.return_value
            response.geturl.return_value = API
            response.read.return_value = json.dumps(payload).encode()
            build = fetch_build("ahri", 103, "middle", "emerald_plus", -1)
            query = parse_qs(urlsplit(open_url.call_args.args[0].full_url).query)
        self.assertEqual(query["ep"], ["build-full"])
        self.assertEqual(query["patch"], ["30"])
        self.assertEqual(query["tier"], ["emerald_plus"])
        self.assertEqual(query["lane"], ["middle"])
        self.assertEqual(build["runes"][0]["secondary"], [8226, 8210])
        self.assertEqual([option["key"] for option in build["items"]["boots"]], ["3020", "1001", "3158"])
        self.assertEqual(build["items"]["startSet"][0]["key"], "1056_2003_2003")
        self.assertEqual(build["maxOrder"]["key"], "QWE")
        self.assertEqual(build["levelOrder"]["key"], "WQEQQRQWQWRWWEE")
        self.assertEqual(build["summoners"], {"key": "4_14", "games": 2240, "winRate": 53})
        self.assertEqual(build["summonerAlternatives"], [
            {"key": "4_12", "games": 640, "winRate": 50},
            {"key": "4_21", "games": 96, "winRate": 51},
        ])

    def test_empty_build_and_mismatched_champion(self):
        self.assertIsNone(parse_build({"status": 404}, 103, "middle"))
        self.assertIsNone(parse_build({"header": {"cid": 103, "lane": "middle", "patch": "30", "n": 0}}, 103, "middle"))
        with self.assertRaises(ValueError):
            parse_build({"header": {"cid": 12, "n": 10}}, 103, "middle")

    def test_matchup_uses_opponent_role_and_keeps_separate_core_purchase_stats(self):
        payload = {
            "header": {"cid": 103, "lane": "middle", "patch": "30", "vs": 777, "vsLane": "top", "wr": 52, "n": 300},
            "summary": {"pick": {"items": {
                "item1": {"id": 3118, "wr": 53, "n": 120},
                "item2": {"id": 3020, "wr": 54, "n": 130},
                "item3": {"id": 4645, "wr": 55, "n": 115},
                "item4": [{"id": 3089, "wr": 56, "n": 100}],
                "item6": [{"id": 3135, "wr": 60, "n": 15}],
            }}},
        }
        with patch("companion.champion_builds.urlopen") as open_url:
            response = open_url.return_value.__enter__.return_value
            response.geturl.return_value = API
            response.read.return_value = json.dumps(payload).encode()
            build = fetch_build("ahri", 103, "middle", "all", -1, ("yone", 777, "top"))
            query = parse_qs(urlsplit(open_url.call_args.args[0].full_url).query)
        self.assertEqual((query["patch"], query["tier"], query["vs"], query["vslane"]),
                         (["30"], ["all"], ["yone"], ["top"]))
        self.assertEqual(build["opponentId"], 777)
        self.assertEqual(build["items"]["builtBootSet3"], [])
        self.assertEqual([step["games"] for step in build["coreSteps"]], [120, 130, 115])
        self.assertEqual(build["items"]["item4"][0]["key"], "3089")
        self.assertEqual(build["items"]["item6"][0]["key"], "3135")
        catalog = BuildCatalog(boots=frozenset({"3020"}))
        ranked = draft_build([("30", build, [])], "middle", (), catalog)
        self.assertEqual(ranked["items"]["item1"], [{"key": "3118", "winRate": 53, "games": 120}])
        self.assertEqual(ranked["items"]["item2"], [{"key": "4645", "winRate": 55, "games": 115}])
        with self.assertRaises(ValueError):
            parse_build(payload, 103, "middle", ("yone", 777, "middle"))

    def test_missing_matchup_falls_back_to_the_same_rank_and_window(self):
        payload = {"header": {"cid": 103, "lane": "middle", "patch": "30", "wr": 52, "n": 300}}
        with (
            patch("companion.champion_builds.current_version", return_value=None),
            patch("companion.champion_builds.urlopen") as open_url,
        ):
            response = open_url.return_value.__enter__.return_value
            response.geturl.return_value = API
            response.read.return_value = json.dumps(payload).encode()
            missing = HTTPError(API, 404, "Missing", {}, None)
            open_url.side_effect = [missing, missing, missing, open_url.return_value]
            build = get_build("ahri", 103, "middle", "emerald_plus", ("yone", 777, "support"))
            matchup, baseline = (
                parse_qs(urlsplit(open_url.call_args_list[index].args[0].full_url).query) for index in (1, 3)
            )
        self.assertEqual(matchup.pop("vs"), ["yone"])
        self.assertEqual(matchup.pop("vslane"), ["support"])
        self.assertEqual(matchup, baseline)
        self.assertEqual(baseline["tier"], ["emerald_plus"])
        self.assertIsNone(build["opponentId"])

    def test_rune_stats_keep_primary_and_secondary_samples_separate(self):
        build = parse_build({
            "header": {"cid": 103, "lane": "middle", "patch": "30", "wr": 51.4, "n": 3200},
            "runes": {"stats": {
                "8226": [[12.4, 54, 390], [70.3, 52.8, 2200]],
                "8112": [[0, 47.3, 2]],
                "8242": [[0, 0, 0], [1.7, 54.3, 55]],
                "8992": [[101, 52, 80]],
            }},
        }, 103, "middle")
        self.assertEqual(build["runeStats"], {
            "primary": {
                "8226": {"winRate": 54, "pickRate": 12.4, "games": 390},
                "8112": {"winRate": 47.3, "pickRate": 0, "games": 2},
            },
            "secondary": {
                "8226": {"winRate": 52.8, "pickRate": 70.3, "games": 2200},
                "8242": {"winRate": 54.3, "pickRate": 1.7, "games": 55},
            },
        })

    def test_draft_keeps_baseline_if_a_matchup_fails_and_hides_internal_counts(self):
        enemy = ("yone", 777, "middle")

        def fetch(_slug, _champion_id, _role, _tier, _period, opponent, window):
            if opponent:
                raise OSError("unavailable")
            return parse_build({
                "header": {"cid": 103, "lane": "middle", "patch": window, "wr": 52, "n": 320},
                "boots": [[3020, 52, 70, 210], [3111, 50, 20, 60]],
            }, 103, "middle", window=window)

        with patch("companion.champion_builds.current_version", return_value="16.23.1"), \
                patch("companion.champion_builds.load_catalog", return_value=BuildCatalog()), \
                patch("companion.champion_builds.fetch_build", side_effect=fetch):
            build = get_build("ahri", 103, "middle", "all", draft=(enemy,))
        self.assertEqual([option["key"] for option in build["items"]["boots"]], ["3020", "3111"])
        self.assertEqual(build["window"], "16.23")
        self.assertEqual(build["windows"]["boots"], "30")
        self.assertEqual(build["draft"], {"opponentIds": [], "changes": {}, "alternatives": {}})
        self.assertNotIn("_choices", build)

    def test_windows_require_direct_lane_coverage_only_for_early_choices(self):
        lane = ("malphite", 54, "top")
        jungle = ("sejuani", 113, "jungle")

        def build(window, enemy=None):
            rows = 1000 if not enemy else (70 if enemy == lane and window == "16.23" else 400)
            info = {"vs": enemy[1], "vsLane": enemy[2]} if enemy else {}
            payload = {
                "header": {"cid": 122, "lane": "top", "patch": window, "wr": 52, "n": rows, **info},
                "startSet": [["1054_2003", 53, 70, rows * 7 // 10], ["1055_2003", 48, 30, rows * 3 // 10]],
                "boots": [[3111, 51, 30, rows * 3 // 10], [3047, 52, 70, rows * 7 // 10]],
            }
            return parse_build(payload, 122, "top", enemy, window)

        sources = [(window, build(window), [build(window, lane), build(window, jungle)])
                   for window in ("16.23", "14")]
        result = draft_build(sources, "top", (lane, jungle), BuildCatalog())
        self.assertEqual(result["windows"]["startSet"], "14")
        self.assertEqual(result["windows"]["boots"], "16.23")
        self.assertEqual(set(result["draft"]["opponentIds"]), {54, 113})

    def test_legendary_slots_keep_individual_stats_and_filter_later_item_groups(self):
        header = {"cid": 103, "lane": "middle", "patch": "16.23", "wr": 52, "n": 1000}
        baseline = parse_build({
            "header": header,
            "boots": [[3020, 52, 65, 650], [3111, 51, 30, 300]],
            "item1": [[3118, 52, 60, 600], [2503, 51, 40, 400]],
            "item2": [[4645, 51, 30, 300]],
            "builtBootSet3": [["3118_3020_4645", 54, 25, 250], ["2503_3111_4645", 52, 12, 120],
                             ["3111_3118_4645", 50, 8, 80], ["4645_3118_3020", 55, 10, 100]],
            "item3": [[4645, 57, 10, 100], [3135, 52, 8, 80], [3157, 51, 8, 80]],
            "item4": [[3157, 50, 8, 80], [3089, 50, 4, 40]],
        }, 103, "middle", window="16.23")
        groups, limits = purchase_limits({
            "group": {"__type": "ItemGroup", "mMaxGroupOwnable": 1},
            "default": {"__type": "ItemGroup"},
            "first": {"__type": "ItemData", "itemID": 4645, "mItemGroups": ["group", "default"]},
            "second": {"__type": "ItemData", "itemID": 3135, "mItemGroups": ["group"]},
        })
        catalog = BuildCatalog(item_groups=groups, group_limits=limits)
        result = draft_build([("16.23", baseline, [])], "middle", (), catalog)
        self.assertFalse(result["items"]["builtBootSet3"])
        self.assertEqual(result["items"]["item1"][0], {"key": "3118", "games": 600, "winRate": 52})
        self.assertEqual(result["items"]["item2"][0], {"key": "4645", "games": 300, "winRate": 51})
        self.assertEqual([option["key"] for option in result["items"]["item4"]], ["3157"])
        self.assertEqual([option["key"] for option in result["items"]["item5"]], ["3089"])

    def test_no_boots_follows_the_normal_boot_choice_ranking(self):
        catalog = BuildCatalog(items=frozenset({"1001", "3020", "3047", "3111", "3118", "4645"}),
                               boots=frozenset({"1001", "3020", "3047", "3111"}))
        cases = (
            ((400, 300, 150, 115), 35, ["3047", "3111", "3020"]),
            ((400, 300, 80, 20), 200, ["3047", "3111", NO_BOOTS]),
            ((50, 45, 35, 20), 850, [NO_BOOTS, "3047", "3111"]),
        )
        for boot_counts, no_boots_games, expected in cases:
            with self.subTest(no_boots_games=no_boots_games):
                boots = [[key, 51, games / 10, games] for key, games in zip((3047, 3111, 3020, 1001), boot_counts)]
                baseline = parse_build({
                    "header": {"cid": 103, "lane": "middle", "patch": "30", "wr": 52, "n": 1000},
                    "boots": [*boots, [9999, 50, no_boots_games / 10, no_boots_games]],
                    "item1": [[3118, 52, 60, 600]],
                    "item2": [[4645, 51, 30, 300]],
                }, 103, "middle")
                result = draft_build([("30", baseline, [])], "middle", (), catalog)
                boots = result["items"]["boots"]
                self.assertEqual([row["key"] for row in boots], expected)
                if NO_BOOTS in expected:
                    skipped = next(row for row in boots if row["key"] == NO_BOOTS)
                    self.assertEqual(skipped["games"], no_boots_games)
                    self.assertAlmostEqual(skipped["pickRate"], no_boots_games / 10)
                self.assertEqual([result["items"][slot][0]["key"] for slot in ("item1", "item2")], ["3118", "4645"])
