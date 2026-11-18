# DraftEdge

A League of Legends draft assistant that ranks champions by synergy with your team and matchups against the enemy.

[Open DraftEdge](https://pant4321.github.io/draft-lab/) · [Download Windows companion](https://github.com/pant4321/draft-lab/releases/latest/download/DraftLab.exe)

## Use it

1. Choose your role and enter revealed picks and bans.
2. Select a recommendation to preview it. The breakdown shows contributions from revealed picks and common counters that can still be picked.
3. Use **Your pool** to prioritize champions you play, or **Settings** to adjust role weights and automatic role guesses.
4. Open **Suggested bans for your pool** to see up to five threats to your role's saved champions. Expand a suggestion to see how each pool pick contributes to its score.

Drag champions between roles to correct assignments. Drafts, pools, and settings save in your browser.

For automatic imports, run the Windows companion and leave it open with League. It opens the website; choose **Connect to League** and allow local access when prompted. The companion reads champion select without making picks or bans. [Setup, troubleshooting, and build notes](companion/README.md).

## Scores and data

- **Draft edge:** sample-adjusted synergy and counter contributions for a candidate. Optional **Include base WR** adds overall win rate above 50%.
- **Team draft edge:** totals the allied composition, counting each unique ally pair once.
- **Blindability:** a 0–100 counterpick-safety percentile within a role. It orders the list before any picks are revealed.

These scores rank draft fit. Use the rank dropdown at the top right to switch between All ranks and Emerald+ snapshots of global ranked solo/duo for the same patches. Stats refresh when a new snapshot is published. Recommendation roles need at least 1,000 games and either 0.5% role pick share or primary-role status.

[Scoring reference](docs/scoring.md) · [Data collection and updates](docs/data.md) · [Current dataset](https://pant4321.github.io/draft-lab/data/datasets.json) · [Privacy](https://pant4321.github.io/draft-lab/privacy.html)

## Run locally

Requires Node, Python, and access to the private dataset submodule. The site runs directly from the checkout.

```sh
git submodule update --init -- dist/data
npm run dev
```

Open [localhost:8765](http://127.0.0.1:8765/). The static website lives in `dist/`.

## Check and publish

```sh
npm test
python -m unittest discover -s companion/tests
python -m unittest discover -s tests/python
```

Pushes to `main` check out the pinned datasets, run these checks, and deploy the site with the combined browser files. See [AGENTS.md](AGENTS.md) for asset-cache versioning and repository rules.
