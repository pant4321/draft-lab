# Scoring reference

[Back to README](../README.md)

## Candidate draft edge

Look up each revealed champion by its assigned role. Enemy effects are from the candidate's perspective; ally effects describe shared synergy.

```text
adjusted effect = normalized matchup or synergy delta × games / (games + 1000)
weighted effect = adjusted effect × role multiplier
draft edge = sum(weighted enemy effects) + sum(weighted ally effects)
optional base strength = 100 × (candidate win rate − 0.5)
```

Effects use percentage points. The fixed 1,000-game adjustment reduces small-sample influence; it is not a fitted parameter. Settings provide separate ally/enemy role multipliers from 0 to 5, defaulting to 1. Zero explicitly ignores a slot and its coverage requirement.

Unknown slots add nothing. Candidates missing an active pair are unranked. Picked and banned champions are excluded. **Your pool** groups preferred champions first without changing their scores or eligibility; each group keeps its score order.

Use **⊘** on a revealed ally or enemy to exclude that champion from calculations. The champion still occupies a slot and remains unavailable as a recommendation. The exclusion follows the champion through role changes and clears when the pick is removed. If every revealed pick is excluded, recommendations use Blindability.

The contribution panel shows raw deltas, adjusted weighted values, game counts, and custom multipliers. Ignored and missing terms are labeled explicitly. The selected champion remains a preview in your open role until imported as a locked pick.

The recommendation list defaults to **Draft Edge** with picks revealed and **Blindability** on an empty board. Select any available metric heading to sort within each recommendation group. Select it again to reverse the order. Sample Δ starts with the narrowest ranges. Other columns start with the highest values. Open **?** beside **Champion** for short explanations of Blindability, Sample Δ, and Draft Edge.

### Matchup sample sizes

The **Sample Δ** column shows ± half the width of the Draft Edge range obtained by moving all active matchup contributions to their high or low sampling bounds together. Hover over a pick to see the separate upward and downward changes. This is a sensitivity range with base WR held fixed. A dash appears when there are no active contributions or one of them lacks the data to calculate a range. The warning next to a champion portrait marks an active matchup with fewer than 500 games.

Open **Contribution sampling ranges** under a pick's breakdown for approximate 95% Wilson intervals on the same scale as the displayed matchup contributions. The calculation starts with the raw delta range for the pooled win rate, holding the expected rate fixed, then applies the normal sample adjustment and role weight to both ends. Each matchup range assumes independent games and a pooled binomial model. The overall sensitivity range allows the effects to move together and has no assigned confidence level. Strong shrinkage on very small samples can also produce narrow ranges on the score scale.

## Team draft edge

Each team gets a total from its own perspective. Both totals account for the selected preview or your imported locked pick. Each sum includes:

- Each unique teammate synergy pair once, for ten pairs on a full team.
- Every matchup against the other team, for 25 matchups with both teams full.
- Each teammate's base strength once, when enabled.

A synergy pair averages the available directional sample-adjusted effects and uses the mean of its two board slot weights. A reverse record alone is sufficient. Counters use the opposing champion's board slot weight and the matchup record from the scoring champion's perspective. A total requires data for every matchup that counts for that team.

Excluding a champion removes their counters and synergy from both totals and removes their base strength from their team's total.

**Team edge range** shows the low and high ends of the total team edge, accounting for how uncertain each matchup estimate is given the number of games played. Each end combines the corresponding bounds for all active matchups using the same sample adjustment, role weights, and directional averaging as the point score. Base strength stays fixed if enabled. The range is unavailable if there are no active matchups or any contributing record lacks a valid observed win rate. Matchup records can share games, so the range describes score sensitivity. The saved aggregates do not contain the covariances needed to estimate variance for the total.

## Blindability

Blindability ranks counterpick safety within a role, independently of the current draft. Before picks are revealed, candidates sort by this score; afterward, they sort by draft edge. Base win rate, ally synergy, positive bonuses, and custom role weights do not affect blindability.

For each enemy role, use catalog pick shares, including rare recorded roles. Exclude the candidate itself. Eligible pairs need at least 100 games and a finite delta; each role needs five pairs and at least 80% pick-share coverage. Normalize covered shares using favorable and unfavorable matchups together.

