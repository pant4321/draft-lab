# Dataset maintenance

[Back to README](../README.md)

## Collect and rebuild

The pinned data checkout at `dist/data` is the [private dataset repository](https://github.com/pant4321/draft-lab-data). Initialize it before running the site or tests. To collect or refresh data, switch the submodule to its `main` branch and update it first.

Collection requires Python and `beautifulsoup4`.

```sh
git submodule update --init -- dist/data
git -C dist/data switch main
git -C dist/data pull --ff-only
python -m pip install beautifulsoup4

# Collect a missing patch, then rebuild from saved captures.
python scripts/update_datasets.py --patches 16.23 --emerald-plus

# Backfill Emerald+ for every saved All ranks patch.
python scripts/update_datasets.py --emerald-plus

# Capture fresh All ranks data for the latest saved patch.
python scripts/update_datasets.py --refresh-latest

# Rebuild offline, without downloading data.
python scripts/update_datasets.py

# Validate before publishing.
python -m unittest discover -s tests/python
npm test
```

Replace the example patch number with the released patch you need. Already-saved patches are verified and skipped. Rerun the command with the same cache root to resume a backfill. Each explicit latest-patch refresh starts a new cache. Resume an interrupted refresh with `python dist/data/collect_draft.py` and the same cache and output paths. Failed collections publish no snapshot.

Commit and push the reviewed dataset changes from `dist/data`. Then stage `dist/data` in the site repository to commit the new submodule revision. The Pages workflow verifies the saved data and stages the combined catalogs, role files, and their public index. It also publishes a checksummed stats-only bundle for each patch selected for a combined dataset. Those bundles power **Settings → Patches**. Run `npm run build` to inspect what gets published in `build/pages/data`. Vite copies the verified files from `build/web-public/data`.

## Update champion portraits

The collector reads Riot's English champion roster from Data Dragon and records the exact version as `ddragonVersion` in each catalog. After rebuilding the snapshots, use the version in `dist/data/draft/catalog.json` for portrait updates. Riot publishes the available versions in its [Data Dragon version list](https://ddragon.leagueoflegends.com/api/versions.json).

The site publishes portraits from `web/public/assets` using each champion's catalog `key`. Keep the key's capitalization and use `MonkeyKing.png` for Wukong. Copy any new portraits from the collector's local `dist/assets` directory into `web/public/assets`, or download the file directly from Data Dragon. This PowerShell example refreshes Wukong's portrait from the catalog's version.

```powershell
$catalog = Get-Content -Raw dist/data/draft/catalog.json | ConvertFrom-Json
$key = 'MonkeyKing'
$version = $catalog.ddragonVersion
$url = "https://ddragon.leagueoflegends.com/cdn/$version/img/champion/$key.png"
Invoke-WebRequest $url -OutFile "web/public/assets/$key.png"
```

Run `npm run build` and `npm run test:e2e -- pages.spec.ts` before committing the portrait changes. The production artifact test checks that both published rank catalogs have every required portrait.

## Riot API pilot

`scripts/riot_collector.py` runs a private NA ranked solo/duo sample. It rotates discovery across Gold, Platinum, and Emerald, deduplicates matches before fetching details, and saves complete drafts by patch in `data/matches.sqlite3`. The same match response supplies each champion's end-of-game item slots, primary and secondary rune trees and selections, and stat shards. The `builds` column stores those fields by team and role when available. Earlier rows without build data have a null `builds` value. The queue also stores the Riot account identifiers needed to poll recent match lists. Keep the whole database private and review coverage before using pilot data for public recommendations.

On the DraftEdge Collector server in Pterodactyl, save the key as the only text in `riot-api-key.txt` at the root of **Files**. The worker checks for the file every 15 seconds while waiting for a key. If Riot rejects a key, replace the file to resume from the existing queue. Keep server file access restricted and exclude `riot-api-key.txt` from backups. Stop the worker before copying its SQLite database for a manual backup.

Run `python riot_collector.py --summary` from the server's data volume to inspect aggregate counts by patch and how many matches include builds without querying Riot. Run `python -m unittest discover -s tests/python` from the repository to test the collector.

## Files and replacement policy

| Path | Purpose |
| --- | --- |
| `dist/data/collect_draft.py` | Private snapshot collector |
| `dist/data/patches/<patch>/` | Validated patch snapshots |
| `dist/data/patch-revisions/<patch>/<capture>/` | Staging and retained captures from explicit refreshes |
| `dist/data/draft/` | Generated combined view |
| `dist/data/emerald-plus/patches/<patch>/` | Validated Emerald+ patch snapshots |
| `dist/data/emerald-plus/patch-revisions/<patch>/<capture>/` | Staging and retained Emerald+ refresh captures |
| `dist/data/emerald-plus/draft/` | Generated Emerald+ combined view |
| `dist/data/datasets.json` | Local dataset index and file checksums |
| `dist/data/history/30d-2026-11-14/` | Original rolling-window archive |

Keep completed historical patches and the rolling-window archive unchanged. A validated current-patch refresh may fully replace its normal patch directory; remove the superseded copy and rebuild afterward. The rebuild records the selected source directory and uses each patch exactly once, even if multiple captures remain.

For a final capture after a patch rolls over, save both cohorts in their `patch-revisions` directories and keep the earlier captures. Pin the final manifest hashes in [final-patch-hashes.json](../tests/fixtures/final-patch-hashes.json). The tests require both combined datasets to keep using those exact captures as newer patches are added.

The rolling-window archive overlaps the patches and never enters the combined view. Offline rebuilding verifies every saved capture, rejects corrupt or conflicting sources, and reuses unchanged results. The browser verifies SHA-256 checksums before loading data.

## Sources and aggregation

The collector saves enemy matchup and ally synergy snapshots from LoLalytics global ranked solo/duo. It validates patch, champion, role, queue, and cohort, and records provenance, response hashes, collection times, and the matching champion roster. The Emerald+ combined view uses its own patch snapshots and appears in the rank dropdown once its patch coverage matches All ranks.

Candidate win rates are weighted by champion-role game counts. Each pair's normalized matchup delta and observed win rate are weighted by that pair's own game count. The rebuild sums game counts and uses them to recalculate role pick shares. Missing pairs stay missing. The snapshot contains rounded aggregate stats.

With every patch selected, the browser loads the offline combined dataset as usual. With patches excluded, it recomputes role metadata and the requested matchup files from the selected cohort's individual patch stats using the same game weighting and recommendation eligibility rules. Patch exclusions are saved in the browser and apply to both rank cohorts.

All source-listed roles are retained. Combined recommendation eligibility requires at least 1,000 games and either an inclusive 0.5% role pick share or the champion's primary role. Lower-usage records can still support matchup lookup and role inference.

Use the dataset index and generated catalog for patch coverage, capture dates, and profile counts. The combined snapshot spans several balance patches and refreshes when a new version is published.
