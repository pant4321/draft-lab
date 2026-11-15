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

No build step, server, API key, or runtime data service is required. Site links, module imports, portraits, and data paths are relative so they work under the `/draft-lab/` project path. Tests check those paths alongside the scoring and dataset tests. The entry script and stylesheet URLs include hashes of their LF-normalized contents to refresh cached files after updates; refresh these queries in `dist/index.html` whenever `dist/draft.mjs` or `dist/draft.css` changes. Picks stay in browser storage for this origin; drafts saved on the previous hosting address do not transfer automatically. To update the frozen dataset, run the collector locally, review the resulting files, run the tests, and push the update.

## Dataset

The frozen November 14, 2026 snapshot contains 173 champions, 263 champion-role profiles, and 405,150 role-specific pair cells. Profile counts: Top 57, Jungle 64, Mid 57, Bot 35, Support 50. Data uses global ranked solo/duo, all ranks, rolling 30 days. Icons and champion IDs come from Riot Data Dragon 16.22.1.

The collector reads LoLalytics' public champion build pages for enemy pairs and the same public team endpoint used by its Synergy tab for ally pairs. Every profile retains both source URLs, response hashes, and collection time. It uses published normalized Delta 2 values, rather than treating raw matchup win rates as counter or synergy strength. No Machine LoLing code, scores, data, or weights are used. The spread graph follows the user-supplied visual reference.

Role tier lists identify candidate roles. A role profile needs at least 1,000 champion games and 0.25% of the listed role pool, or must be that champion's most-played role. All 173 champions have at least one supported role. Picks entered in either draft can use any champion; the assigned slot determines the role used for pair lookup.

## Windows companion

