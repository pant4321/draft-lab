import math
import unittest

from companion.build_recommendation import Cohort, Matchup, fisher_upper_tail, opponent_weight, recommend


ROLES = ("top", "jungle", "middle", "bottom", "support")


def counts(**choices):
    return Cohort.from_rows({"key": key, "games": games, "winRate": 51} for key, games in choices.items())


class BuildRecommendationTests(unittest.TestCase):
    def test_strong_lane_signal_survives_neutral_enemies(self):
        general = counts(usual=6000, mercs=2700, swifties=1000, other=300)
        lane = Matchup(54, "top", counts(usual=200, mercs=670, swifties=100, other=30))
        neutrals = [Matchup(i, role, counts(usual=600, mercs=270, swifties=100, other=30))
                    for i, role in enumerate(ROLES[1:], 1)]
        for matchups in ([lane], [lane, *neutrals]):
            with self.subTest(matchups=len(matchups)):
                result = recommend(general, matchups, "boots", "top", "16.23")
                self.assertEqual([row["key"] for row in result.options[:2]], ["mercs", "usual"])
                self.assertEqual([row["opponentId"] for row in result.change["opponents"]], [54])
                self.assertNotIn("swifties", result.alternatives)

    def test_bystander_with_flat_raw_share_gets_no_badge(self):
        general = counts(usual=5000, bystander=4000, counter=950, other=50)
        matchup = Matchup(54, "top", counts(usual=250, bystander=400, counter=345, other=5))
        result = recommend(general, [matchup], "boots", "top", "14")
        self.assertNotIn("bystander", result.alternatives)
        self.assertNotEqual(result.change and result.change["option"]["key"], "bystander")
        self.assertIn("counter", result.alternatives)
        self.assertEqual(result.comparisons, 2)

    def test_pick_requires_both_sample_floors_in_the_same_matchup(self):
        general = counts(usual=2400, counter=2150, a=1400, b=1400, c=1400, d=1250)
        fewer_purchases = Matchup(31, "top", counts(usual=5, counter=99, a=49, b=49, c=49, d=49))
        fewer_choices = Matchup(113, "jungle", counts(usual=5, counter=100, a=48, b=48, c=49, d=49))
        eligible = Matchup(31, "top", counts(usual=5, counter=100, a=48, b=49, c=49, d=49))
        option = recommend(general, [fewer_purchases, fewer_choices], "item2", "middle", "16.23")
        self.assertIsNone(option.change)
        self.assertEqual(option.options[0]["key"], "usual")
        self.assertEqual({row["opponentId"] for row in option.alternatives["counter"]["opponents"]}, {31, 113})
        pick = recommend(general, [eligible, fewer_choices], "item2", "middle", "16.23")
        self.assertEqual(pick.options[0]["key"], "counter")
        self.assertEqual([row["opponentId"] for row in pick.change["opponents"]], [31])
        self.assertEqual(option.comparisons, pick.comparisons)

    def test_modeled_point_floor_at_two_and_forty_percent_baselines(self):
        for usual, candidate, below, above in ((500_000, 20_000, 2400, 2800), (550_000, 400_000, 40_600, 40_800)):
            general = counts(usual=usual, candidate=candidate, other=1_000_000 - usual - candidate)
            for observed, expected in ((below, False), (above, True)):
                with self.subTest(general_purchases=candidate, observed_purchases=observed):
                    matchup = counts(usual=usual // 10, candidate=observed, other=100_000 - usual // 10 - observed)
                    result = recommend(general, [Matchup(1, "top", matchup)], "boots", "top", "14")
                    self.assertEqual("candidate" in result.alternatives, expected)

    def test_sparse_late_purchase_and_long_tail_do_not_spend_alpha(self):
        general = counts(usual=5200, counter=4700, riftmaker=30, **{f"long{i}": 25 for i in range(24)})
        sparse = Matchup(74, "top", counts(usual=230, counter=230, riftmaker=1,
                                          **{f"long{i}": i % 5 + 1 for i in range(24)}))
        result = recommend(general, [sparse], "item6", "middle", "30")
        self.assertEqual(result.comparisons, 1)
        self.assertIsNone(result.change)
        self.assertFalse(result.alternatives)

        thin = Matchup(74, "top", counts(usual=10, counter=120, riftmaker=20))
        result = recommend(general, [thin], "item6", "middle", "30")
        self.assertEqual(result.comparisons, 0)
        self.assertIsNone(result.change)

    def test_fisher_tail_for_sparse_usual_or_remainder(self):
        for a, b, c, d in ((25, 0, 55, 60), (27, 45, 1, 90), (25, 2, 1000, 80), (25, 3, 5, 2)):
            with self.subTest(table=(a, b, c, d)):
                expected = sum(math.comb(a + c, x) * math.comb(b + d, a + b - x)
                               for x in range(a, min(a + b, a + c) + 1)) / math.comb(a + b + c + d, a + b)
                self.assertAlmostEqual(fisher_upper_tail(a, b, c, d), expected, places=10)
        matchup = Matchup(54, "top", counts(usual=2, counter=120, other=178))
        general = counts(usual=1900, counter=122, other=900)
        result = recommend(general, [matchup], "item1", "top", "16.23")
        self.assertEqual(result.change["option"]["key"], "counter")

    def test_incompatible_or_unknown_counts_do_not_borrow_evidence(self):
        general = counts(usual=2000, candidate=600, other=400)
        opponents = [
            Matchup(1, "top", counts(usual=25, candidate=601, other=100)),
            Matchup(2, "jungle", counts(candidate=550, other=150)),
        ]
        result = recommend(general, opponents, "item4", "top", "14")
        self.assertEqual(result.comparisons, 0)
        self.assertEqual(result.options[0]["key"], "usual")

    def test_fixed_role_weights_stay_in_budget(self):
        for slot in ("startSet", "summoners", "keystone", "item1", "boots", "item2", "item6"):
            for role in ROLES:
                self.assertLessEqual(sum(opponent_weight(slot, role, enemy) for enemy in ROLES), 2.0 + 1e-12)
        self.assertEqual(opponent_weight("summoners", "jungle", "jungle"), 1.0)
        self.assertEqual(opponent_weight("keystone", "support", "bottom"), 0.58)
        self.assertEqual(opponent_weight("keystone", "support", "jungle"), 0.34)
