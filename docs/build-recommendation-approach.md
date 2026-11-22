# DraftEdge build recommendation approach

DraftEdge is a League of Legends draft assistant. It helps players choose a champion during champion select. Its Windows companion reads the picks from League and opens a build in the same browser tab after the player locks in.

Show one build the player can follow at a glance, with starting items, boots, runes, summoner spells, ability order, and a purchase path. Change the usual build when the draft provides strong enough evidence. A difficult lane opponent can drive an early change on their own. Several enemies can also push the same item up the list, especially later in the build.

## What the player sees

A Darius top player starts with the usual build for their chosen rank. If the enemy draft supports different boots, the overlay can show **Draft pick · supported vs. Malphite top**. An item that becomes more plausible while the usual choice still ranks higher can appear under **Alternatives** with a **Draft option** badge.

Expand a badge to see the usual choice, which opponents drove the change, how often each option was chosen, and how many games those numbers represent. For a **Draft option**, matchup samples below 100 exact purchases show pick share and count. If every supporting matchup falls below 100, the option shows **Low sample** and its card hides the win rate. The matchup menu also lets the player compare one opponent with the all-matchups view.

## Where the numbers come from

DraftEdge uses LoLalytics Ranked Solo/Duo stats for the player’s champion, role, and selected rank setting. **All Ranks** and **Emerald+** each have their own samples. An **all-matchups** sample gives the usual build. An **opponent sample** describes how players built when one enemy champion was present in an assigned role. A single match can appear in several opponent samples.

For each decision, use the shortest supported window with enough comparable data. Try the **current patch**, then **14 days**, then **30 days**. Require 200 total recorded choices in the baseline and a comparable opponent sample of at least 200 when opponents are known. For a choice made before or during lane, require data for at least one known lane opponent before preferring the shorter window. For later choices, one qualifying opponent sample can be enough. Choose the window from coverage and total counts before evaluating individual options. Use the same window for the baseline and opponent comparisons. The overlay lists wider windows. It filters out choices unavailable on the current patch when the option catalog is available. Rolling windows can still include balance changes to an existing item or rune.

**Pick share** is the fraction of recorded choices made at a particular point in the build. If an item was bought 2,000 times out of 10,000 recorded third legendary purchases, its pick share there was 20%. Boots are counted separately. Starting sets, spell pairs, and keystones each use their own counts. A keystone is the main rune at the top of the primary rune tree.

## How opponents influence each choice

Compare each option with the usual choice at the same point in the build. Ask whether that option becomes more common relative to the usual choice when a particular enemy is present. Pull estimates from small matchup samples toward the general split. Give the lane more influence for choices made before or during lane, and spread the influence more evenly for later purchases.

| Decision | Direct opponent | Enemy jungler when you are a laner | Other enemies |
| --- | --- | --- | --- |
| Starting items, spells, and supported minor rune choices | 1.00, or 0.70 each for the opposing bot carry and support | 0.25 | 0.10 |
| Keystone and first legendary | 0.85, or 0.58 each for the opposing bot carry and support | 0.35, or 0.34 for bot carry and support | 0.25 |
| Upgraded boots and second through fifth legendaries | 0.48, or 0.46 each for the opposing bot carry and support | 0.38, or 0.36 for bot carry and support | 0.38, or 0.36 for bot carry and support |

The opposing jungler is the direct opponent for a jungler. For bot carry and support, the two enemies in their lane both count as direct opponents. Each row has a total weight of at most 2.0 for a full draft. Use the listed weights as-is for partial drafts so revealing another enemy leaves the earlier weights intact. These are starting weights for testing.

The ranking starts from general popularity and adds the weighted matchup shifts. Neutral enemies contribute little, so a strong lane matchup can carry an early choice. Several positive signals add together, and negative signals pull the option back.

## When an option earns a badge

