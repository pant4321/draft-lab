# Draft Lab Companion

The Windows x64 executable bundles the local League bridge, Python runtime, and Riot's local client CA certificate. Download `DraftLab.exe` from the repository's releases and run it. Leave the launcher running while drafting. Version 0.1.6 opens the live website at https://pant4321.github.io/draft-lab/. Website code, champion portraits, scoring, and stats load from GitHub Pages. Refresh the page to receive published website changes without restarting the companion. Loading the site requires internet access; no offline fallback is bundled. No admin rights, account login, API key, or Python installation is needed.

The launcher detects the League install directory from common locations or its running executable path. If detection fails, use **League folder…** and select the directory containing `LeagueClientUx.exe` and `lockfile`. The selected directory is the only setting written to `%LOCALAPPDATA%/DraftLab/settings.json`. Authentication credentials are read from League's lockfile into memory and never written to settings or logs. The companion does not read other processes' memory.

The bridge listens on `http://127.0.0.1:8766/` by default. If that port is occupied, the launcher chooses an available loopback port. Always open the website through the launcher to include its temporary session token and port in the URL fragment. The site removes these from the address before Analytics starts and keeps them in this tab's session storage, so refresh keeps the connection. No draft or preference transfer from old localhost pages is performed. Existing live-site preferences stay in the same browser storage.

Choose **Connect to League** when prompted. The browser may ask to allow local/loopback access. An existing reported permission grant connects automatically; denied access shows site-settings instructions. Unsupported permission-query APIs fall back to an explicit connection click. Closing the launcher or choosing **Quit companion** stops the bridge. Failed connections keep manual drafting available.

## Startup update check

Version 0.1.4 and later make one background request at startup to [GitHub's latest stable release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) for `pant4321/draft-lab`. It compares numeric `companion-vMAJOR.MINOR.PATCH` versions, excludes drafts/prereleases, and requires a nonempty uploaded `DraftLab.exe` with the exact download URL under this repository and tag. Only the app version and ordinary HTTP request metadata are sent; League data, client credentials, and GitHub authentication are not sent.

A newer version shows **Download update** in the launcher. Choosing it opens the official executable download in the browser. There is no automatic download, execution, file replacement, or restart. Equal/older releases show **Up to date**. Network errors, invalid metadata, or rate limits show **Update check unavailable** with **Retry**. Each request has a five-second timeout and a 512 KiB response cap; it never blocks the League polling thread or launcher startup.

Published v0.1.3 and earlier executables do not include this check. Download v0.1.4 manually once to receive it, along with the graph/picker interaction fixes and champion pools. `--no-update-check` disables the request for offline smoke tests. Source UI testing can use `python -m companion.tests.update_preview --ready-file build/update-preview.json`; this previews an older installed version without opening or modifying the real League client.

**Your pool** saves champions separately for each role, then shows them ahead of other recommendations with the existing blindability or draft-edge ordering preserved within each section. Pools are saved in browser-local storage and survive draft resets. They do not change scores or override bans, taken picks, or data requirements.

## Data views

The live site defaults to combined patches 16.17–16.22, captured November 15, 2026. The **Data** selector also offers the original November 14 30-day history. Switching datasets keeps the current draft and role pools. The website loads and verifies both views against saved SHA-256 hashes. Discrete source patch archives stay in the repository for offline recombination and future append-only collection. Version 0.1.5 bundled these views; version 0.1.6 contains no website or dataset files.

## Sync behavior

With no revealed picks, the website shows champions sorted by blindability for your role. As soon as a pick arrives it switches to draft edge.

Version 0.1.3 changes blindability to counterpick safety only: negative enemy deltas multiplied by opponent role pick-rate share, with sample adjustment. Rare picks count less. Base WR, positive bonuses, and ally synergy do not affect this score. Spread graphs remain available as a separate visual.

- Import locked picks and completed bans during champion select. Unlocked hovers are excluded.
- Custom-game bots are imported from their selected roster champions because League omits their pick actions. Human hovers remain excluded. If your assigned role is blank and teammates occupy four known roles, use the remaining role.
- Use the local player's assigned role when available. Enemy roles are inferred from the website's saved role counts, not hidden opponent information.
- Use teammate assigned positions as hints. Manual moves and swaps override those hints.
- Recompute recommendations when picks, bans, or roles change. Defer updates while a card is being dragged or its move dialog is open.
- Preserve corrections by champion ID within a draft. Clear them for a new champion-select session.
- Pause `Live sync` for manual drafting. Resume to import the latest client state. Manually adding/removing picks or bans while synced also pauses importing.
- Display your own locked champion in your reserved slot. It is excluded from ally pair inputs.

Client state is read through `GET /lol-gameflow/v1/gameflow-phase` and `GET /lol-champ-select/v1/session`. No client write endpoints are used. The API response exposed to the browser contains draft champion IDs and role hints, with names, PUUIDs, account IDs, and local client credentials removed. The browser API checks its session token, Host, and Origin. Strict CORS allows only `https://pant4321.github.io` with `X-DraftLab-Session`, `GET /api/state`, and `POST /api/quit`. Other origins, preflight methods/headers, paths, and non-loopback bindings are rejected. The same loopback origin and no-Origin authenticated native smoke tests remain supported. GitHub project paths share their account's origin; the origin allowlist is not a path boundary. Bridge protocol 1 is separate from the executable version so compatible website changes need no native update. Riot TLS validation uses the bundled certificate from [Riot's developer docs](https://developer.riotgames.com/docs/lol#league-client-api); certificate chain validation stays enabled.

The live site's Google Analytics stream measures page visits. Draft state, searches, pools, League identities, and companion credentials are not sent as analytics events. See the root README for tag IDs and sanitization rules.

This first release targets standard role-based Summoner's Rift drafts. Other champion-select modes and unusual client schema changes need separate validation. The local League Client API is not officially supported for third-party apps, and Riot asks developers to register products and their API usage. See [Riot's current guidance](https://developer.riotgames.com/docs/lol#league-client-api).

Version 0.1.1 was checked in a live custom champion-select session: four allied bot picks imported and Mid recommendations appeared automatically. Enemy bot champions that the client has not revealed remain empty.

## Build and verify

On Windows with Python 3.10+ and Node 24+:

```
python -m venv .venv-companion
.venv-companion\Scripts\python -m pip install -r companion/requirements-build.txt
.venv-companion\Scripts\python companion/build.py
python companion/smoke.py build/companion-release/DraftLab.exe
```

`build.py` runs JavaScript and Python tests, generates the icon, and creates `build/companion-release/DraftLab.exe` using PyInstaller. The smoke test launches the actual frozen binary, checks the live-site launch URL, strict CORS preflight, authenticated bridge and shutdown. Python integration tests generate a disposable HTTPS client certificate using OpenSSL and exercise the real local HTTPS polling path; OpenSSL is a test tool only, not a runtime requirement. Source development can run `python -m companion.app`.

The GitHub Windows workflow repeats the build and executable smoke test for `companion-v*` tags or manual runs. The binary is not code-signed. `--headless`, `--no-browser`, `--port`, `--ready-file`, and `--ca-file` are test/development options. Ready files contain a local bridge token and belong in ignored temporary/build directories.

Draft Lab is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