[Download DraftLab.exe](https://github.com/pant4321/draft-lab/releases/latest/download/DraftLab.exe), run it, and leave its launcher open while drafting. It opens the bundled Draft Lab interface in your browser. No Python installation or Riot API key is required. The launcher auto-detects League; use `League folder…` if League is installed somewhere it cannot find. `Open Draft Lab` reopens the interface, and `Quit` stops the companion.

The companion reads locked champion-select picks, completed bans, and your assigned role from the local League Client API about once a second. Teammate assigned roles are hints, enemy roles are inferred, and your manual role corrections always win. A new draft clears previous corrections. `Live sync` pauses or resumes importing; manually editing picks or bans during champion select also pauses it. Dragging roles continues live sync. Your own locked champion appears in your reserved slot. Public GitHub Pages remains usable for manual drafting.

Companion v0.1.4 and later check this repository's latest stable GitHub release in the background at startup. A newer uploaded `DraftLab.exe` shows a **Download update** button in the launcher. It opens the official release download in your browser; it does not install or restart anything automatically. Offline or failed checks leave drafting available and show **Retry**. Install v0.1.4 manually once when upgrading from a published earlier version, which does not include the checker.

Only loopback connections are accepted. Riot's local credentials stay in the native process, the client connection verifies the bundled Riot certificate, and the browser bridge requires its own per-launch session token. The companion only calls the two read endpoints for gameflow and champion select. It does not send player identities to the page or operate picks/bans in the League client. Stats and portraits are bundled; this release uses the frozen dataset documented below. The initial Windows executable is unsigned. See [companion setup and build notes](companion/README.md).

## Role assignment

Drag a revealed champion to another role on the same team. The card lifts when pressed, then follows the mouse as an opaque card with a shadow while the source slot fades and valid targets glow. Dropping onto an occupied role swaps both champions. Escape or releasing outside a valid role cancels the move. The ↔ button offers the same move options for keyboard and touch use. Your own recommendation slot remains reserved; preview suggestions cannot be moved into the recorded draft.

Enable `Auto roles` to estimate roles whenever picks change. The guesser tests every valid one-to-one team assignment and maximizes the product of each champion's role usage, derived from its saved games by role. This lets later picks resolve earlier flex picks. An unsupported role gets a one-game fallback weight, allowing unusual assignments when needed without treating missing data as a normal role. Exact ties prefer existing placements. The result is a heuristic based on the supported role snapshot, not a calibrated role probability.

A `?` flags an unsupported role or another assignment within a factor of two of the best joint likelihood. A manual move pins that champion's role, marked `SET`; a manual swap pins both. Corrections follow champion IDs across role inference updates and remain until that champion leaves the draft, `Clear corrections` is used, or the draft is reset. Auto roles, draft state, and corrections persist in browser storage. Auto roles starts off for existing manual drafting. The Windows companion uses this same assignment module for live client snapshots.

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

Taken and banned champions are excluded. A candidate missing any revealed pair is left unranked rather than given an invented neutral contribution. Before any ally or enemy is revealed, the website lists the selected role's champions by descending blindability, with alphabetical ties and unavailable blindability last. Bans still exclude champions. Counter, synergy, and draft edge show dashes, and `Include base WR` is disabled in this view. The user's slot stays empty until a candidate is inspected. Blindability graphs work in both views.

Once any ally or enemy is revealed, candidate order switches to descending draft score with stable ID tie-breaking. Blindability never affects draft edge or this order. Clearing the draft returns to the blindability list. The user's own slot is a preview, not a recorded pick, so it is excluded from all pair inputs. An allied occupied role cannot become the user's role until that allied pick is cleared.

The champion picker sorts by descending pick rate in the clicked slot's role, followed by alphabetical ties. The ban picker uses the user's role. Search filters that order; champions without data for that role appear after champions with role pick rates. A short label in the picker identifies the role used for popularity.

**Your pool** opens a role-specific champion selector. Add or remove champions with immediate browser-local saving; switching roles loads that role's separate pool. The selector offers champions with a saved profile for the selected role. Pool choices remain through draft resets and live client updates. They are stored separately from the draft, so a reset does not erase preferences. These preferences are local to the browser origin and do not sync between GitHub Pages and the companion's localhost page.

Recommendations put **Your pool** first, followed by **Other champions**. Each section retains the existing descending blindability or draft-edge order, and numbering starts at 1 in each section. Pool membership does not change any score, blindability percentile, pair contribution, eligibility, or data-coverage rule. Banned, picked, unsupported, and unranked candidates are not promoted into the list. An empty pool keeps the original single list; a pool with no available candidates displays an empty-section message above the other champions. Search filters both sections.

Clicking the shaded backdrop dismisses the champion/ban picker just like its close button or Escape. Clicking content or dialog padding, or dragging from inside to outside, keeps it open. Clicking the spread graph retains focus inside its popup; its selector and close button keep their normal behavior.

The result is an additive draft score expressed in adjusted percentage-point contributions. It is not a predicted game win probability or a validated causal gain from selecting the champion. Pair samples overlap, pair effects can interact, and summing them can double-count correlated information. No extra arbitrary role multiplier is applied; each revealed role enters through its own pair effect. Unknown future picks are not imputed or penalized. The optional base term and fixed shrinkage both need held-out validation before presenting calibrated match odds.

## Counterpick-safety blindability

Blindability is a static 0-100 percentile of counterpick safety within the selected role. It measures pick-rate-weighted negative enemy matchup effects. Lower downside earns a higher score. It sorts the empty-draft list and remains fixed while picks and bans change. Base win rate, positive matchup bonuses, ally synergy, and player preferences do not enter the score. Role WR remains visible separately. Blindability never enters draft edge, draft-edge ordering, pair contributions, or the optional `Include base WR` mode.

For each of the five enemy roles, use independent role pick rates from the saved catalog. Exclude the candidate itself and zero/unlisted role pick rates. Include rare recorded roles rather than applying a popularity floor. A pair needs at least 100 games and a finite normalized Delta 2. Each enemy role needs at least five eligible pairs and 80% of positive meta weight covered. Normalize the covered pick-rate weights within that role, using the full eligible pool including favorable matchups as the denominator.

```
adjusted delta = normalized enemy Delta 2 * n / (n + 1000)
role downside = sum(opponent role pick-rate share * max(0, -adjusted delta))
weighted downside = sum(role downside across all five enemy roles)
```

This uses every eligible negative matchup, not a worst-matchup cutoff. A 5 pp adjusted loss against a 1% opponent contributes 0.05 pp; a 1 pp loss against a 20% opponent contributes 0.20 pp. Positive effects contribute zero loss while retaining their share of the full opponent pool. Increasing positive bonuses cannot increase downside. Ally synergy and candidate WR cannot affect the score. Sample shrinkage reduces the influence of small pair samples; variance noise subtraction is used only in the spread graphs.

Convert downside to a percentile among resolved candidates in the same role: `round(100 * (higher-downside peers + 0.5 * tied peers) / (peer count - 1))`. Compare unrounded values with a 1e-9 tolerance. A score of 90 means lower modeled downside than about 90% of rated role peers, not a 90% win probability. Banned/taken candidates remain in the comparison pool so scores stay fixed. Missing enemy coverage or fewer than two comparable candidates produce an unavailable score. A noise-dominated graph does not invalidate a separately supported downside estimate.

This is a heuristic from frozen all-ranks aggregate data. The 100-game minimum, 80% coverage threshold, and 1,000-game shrinkage are design choices, not fitted parameters. The metric describes negative exposure against ordinary role pick shares; it does not model the enemy adapting its selection after seeing the candidate. Pair effects are observational and can overlap, so the sum is not a predicted causal win-rate loss. Low WR champions can score highly if they have little negative exposure. Validate the score on held-out ordered drafts before claiming better first-pick outcomes.

Hover, focus, or tap any blindability number to open the supplied-reference-style WR delta graph. The summary shows weighted downside. Graphs remain separate descriptive views, including all five enemy and four other ally roles. For visual readability they retain the 0.5% common-champion role-pick floor, and also require pair win probabilities for variance noise correction. The score includes rarer recorded roles and needs only enemy deltas and counts, so missing ally data cannot lower blindability.

Portraits sit at their exact published normalized deltas and stack vertically. The graph has a red-to-green background, zero guide, and dashed -2 pp guide. Its white normal-approximation curve is centered on the group's weighted mean, with standard deviation from `observed variance - sum(w*(1-w)*10000*p*(1-p)/(n-1))`. The badge reports that group's estimated true spread. Curve height is fixed for display; one icon represents one eligible matchup regardless of pick rate. Unresolved variance hides the curve and labels spread unresolved; missing graph coverage shows no chart. Portrait labels include raw deltas and games.

Graph spread is not used in the safety score. Group choices and graph data stay in browser memory without new stats requests. This visual uses our frozen snapshot and estimator and does not claim to reproduce the reference's numbers. Move away, click outside, close, or press Escape to dismiss.

## Verification

Champion-pool tests cover stable group ordering for both scoring modes, unchanged scores and eligibility, role-specific persistence, reset independence, and malformed settings. Browser checks cover selecting/removing pool champions, switching roles, grouping, bans, reload persistence, and backdrop dismissal.

Overlay regression tests cover graph-click focus retention, native selector/button behavior, backdrop dismissal, dialog padding, pointer cancellation, and drags across the dialog boundary. Browser checks cover repeated graph clicks, group selection, Escape, champion and ban backdrop dismissal, and keeping applied bans after dismissal.

Startup-update tests cover numeric version ordering, stable release filtering, uploaded executable validation, bounded unauthenticated requests, offline/rate-limit errors, background execution, and retry deduplication. The local frozen build was checked against the live GitHub metadata endpoint, and both picker backdrops were checked through that executable's bundled page.

Companion regression tests cover custom-game bots whose selected roster champions have no pick actions, human hover exclusion, and inferring an unassigned local role from four known teammate roles.

Default-list tests cover all five real role pools, descending blindability, alphabetical ties, unavailable scores, bans-only drafts, switching to unchanged draft-edge rankings when a pick arrives, and role-specific picker popularity. Browser checks cover default graphs, role changes, pick-triggered sorting, reset, bans, and picker sort labels.

`npm test` covers the exact two-ally/three-enemy jungle example, scoring across enemy roles, synergy-driven changes in the best pick, duplicate and ban handling, missing data, empty drafts, sample adjustment, optional strength, all 405,150 pair cells, candidate coverage for all 173 champions, and a real five-pair draft in every role. Qiyana calculation tests remain separately available.

Browser checks exercise manual picks, exclusion rules, bans, role changes, search, contribution breakdowns, and draft reset. Role-assignment tests cover joint flex-pick inference, later arrivals, ties, uncertain assignments, own-role exclusion, stale corrections, swaps, and scoring against corrected roles. Browser checks cover a native drag to an empty role, swaps via the move button, corrections surviving new picks and reloads, clearing corrections, and the mobile move dialog. Blindability checks cover exact pick-share multipliers, rare versus common counters, sample shrinkage, positive-side/ally/base-WR invariance, summed role downside, percentiles and ties, missing enemy data, graph variance correction, and exact draft-score/ranking invariance. Spread popup browser checks cover tap, keyboard focus, Escape, close, champion selection, matchup group changes, unchanged draft edge, and viewport containment at desktop and 390px width. Draft state stays in browser local storage. Reset clears picks, bans and manual role corrections; the chosen role, auto-role setting and optional score mode remain selected.

## Next validation

Test ranking against held-out matches, choose shrinkage strength using separate training data, and evaluate cross-pair correlations. Collect additional rank cohorts before offering rank selectors. Freshness is a frozen date, not a claim of live patch updates.