1. **Check the amount of data.** A matchup needs at least **200 total recorded choices** at that stage and at least **25 purchases of the exact option** to enter the evidence check and support a **Draft option**. To support a **Draft pick**, one matchup must have at least **300 total recorded choices** and **100 exact purchases**. Assess each matchup separately because they can contain some of the same games.
2. **Check both increases.** Compare the matchup with the rest of the same sample after removing that opponent’s games. The candidate’s own adjusted pick share must rise, and the lower bound for its gain relative to the usual choice must clear zero after accounting for the screened comparisons. For example, if Steelcaps drop from 60% to 25% and Swifties stay at 10%, Swifties gain ground relative to Steelcaps. Their flat pick share leaves Malphite out of the supporting opponents for Swifties.
3. **Check the size.** Start with a minimum **0.4 percentage-point increase** in the option’s share of the draft-adjusted scores. Apply it to the same weighted score that ranks the options. A change from 10.0% to 10.4% is 0.4 percentage points.

Feature a **Draft pick** when an option outranks the usual choice, meets the size check, and has at least one supporting matchup that clears both replacement floors. Show a **Draft option** under Alternatives when the option meets the size check and has at least one supporting matchup that clears the option floors, even if it falls short of the replacement criteria. Credit only opponents that clear the checks for the badge shown. If the leading challenger falls short, consider the next eligible option. A single strong matchup can still drive a change in a full draft.

## How the choices fit together

- **Starting items and spells.** Use the ranking and evidence checks for the starting set and summoner spell pair. Spell pairs are scored together.
- **Runes.** Score the keystone and show a recorded page that uses it. Label the displayed numbers as **Keystone stats**. Minor runes and shards can adapt when the data shows how often they were chosen with the selected keystone, rune tree, and row. Keep the recorded page when only overall rune totals are available.
- **Ability order.** Use the general sample for skill priority and level-by-level order.
- **Boots and early legendaries.** Score basic boots and upgrades alongside the recorded **No boots** choice when the feed provides it. The first and second legendary columns show their own win rates and counts. A no-boots choice occupies no purchase slot. The no-boots percentage describes observed games, which can include games that ended before players bought boots.
- **Later items.** Rank purchases at their actual legendary slot. Leave out items already in the displayed path and apply current item group limits from the game data when available. Each later slot still uses slot-wide observations. The feed does not provide its pick rate or win rate conditioned on the displayed earlier purchases.

## Win rates and signs of error

Show the observed game count for each choice and de-emphasize win rates for low-sample draft options. Comparing two items at the same purchase slot makes the comparison more useful, but earlier purchases, player skill, and how far ahead someone was can still affect the result. Track large, persistent same-slot win-rate gaps as candidates for review. Evaluate a win-rate guardrail on separate samples before using it to block or promote a pick.

| What you might see | How DraftEdge should handle it |
| --- | --- |
| One matchup gives a huge increase on a few purchases. | Keep the usual choice featured and show the small count if the option appears under Alternatives. |
| A lane counter gets buried when other enemies are revealed. | Check the lane weights and each positive contribution. Neutral opponents should leave the strong lane signal intact. |
| A niche item moves from 1% to 1.1%. | Use the minimum size check before adding a badge. |
| The feed uses mismatched dates, rank, roles, or purchase counts. | Skip those comparisons. Show how much usable matchup data remains and fall back to the usual choice when needed. |
| The item path repeats a purchase or combines incompatible items. | Check the full path against verified purchase restrictions. Show joint build statistics only for a recorded sequence or a verified group of separate sequences. |
| Similar windows keep producing different featured choices. | Review borderline cases by rank and slot. Compare against separate time windows to see which changes persist. |

## Data checks and test cases