```text
role downside = sum(opponent share × max(0, −adjusted enemy effect))
total downside = sum(role downside across five enemy roles)
```

Lower downside earns a higher 0–100 percentile among resolved role peers. Ties share rank; unavailable coverage or fewer than two rated candidates produces no score. Taken and banned champions remain in the comparison pool so scores stay fixed. A score of 90 indicates lower modeled downside than about 90% of rated peers, not a 90% win chance.

### Remaining counters

The pick breakdown lists up to three available counters while enemy roles are open. It checks enemy matchups with at least 5,000 games across the saved patches and a 0.5% role pick share. Each champion appears once in its highest-ranked open role. The list updates with picks, bans, and role corrections, including your own imported lock-in.

```text
downside = −sample-adjusted enemy effect in percentage points
priority = historical role pick share (as a fraction) × downside × exp(0.4 × min(downside, 4))
```

The exponential multiplier gives more weight to severe matchups and tops out at about 4.95× when the downside reaches 4 pp. After that, priority grows linearly with downside. Cards display the sample-adjusted matchup effect in percentage points. Open the **?** beside **Remaining counters** for a plain-language explanation of the order and the card values.

Open **Suggested bans for your pool** beside **+ Add ban** at any point in the draft. It ranks up to five champions by the same priority, averaged across the currently available champions in your role's saved pool. Favorable matchups contribute zero, and each suggested role needs qualifying matchup data for every available pool pick. The list excludes champions in your pool and considers enemy roles that are still open. Expand a suggestion to see each pool pick's sample-adjusted matchup effect and its share of the total ban score. That share is the matchup's priority divided by the number of available pool picks.

## Spread graphs

Hover, focus, or tap a blindability number to inspect role-specific matchup and synergy distributions. Portraits mark raw deltas; game counts are available in their labels. Graphs apply a 0.5% common-opponent floor, unlike the safety score, and estimate spread after subtracting binomial sampling noise. Insufficient coverage or unresolved variance hides the curve. Graph spread never enters draft edge or blindability.

Exact implementations are in [draft-math.ts](../web/src/domain/draft-math.ts), [team-edge.ts](../web/src/domain/team-edge.ts), and [blindability.ts](../web/src/domain/blindability.ts).

## Limits

These additive, observational scores rank draft fit. Pair samples overlap and effects can interact, so totals are neither causal gains nor calibrated win probabilities. Shrinkage, coverage thresholds, and the optional base term need held-out validation before making match-odds claims. Blindability models ordinary opponent pick shares, not an opponent deliberately adapting to your pick.

## Build recommendations

Each build choice uses the shortest comparable LoLalytics Ranked Solo/Duo window for the champion, role, and selected rank. Try the current patch, then 14 days and 30 days. Early choices prefer direct lane coverage when the lane matchup is known. The all-matchups sample and its opponent comparisons share a window.

The most-picked eligible option is the usual choice. Each alternative starts from its general pick share and receives fixed role-weighted shifts against the usual choice. Opponent samples are compared against the rest of the same cohort, with shrinkage toward that remainder. A normalized modeled gain of at least 0.4 percentage points and evidence of increased own share and relative odds are required for a badge.

At least 200 recorded choices and 25 purchases of the exact candidate are required to enter the evidence check. Both badges use the same multiple-comparison budget. A **Draft pick** must outrank the usual choice and have at least one supporting matchup with 100 exact purchases and 300 total recorded choices at that decision. A qualifying **Draft option** appears under Alternatives. Its opponent rows hide win rates below 100 exact purchases. If every supporting matchup falls below 100, the badge shows **Low sample** and the option row hides its win rate.

Boot choices include basic boots, upgrades, and an explicit no-boots sample where reported. The no-boots choice follows the same ranking and evidence rules and occupies no purchase slot. All legendary columns use their own purchase statistics regardless of boot choice. Later slots exclude featured purchases and apply available current-patch item group restrictions. Ability order and minor runes use observed general skill orders and recorded rune pages.

See the [build recommendation approach](build-recommendation-approach.md) for the equations, role weights, and interpretation.
