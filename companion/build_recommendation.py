"""Rank build choices by opponent-specific changes in observed pick share."""

from dataclasses import dataclass
import math
from statistics import NormalDist


MIN_CHOICES = 200
OPTION_COUNT = 25
PICK_COUNT = 100
PICK_MIN_CHOICES = 300
MIN_GAIN = 0.004
DUO = {"bottom", "support"}
EARLY = {"startSet", "summoners"}
LANE = {"keystone", "item1"}


def direct_opponent(role, enemy_role):
    return enemy_role == role or (role in DUO and enemy_role in DUO)


def opponent_weight(slot, role, enemy_role):
    direct = direct_opponent(role, enemy_role)
    duo = role in DUO
    if slot in EARLY:
        if direct:
            return 0.70 if duo else 1.00
        return 0.25 if enemy_role == "jungle" else 0.10
    if slot in LANE:
        if direct:
            return 0.58 if duo else 0.85
        if enemy_role == "jungle":
            return 0.34 if duo else 0.35
        return 0.25
    if direct:
        return 0.46 if duo else 0.48
    return 0.36 if duo else 0.38


@dataclass
class Cohort:
    rows: dict
    total: int

    @classmethod
    def from_rows(cls, rows):
        by_key = {row["key"]: row for row in rows}
        return cls(by_key, sum(row["games"] for row in by_key.values()))

    def count(self, key):
        return self.rows[key]["games"]


@dataclass
class Matchup:
    opponent_id: int
    role: str
    cohort: Cohort


def comparable_table(general, matchup, candidate, usual):
    if candidate not in matchup.rows or usual not in matchup.rows:
        return None
    a, u = matchup.count(candidate), matchup.count(usual)
    rest_a, rest_u = general.count(candidate) - a, general.count(usual) - u
    if min(rest_a, rest_u) < 0 or not 0 < general.total - matchup.total >= rest_a + rest_u:
        return None
    return a, u, rest_a, rest_u


def covered_matchups(general, matchups):
    if not general.rows:
        return []
    usual = max(general.rows, key=general.count)
    return [matchup for matchup in matchups if matchup.cohort.total >= MIN_CHOICES
            and any(comparable_table(general, matchup.cohort, key, usual)
                    for key in general.rows if key != usual)]


def fisher_upper_tail(a, b, c, d):
    """Conditional probability of a table with at least a candidate purchases."""
    sample = a + b
    candidates = a + c
    total = sample + c + d
    upper = min(sample, candidates)

    def log_choose(n, k):
        return math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)

    log_probability = log_choose(candidates, a) + log_choose(total - candidates, b) - log_choose(total, sample)
    probability = math.exp(log_probability)
    terms = [probability]
    for x in range(a, upper):
        probability *= (candidates - x) * (sample - x) / ((x + 1) * (total - candidates - sample + x + 1))
        if probability == 0:
            break
        terms.append(probability)
    return min(1.0, math.fsum(terms))


def supported(table, alpha, z):
    a, u, rest_a, rest_u = table
    if a * rest_u <= u * rest_a:
        return False
    if min(table) < 5:
        return fisher_upper_tail(*table) <= alpha
    log_odds = math.log(a * rest_u / (u * rest_a))
    return log_odds > z * math.sqrt(sum(1 / cell for cell in table))


@dataclass
class Comparison:
    matchup: Matchup
    table: tuple
    shift: float
    own_share_increased: bool


@dataclass
class Recommendation:
    options: list
    change: dict | None
    alternatives: dict
    comparisons: int


def recommend(general, matchups, slot, role, window, choices_with_pages=None):
    if not general.rows:
        return Recommendation([], None, {}, 0)
    usual = max(general.rows, key=general.count)
    smoothing = 0.5 * len(general.rows)
    shares = {key: (general.count(key) + 0.5) / (general.total + smoothing) for key in general.rows}
    scores = {key: math.log(share / shares[usual]) for key, share in shares.items()}
    screened = {key: [] for key in shares if key != usual}

    for matchup in matchups:
        cohort = matchup.cohort
        rest_total = general.total - cohort.total
        weight = opponent_weight(slot, role, matchup.role)
        for key in screened:
            table = comparable_table(general, cohort, key, usual)
            if table is None:
                continue
            a, u, rest_a, rest_u = table
            rest_share = (rest_a + 0.5) / (rest_total + smoothing)
            rest_usual = (rest_u + 0.5) / (rest_total + smoothing)
            adjusted = (a + MIN_CHOICES * rest_share) / (cohort.total + MIN_CHOICES)
            adjusted_usual = (u + MIN_CHOICES * rest_usual) / (cohort.total + MIN_CHOICES)
            shift = weight * (math.log(adjusted / rest_share) - math.log(adjusted_usual / rest_usual))
            scores[key] += shift
            if (cohort.total >= MIN_CHOICES and a >= OPTION_COUNT
                    and (choices_with_pages is None or key in choices_with_pages)):
                # Also compare the raw shares so smoothing cannot turn a flat share into an increase.
                own_share_increased = adjusted > rest_share and a * rest_total > rest_a * cohort.total
                screened[key].append(Comparison(matchup, table, shift, own_share_increased))

    count = sum(map(len, screened.values()))
    popular = sorted(general.rows, key=general.count, reverse=True)
    if not count:
        return Recommendation([general.rows[key] for key in popular[:3]], None, {}, 0)

    alpha = 0.05 / count
    z = NormalDist().inv_cdf(1 - alpha)
    peak = max(scores.values())
    masses = {key: math.exp(score - peak) for key, score in scores.items()}
    total_mass = math.fsum(masses.values())
    qualified = {}
    for key, comparisons in screened.items():
        if masses[key] / total_mass - shares[key] < MIN_GAIN:
            continue
        evidence = [comparison for comparison in comparisons
                    if comparison.own_share_increased and supported(comparison.table, alpha, z)]
        if evidence:
            qualified[key] = sorted(evidence, key=lambda comparison: comparison.shift, reverse=True)

    def details(key, evidence):
        rows = []
        for comparison in evidence:
            matchup = comparison.matchup
            option = matchup.cohort.rows[key]
            rows.append({**option, "opponentId": matchup.opponent_id,
                         "pickShare": option["games"] / matchup.cohort.total, "contribution": comparison.shift})
        return {"option": general.rows[key], "usual": general.rows[usual], "window": window,
                "generalPickShare": shares[key], "opponents": rows}

    ranked = sorted(qualified, key=scores.__getitem__, reverse=True)
    pick_evidence = {
        key: [comparison for comparison in qualified[key] if comparison.table[0] >= PICK_COUNT
              and comparison.matchup.cohort.total >= PICK_MIN_CHOICES]
        for key in ranked if scores[key] > 0
    }
    winner = next((key for key in ranked if pick_evidence.get(key)), usual)
    change = details(winner, pick_evidence[winner]) if winner != usual else None
    alternatives = {key: details(key, qualified[key]) for key in ranked if key != winner}
    order = dict.fromkeys([winner, usual, *alternatives, *popular])
    visible = list(order)[:3]
    return Recommendation([general.rows[key] for key in visible], change,
                          {key: alternatives[key] for key in visible if key in alternatives}, count)