The live feed returned current-patch, 14-day, and 30-day data for Darius top versus Malphite top. It provides per-slot item counts and observed win rates. The rune breakdown gives overall primary and secondary rune counts. Individual rune swaps would need counts tied to the displayed page. For item compatibility, DraftEdge reads item group membership and maximum ownership from the current game data. [LoLalytics matchup example](https://lolalytics.com/lol/darius/vs/malphite/build/) · [Riot Data Dragon reference](https://developer.riotgames.com/docs/lol#data-dragon)

| Test | Expected behavior |
| --- | --- |
| One strong lane opponent and four neutral enemies | The lane change can qualify. A current-patch Emerald+ spot check with Malphite alone moved Mercury’s Treads ahead of Steelcaps. Mercs rose from about **27%** of recorded upgraded boots to **62%**. Black Cleaver gained support as a first legendary and stayed an alternative to Youmuu’s Ghostblade. |
| The usual item drops and the candidate’s own share stays flat | The opponent gives the candidate no badge support, even if the candidate gains ground relative to the usual item. |
| Two durable frontline enemies and three neutral enemies | Both relevant boosts contribute. A plausible earlier smoke-test result is Void Staff or Liandry’s Torment on Ahri. Actual output depends on the individual matchup counts. |
| A sparse sample, such as the one recorded fifth legendary Riftmaker against Heimerdinger | The draft badge stays off and the build keeps the usual choice at that slot. |
| A slot contains many items with one to five purchases | Only comparisons that clear the 25-purchase screening floor enter the confidence adjustment. Both badges use that comparison set. |
| A fifth enemy is revealed | The existing opponents retain their assigned weights. |
| A 2% option and a 40% option each gain 0.4 percentage points | The same point gain represents a 20% relative increase for the first option and 1% for the second. Test whether the current floor admits common-item noise or hides well-supported niche items. Evaluate a 10% relative lift requirement if needed. |
| A popular pick with weaker same-slot win rates | Keep the observed rates and counts visible. Record whether an outcome guardrail would help before applying one to recommendations. |
| A build can skip boots or an item conflicts with a prior purchase | Rank the reported no-boots choice alongside the other boot choices, keep legendary slots independent of boots, and show only legal continuations. |

## Scoring and statistical details

Let `a` be a candidate and `u` the usual choice. `c₀(x)` and `cᵢ(x)` are the observed counts for choice `x` across all matchups and against enemy `i`. `N₀` and `Nᵢ` are the corresponding totals. `A` is the set of comparable options. Start with a prior weight of 200 choices and test its sensitivity across purchase stages.

```text
generalShare(x) = (c₀(x) + 0.5) / (N₀ + 0.5 × |A|)
restShareᵢ(x) = (c₀(x) − cᵢ(x) + 0.5) / (N₀ − Nᵢ + 0.5 × |A|)
adjustedShareᵢ(x) = (cᵢ(x) + 200 × restShareᵢ(x)) / (Nᵢ + 200)
shiftᵢ(a, u) = ln(adjustedShareᵢ(a) / restShareᵢ(a)) − ln(adjustedShareᵢ(u) / restShareᵢ(u))
score(a, u) = ln(generalShare(a) / generalShare(u)) + Σᵢ wᵢ × shiftᵢ(a, u)
modeledShare(a) = exp(score(a, u)) / Σₓ∈A exp(score(x, u))
modeledGain(a) = modeledShare(a) − generalShare(a)
```

The usual choice has score zero. The normalized share is an internal scoring measure. Use each opponent’s weighted contribution to explain the change. Omit a comparison if the source cannot establish comparable matchup and remainder counts for the candidate and the usual choice.

For the evidence check, form a two-by-two table of candidate and usual purchases in the matchup and its remainder. Credit the opponent only when the raw share increases, `adjustedShareᵢ(a) > restShareᵢ(a)`, and the one-sided comparison supports an odds ratio above 1. Checking the raw share keeps smoothing from turning equal shares into an increase.

For each decision, let `M` be the number of comparable candidate and opponent pairs with at least 200 recorded choices and 25 purchases of the candidate. Use `0.05 / M` for each one-sided check. Both badges share this set, including when a matchup crosses the replacement floors. Count pairs before checking the direction or size of the lift. Use the log odds ratio's normal approximation when all four cells are at least 5. For smaller cells, use the one-sided Fisher exact test with the same threshold. [NIST on odds ratios](https://www.itl.nist.gov/div898/software/dataplot/refman1/auxillar/oddschis.htm) · [Fisher's exact test for count data](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/fisher.test.html)

The purchase floor uses the same observed matchup counts as the test, so treat the adjusted bounds as a recommendation screen. A formal family-wide error guarantee would require an independently chosen shortlist or a method that accounts for selection. Keep the evidence per opponent because their samples can share games. [Research on how screening affects statistical tests](https://pmc.ncbi.nlm.nih.gov/articles/PMC2906865/)
