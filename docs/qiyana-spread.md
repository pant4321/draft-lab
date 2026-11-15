# Qiyana spread test

First milestone for a draft recommendation website. This site plots a frozen independent Qiyana mid matchup dataset and estimates noise-corrected spread. It does not yet recommend draft picks.

## Run

Requires Node and Python. No JavaScript package installation or build step.

```
npm test
npm run dev
```

Open http://127.0.0.1:8765. Static hosting uses `dist/`.

## Collect

Install `beautifulsoup4`, then run `python scripts/collect.py`. The collector fetches three public LoLalytics pages with identical all-ranks, global, solo/duo, middle-lane, rolling 30-day filters. Raw HTML is cached in ignored `cache/`; the public JSON records SHA-256 hashes. To collect a new window, use a new cache directory with `--cache`. Source markup changes fail validation rather than yielding invented data. Champion portraits and IDs come from Riot Data Dragon. The initial snapshot was collected November 14, 2026, using Data Dragon 16.22.1. Its 97 matched rows omit champions absent from the role tier list or below the source's 100-game display threshold.

All ranks gives a 50% bracket average and avoids an additional high-rank normalization choice. Role pick-rate percentages are computed from each champion's games divided by all games in the complete published mid tier list, before filtering opponents. The old version incorrectly applied a per-role 0.5% floor to the source's per-game percentages, which sum to about 196% in the published mid list. The corrected default includes 44 opponents rather than 56. Weights are then normalized over eligible opponents. Qiyana matchup encounter frequencies are not used as meta weights, since counterpicking can distort them.

## Calculation

For Qiyana probability `a`, opponent probability `b`, and rank-bracket mean `g`, expected opposing odds are `odds(a)/odds(b)*odds(g)`. Convert odds back with `r/(1+r)`. At all ranks `g=0.5`, giving `a*(1-b)/(a*(1-b)+(1-a)*b)`. A non-50% bracket mean must be preserved for Diamond+ data. Edge is observed minus expected, expressed in percentage points. LoLalytics' published Delta 2 is retained for audit but is not substituted for this independent calculation.

For normalized fixed weights `w`, compute `mu=sum(w*d)` and `Vobs=sum(w*(d-mu)^2)`. With fixed estimated baselines and independent binomial matchup estimates, an unbiased estimated sampling variance of each edge is `v=10000*p*(1-p)/(n-1)`. The noise contribution to the weighted, centered variance is `sum(w*(1-w)*v)`. Estimate true spread as `sqrt(max(0,Vobs-Vnoise))`. The factor `1-w` accounts for estimating the weighted mean. This is an explicit method-of-moments implementation, not a claim to reproduce the creator's unreleased code.

The fitted tail is `Phi((threshold-mu)/spread)`. Zero clipped variance yields an unresolved tail. The white curve peaks at a fixed height for shape comparison, so its vertical axis is not density. Portrait heights prevent overlap. Wilson intervals cover the matchup win rate with expected win rate held fixed. Neither those intervals nor the noise correction include uncertainty in champion baselines. Rounding, overlapping baseline samples, patch drift, rank mixtures, and player selection remain limitations. Normality is assumed for the tail view, not tested here.

## Reference and acceptance

- [Blindability video](https://www.youtube.com/watch?v=3t5dEYyLua0), odds explanation around 3:00 and noise correction around 6:00.
- [Pick-order video](https://www.youtube.com/watch?v=j7tOMY-HAsk&t=160s), Qiyana graph at 2:40. The frame reports 1.1 pp true spread. Around 3:00 it reports a 3.75% fitted tail and 2.43% counted weight below -2 pp. Rounded frame labels alone do not uniquely determine the curve.
- The second video describes 6.7 million games across ten patches, 43 eligible Qiyana matchups, and unreleased underlying data. We have not established its exact cohort or weighting rules. Video agreement is unverified. The dashed reference is an illustrative zero-centered normal with sigma 1.1 pp, not reconstructed original data.
- [Older written method](https://machineloling.com/2024/12/17/blindability/).
- [Pool designer explanation](https://machineloling.com/2026/04/28/champion-pool-designer/) describes an older normalized-delta dataset. No code or data from the pool designer is included.

Tests cover odds normalization, variance units, weighted mean correction, unresolved estimates, interval bounds, normal tails, and the actual saved data. Exact replication requires the reference matchup counts, observed win rates, baseline win rates, role pick rates, cohort filters, and weighting convention. Acceptance should compare per-matchup deltas before comparing aggregate spread.

## Snapshot import

Download the source JSON for the supported schema. Minimum fields are `qiyanaWr` as a probability and a `rows` array with unique `champion`, `games` integer >=2, `observedWr` in [0,1], `opponentWr` strictly between 0 and 1, and nonnegative `pickRate`. Browser imports additionally require `pickRateUnit: "percent_of_listed_role_games"`. `pickRate` is a percentage of the published role pool. Schema-1 imports with ambiguous per-game pick rates are rejected. Optional `id` chooses a bundled portrait. No imported script or HTML executes. Imports stay in browser memory and reset on reload.

## Next milestone

Collect role-specific pairwise enemy and ally effects from a consistent cohort. Use the product of champion odds for ally expectation. Estimate uncertain effects with shrinkage, and evaluate rankings against held-out games across patches. Sum-of-pairs scores need calibration before presenting team win probabilities. Missing pairs, bans, champion pools, role assignments, and duplicate picks need explicit treatment before a draft picker is ready.


## November 14 review

The main view now contains the champion, rank selector, graph, spread estimate, search, and a compact matchup table. Filters and data/downloads are collapsed. Long methodology, probability cards, introduction, and future-work copy were removed. The video curve is off by default; it was only an illustrative 1.1 pp normal, not the original matchup dataset.

The comparison remains unverified. A similar aggregate spread did not validate the per-matchup values. Correcting the role pick-rate floor changes the default all-ranks estimate from 1.25 pp across 56 opponents to 1.20 pp across 44 opponents. The video has 43 opponents. This is not evidence that the underlying cohorts match.

The independent all-ranks deltas agree with all 97 LoLalytics published Delta 2 values within 0.005 pp. The all-ranks source includes Malphite at -6.52 pp and 0.5095% of the listed role pool. In the separately collected Diamond+ sample Malphite is below the 0.5% role floor. Rank selection therefore changes membership, including the extreme point in the original comparison. No correction has been applied to force agreement with the video.

The Diamond+ sample has 67 available matchup rows and only about 67,000 total Qiyana games. At the default floor 40 opponents remain and estimated noise exceeds observed variance. The UI shows true spread as unresolved, not zero or a precise estimate. Rank-bracket odds normalization reproduces that source's published Delta 2 to within 0.061 pp. The two-decimal input rates and source normalization are not exact enough to claim identical formulas in that bracket.

Video example Vex is about -3.3 pp; our all-ranks result is -2.83 pp. Video example Taliyah is about -2.6 pp; ours is -0.55 pp. The differences have not been established as beyond combined sampling uncertainty: the video reports about 2,800 and 1,400 games for those examples. Rank, patch window, regions, eligibility rules, and baseline construction also remain unmatched. Noise correction affects the aggregate curve; it does not change individual portrait positions or repair cohort differences.

Recollect the second cohort with:

```
python scripts/collect.py --cache cache-diamond --tier diamond_plus --output dist/data/qiyana-diamond.json
```

Tests now cover per-role floor membership, retention of the rank-bracket neutral win rate, and agreement against independent published matchup deltas. Exact video replication still requires the reference cohort and matchup inputs.
