# DraftEdge

A League of Legends draft assistant that ranks champions by synergy with your team and matchups against the enemy.

[Open DraftEdge](https://pant4321.github.io/draft-lab/) · [Download Windows companion](https://github.com/pant4321/draft-lab/releases)

## Use it

1. Choose your role and enter revealed picks and bans.
2. Select a recommendation to preview it. The breakdown shows contributions from revealed picks and common counters that can still be picked.
3. Use **⊘** in the lower-right corner of a revealed pick to leave it on the board while excluding it from the draft scores. Use **Your pool** to prioritize champions you play, or **Settings** to adjust role weights and automatic role guesses.
4. Open **Suggested bans for your pool** to see up to five threats to your role's saved champions. Expand a suggestion to see how each pool pick contributes to its score.
5. Expand **Patches** at the bottom of **Settings**, uncheck any patches to exclude, and select **Done**. Keep at least one patch selected. Fewer games make the stats more variable, and very small samples can produce apparent effects that are mostly noise.

Drag champions between roles to correct assignments. Dropping onto an occupied slot swaps the two picks. With **Auto guess roles** enabled, **Pinned** marks manual assignments. Use **Clear role pins** to let DraftEdge guess those roles again. Drafts, pools, and settings save in your browser.

For automatic imports, install DraftEdge Companion on Windows, then choose **Companion → Open Companion** on the site. Allow the app to open and grant local access if prompted. DraftEdge connects in the tab you started from. Leave the companion open with League while drafting. [Setup, troubleshooting, and build notes](companion/README.md)

## Scores and data

- **Draft edge:** sample-adjusted synergy and counter contributions for a candidate. Optional **Include base WR** adds overall win rate above 50%.
- **Team draft edge:** totals the allied composition, counting each unique ally pair once.
- **Blindability:** a 0–100 counterpick-safety percentile within a role. It orders the list before any picks are revealed.

These scores rank draft fit. Use the rank dropdown at the top right to switch between All ranks and Emerald+ snapshots of global ranked solo/duo for the same patches. Stats refresh when a new snapshot is published. Recommendation roles need at least 1,000 games and either 0.5% role pick share or primary-role status.

Champion names, IDs, and portraits come from Riot Games Data Dragon. Ranked matchup and synergy stats come from LoLalytics. For a new patch, rebuild the snapshots and update the portraits for the version recorded in the generated catalog. [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) · [Snapshot update steps](docs/data.md#collect-and-rebuild) · [Portrait update steps](docs/data.md#update-champion-portraits)

[Scoring reference](docs/scoring.md) · [Data collection and updates](docs/data.md) · [Current dataset](https://pant4321.github.io/draft-lab/data/datasets.json) · [Privacy](https://pant4321.github.io/draft-lab/privacy.html)

## Run locally

Requires Node 24 or later, Python 3.10 or later, and access to the private dataset submodule.

```sh
git submodule update --init -- dist/data
npm ci
npm run dev
```

Open [localhost:8765](http://127.0.0.1:8765/). Vite serves the React frontend in `web/` with the same staged public data used in production. Restart the dev server after updating the dataset checkout.

Draft actions and scoring live in `web/src/domain/`. The dataset, browser storage, analytics, and companion adapters live in `web/src/services/`. React components render the draft and dispatch actions through the app state.

## Check and publish

```sh
npm run typecheck
npm test
python -m unittest discover -s companion/tests
python -m unittest discover -s tests/python
npx playwright install chromium
npm run build
npm run test:e2e
```

Pushes to `main` check out the pinned datasets, run these checks, and deploy `build/pages` to GitHub Pages. The browser suite serves that build at both the custom-domain root and the GitHub Pages project path. See [AGENTS.md](AGENTS.md) for repository rules.

When updating the website icon, refresh the `v` query for `favicon.ico` in both HTML files and for `assets/draft-lab-mark.png` in the React header. Use the first 12 SHA-256 characters of each binary file. Vite versions the JS and CSS bundles automatically.

## License

DraftEdge's original source code is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Third-party assets and dependencies retain their own terms. The website footer links to the license and the source for the deployed revision.
