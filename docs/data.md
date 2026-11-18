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

Commit and push the reviewed dataset changes from `dist/data`. Then stage `dist/data` in the site repository to commit the new submodule revision. The Pages workflow verifies the saved data and stages the combined catalogs, role files, and their public index. To inspect that output locally, run `python -m scripts.build_pages build/pages` with a fresh destination.

## Files and replacement policy

| Path | Purpose |
| --- | --- |
| `dist/data/collect_draft.py` | Private snapshot collector |
| `dist/data/patches/<patch>/` | Validated patch snapshots |
| `dist/data/patch-revisions/<patch>/<capture>/` | Staging and retained captures from explicit refreshes |
| `dist/data/draft/` | Generated combined view |
| `dist/data/emerald-plus/patches/<patch>/` | Validated Emerald+ patch snapshots |
| `dist/data/emerald-plus/draft/` | Generated Emerald+ combined view |
| `dist/data/datasets.json` | Local dataset index and file checksums |
| `dist/data/history/30d-2026-11-14/` | Original rolling-window archive |

Keep completed historical patches and the rolling-window archive unchanged. A validated current-patch refresh may fully replace its normal patch directory; remove the superseded copy and rebuild afterward. The rebuild records the selected source directory and uses each patch exactly once, even if multiple captures remain.

The rolling-window archive overlaps the patches and never enters the combined view. Offline rebuilding verifies every saved capture, rejects corrupt or conflicting sources, and reuses unchanged results. The browser verifies SHA-256 checksums before loading data.

## Sources and aggregation

The collector saves enemy matchup and ally synergy snapshots from LoLalytics global ranked solo/duo. It validates patch, champion, role, queue, and cohort, and records provenance, response hashes, collection times, and the matching champion roster. The Emerald+ combined view uses its own patch snapshots and appears in the rank dropdown once its patch coverage matches All ranks.

Candidate win rates are weighted by champion-role game counts. Each pair's normalized matchup delta and observed win rate are weighted by that pair's own game count. The rebuild sums game counts and uses them to recalculate role pick shares. Missing pairs stay missing. The snapshot contains rounded aggregate stats.

All source-listed roles are retained. Combined recommendation eligibility requires at least 1,000 games and either an inclusive 0.5% role pick share or the champion's primary role. Lower-usage records can still support matchup lookup and role inference.

Use the dataset index and generated catalog for patch coverage, capture dates, and profile counts. The combined snapshot spans several balance patches and refreshes when a new version is published.
