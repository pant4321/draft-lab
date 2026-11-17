# Scoring reference

[Back to README](../README.md)

## Candidate draft edge

Look up each revealed champion by its assigned role. Enemy effects are from the candidate's perspective; ally effects describe shared synergy.

```text
adjusted effect = normalized Delta 2 × games / (games + 1000)
weighted effect = adjusted effect × role multiplier
draft edge = sum(weighted enemy effects) + sum(weighted ally effects)
optional base strength = 100 × (candidate win rate − 0.5)
```

Effects use percentage points. The fixed 1,000-game adjustment reduces small-sample influence; it is not a fitted parameter. Settings provide separate ally/enemy role multipliers from 0 to 5, defaulting to 1. Zero explicitly ignores a slot and its coverage requirement.

Unknown slots add nothing. Candidates missing an active pair are unranked. Picked and banned champions are excluded. **Your pool** groups preferred champions first without changing their scores or eligibility; each group keeps its score order.

The contribution panel shows raw deltas, adjusted weighted values, game counts, and custom multipliers. Ignored and missing terms are labeled explicitly. The selected champion remains a preview in your open role until imported as a locked pick.

## Team draft edge

The team total includes the selected preview or your imported locked pick. It sums:

- Each unique allied synergy pair once: ten for a full team.
- Every allied-versus-enemy matchup: 25 with both teams full.
- Each ally's base strength once, when enabled.

A synergy pair averages the available directional sample-adjusted effects and uses the mean of its two role weights. A reverse record alone is sufficient. Counters use the opposing role's counter multiplier. Missing active data makes the total unavailable instead of presenting a partial sum as complete.

## Blindability

Blindability ranks counterpick safety within a role, independently of the current draft. Before picks are revealed, candidates sort by this score; afterward, they sort by draft edge. Base win rate, ally synergy, positive bonuses, and custom role weights do not affect blindability.

For each enemy role, use catalog pick shares, including rare recorded roles. Exclude the candidate itself. Eligible pairs need at least 100 games and a finite delta; each role needs five pairs and at least 80% pick-share coverage. Normalize covered shares using favorable and unfavorable matchups together.

```text
role downside = sum(opponent share × max(0, −adjusted enemy effect))
total downside = sum(role downside across five enemy roles)
```

Lower downside earns a higher 0–100 percentile among resolved role peers. Ties share rank; unavailable coverage or fewer than two rated candidates produces no score. Taken and banned champions remain in the comparison pool so scores stay fixed. A score of 90 indicates lower modeled downside than about 90% of rated peers, not a 90% win chance.

## Spread graphs

Hover, focus, or tap a blindability number to inspect role-specific matchup and synergy distributions. Portraits mark raw deltas; game counts are available in their labels. Graphs apply a 0.5% common-opponent floor, unlike the safety score, and estimate spread after subtracting binomial sampling noise. Insufficient coverage or unresolved variance hides the curve. Graph spread never enters draft edge or blindability.

Exact implementations are in [draft-math.mjs](../dist/draft-math.mjs), [team-edge.mjs](../dist/team-edge.mjs), and [blindability.mjs](../dist/blindability.mjs).

## Limits

These additive, observational scores rank draft fit. Pair samples overlap and effects can interact, so totals are neither causal gains nor calibrated win probabilities. Shrinkage, coverage thresholds, and the optional base term need held-out validation before making match-odds claims. Blindability models ordinary opponent pick shares, not an opponent deliberately adapting to your pick.
