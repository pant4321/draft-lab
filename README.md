# Draft Lab

A role-aware League of Legends pick recommender. Enter revealed allied and enemy champions, choose your open role, and rank available candidates by their normalized counter and synergy effects across every filled slot. Includes bans, duplicate prevention, per-pick contributions, browser-local draft persistence, and an optional overall-win-rate term.

[Open Draft Lab](https://pant4321.github.io/draft-lab/)

The Qiyana test page and preset draft button have been removed from the app. Historical research notes remain in `docs/qiyana-spread.md`.

## Run

Requires Node and Python; no JavaScript dependency installation or build step.

```
npm test
npm run dev
```

Open http://127.0.0.1:8765. Host `dist/` as a static site.

## Publish

This repository hosts the site on GitHub Pages at https://pant4321.github.io/draft-lab/. The workflow in `.github/workflows/pages.yml` runs the tests, uploads `dist/`, and deploys after a push to `main`. It can also be run manually from the repository's Actions tab. In Settings → Pages, the publishing source is GitHub Actions.

No build step, server, API key, or runtime data service is required. Site links, module imports, portraits, and data paths are relative so they work under the `/draft-lab/` project path. Tests check those paths alongside the scoring and dataset tests. Picks stay in browser storage for this origin; drafts saved on the previous hosting address do not transfer automatically. To update the frozen dataset, run the collector locally, review the resulting files, run the tests, and push the update.

## Dataset

The frozen November 14, 2026 snapshot contains 173 champions, 263 champion-role profiles, and 405,150 role-specific pair cells. Profile counts: Top 57, Jungle 64, Mid 57, Bot 35, Support 50. Data uses global ranked solo/duo, all ranks, rolling 30 days. Icons and champion IDs come from Riot Data Dragon 16.22.1.

The collector reads LoLalytics' public champion build pages for enemy pairs and the same public team endpoint used by its Synergy tab for ally pairs. Every profile retains both source URLs, response hashes, and collection time. It uses published normalized Delta 2 values, rather than treating raw matchup win rates as counter or synergy strength. No Machine LoLing code, scores, data, or weights are used. The spread graph follows the user-supplied visual reference.

Role tier lists identify candidate roles. A role profile needs at least 1,000 champion games and 0.25% of the listed role pool, or must be that champion's most-played role. All 173 champions have at least one supported role. Picks entered in either draft can use any champion; the chosen slot determines the role used for pair lookup. Role assignment is manual, including flex picks.

Recollect with Python and `beautifulsoup4`:

```
python scripts/collect_draft.py --cache cache-draft-new
```

Each cache is a frozen collection attempt; use a fresh directory for a new window. Parsed profile caches make interrupted work resumable. Keep the collector's output complete and rerun tests before publishing. A failed profile makes collection exit unsuccessfully. Dataset files are split by candidate role and loaded on demand.

## Score

For candidate C in the user's role, look up every revealed ally and enemy by champion AND role. Enemy Delta 2 is from C's perspective. Ally Delta 2 represents the shared pair's normalized synergy. Blank slots add no term.

For each pair:

```
adjusted effect = published normalized delta in pp * n / (n + 1000)
draft edge = sum(adjusted enemy effects) + sum(adjusted ally effects)
```

The 1,000-game setting is a fixed conservative shrinkage choice, not a fitted or calibrated parameter. It reduces the influence of noisy small samples. Both raw values and pair game counts remain visible in the contribution breakdown.

Default ranking uses draft fit only. `Include base WR` adds `100 * (candidate overall WR - 0.5)`. This switch ranks by base strength plus fit and remains optional because overall win rates include player and draft selection effects.

Taken and banned champions are excluded. A candidate missing any revealed pair is left unranked rather than given an invented neutral contribution. A blank draft shows no ranking. Candidate order is descending score with stable ID tie-breaking. The user's own slot is a preview, not a recorded pick, so it is excluded from all pair inputs. An allied occupied role cannot become the user's role until that allied pick is cleared.

The result is an additive draft score expressed in adjusted percentage-point contributions. It is not a predicted game win probability or a validated causal gain from selecting the champion. Pair samples overlap, pair effects can interact, and summing them can double-count correlated information. No extra arbitrary role multiplier is applied; each revealed role enters through its own pair effect. Unknown future picks are not imputed or penalized. The optional base term and fixed shrinkage both need held-out validation before presenting calibrated match odds.

## Informational blindability

The Blindability column is a static 0-100 role-relative consistency percentile. Higher means lower estimated variability across common opponents and teammates. It is not a win probability, and it does not enter draft edge, candidate sorting, bans, score modes, or any contribution. It is computed once for the complete role candidate pool before draft filtering and remains fixed while picks change.

For each of five enemy roles and four ally roles, use the independent catalog role pick rates, filter at 0.5% role pick rate and at least 100 games per pair, and normalize weights within the group. Each group needs at least five pairs and 80% of the eligible pick-rate weight covered. Compute weighted delta variance and subtract `sum(w*(1-w)*10000*p*(1-p)/(n-1))`, treating baseline rates as fixed. Average the nine corrected variances equally, then take the square root. Negative per-role corrected variances are retained until the final average, avoiding positive bias from clipping individual groups.

The score is the empirical percentile of lower estimated spread among all resolved candidates in that same role, including picks currently banned or taken. Ties receive their midpoint percentile. Missing groups, inadequate coverage, a nonpositive corrected overall variance, or fewer than two comparable candidates yield an unavailable score rather than a false perfect score. The accessible score label reports the estimated spread and peer count. This approximate method-of-moments metric assumes fixed baselines and binomial pair sampling, and does not include baseline uncertainty or guarantee safety in any specific draft.

Hover, focus, or tap any blindability number to open the champion's WR delta spread, following the supplied screenshot. Opponent portraits sit at their exact published normalized delta on the horizontal axis and stack vertically to avoid overlap. The background fades from red to green, zero has a vertical guide, and a dashed line marks -2 pp. The white curve is a normal approximation centered at the selected role group's weighted mean, with standard deviation equal to the square root of its noise-corrected variance. The badge reports this group-specific estimated true spread in percentage points. Curve height is fixed for display and is not a density axis; one icon represents one eligible matchup, irrespective of pick rate.

The graph defaults to enemies in the candidate's own role. Its selector offers all five enemy roles and four other allied roles. Each group uses exactly the same common-champion filter, independent meta weights, minimum pair sample, coverage requirement, and variance correction as the overall blindability metric. A group without enough coverage displays no chart. A group whose variance cannot be resolved still shows its observed portraits, omits the curve, and labels true spread as unresolved. Each portrait has a hover label with champion, raw delta and games. Group choices and all graph data stay in browser memory; no additional stats are fetched.

The per-group spread in the graph differs from the overall spread used for the 0-100 blindability score, which combines all nine groups. The displayed score and draft edge retain their formulas. This visual uses our frozen snapshot and estimator, so it does not claim to reproduce the reference's numbers. Move away, click outside, close, or press Escape to dismiss. Tests cover per-role delta and weight agreement, noise correction, exact portrait coordinates, stacking without overlap, unresolved estimates, and score/ranking invariance.

## Verification

`npm test` covers the exact two-ally/three-enemy jungle example, scoring across enemy roles, synergy-driven changes in the best pick, duplicate and ban handling, missing data, empty drafts, sample adjustment, optional strength, all 405,150 pair cells, candidate coverage for all 173 champions, and a real five-pair draft in every role. Qiyana calculation tests remain separately available.

Browser checks exercise manual picks, exclusion rules, bans, role changes, search, contribution breakdowns, and draft reset. Blindability checks cover variance correction, role-relative ranking and ties, insufficient data, and exact score/ranking invariance. Spread popup browser checks cover tap, keyboard focus, Escape, close, champion selection, matchup group changes, unchanged draft edge, and viewport containment at desktop and 390px width. Draft state stays in browser local storage. Reset clears picks and bans; the chosen role and optional score mode remain selected.

## Next validation

Test ranking against held-out matches, choose shrinkage strength using separate training data, and evaluate cross-pair correlations. Collect additional rank cohorts before offering rank selectors. Freshness is a frozen date, not a claim of live patch updates.
