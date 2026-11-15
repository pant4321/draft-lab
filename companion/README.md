# Draft Lab Companion

The Windows x64 executable bundles the website, champion portraits, frozen matchup stats, Python runtime, and Riot's local client CA certificate. Download `DraftLab.exe` from the repository's releases and run it. Leave the launcher running while drafting. It opens a local browser page and needs no admin rights, account login, API key, or Python installation.

The launcher detects the League install directory from common locations or its running executable path. If detection fails, use **League folder…** and select the directory containing `LeagueClientUx.exe` and `lockfile`. The selected directory is the only setting written to `%LOCALAPPDATA%/DraftLab/settings.json`. Authentication credentials are read from League's lockfile into memory and never written to settings or logs. The companion does not read other processes' memory.

The browser page uses `http://127.0.0.1:8766/` by default. If that port is occupied, the launcher chooses an available loopback port. Always open it through the launcher so its temporary connection token is included. Keep the launcher open; minimizing is fine. Closing it or choosing **Quit companion** stops the local server.

## Sync behavior

With no revealed picks, the bundled page shows champions sorted by blindability for your role. As soon as a pick arrives it switches to draft edge. This is available from version 0.1.2.

- Import locked picks and completed bans during champion select. Unlocked hovers are excluded.
- Custom-game bots are imported from their selected roster champions because League omits their pick actions. Human hovers remain excluded. If your assigned role is blank and teammates occupy four known roles, use the remaining role.
- Use the local player's assigned role when available. Enemy roles are inferred from the bundled role counts, not hidden opponent information.
- Use teammate assigned positions as hints. Manual moves and swaps override those hints.
- Recompute recommendations when picks, bans, or roles change. Defer updates while a card is being dragged or its move dialog is open.
- Preserve corrections by champion ID within a draft. Clear them for a new champion-select session.
- Pause `Live sync` for manual drafting. Resume to import the latest client state. Manually adding/removing picks or bans while synced also pauses importing.
- Display your own locked champion in your reserved slot. It is excluded from ally pair inputs.

Client state is read through `GET /lol-gameflow/v1/gameflow-phase` and `GET /lol-champ-select/v1/session`. No client write endpoints are used. The API response exposed to the browser contains draft champion IDs and role hints, with names, PUUIDs, account IDs, and local client credentials removed. The browser API checks its session token, Host, and Origin; it has no permissive CORS policy. Riot TLS validation uses the bundled certificate from [Riot's developer docs](https://developer.riotgames.com/docs/lol#league-client-api); certificate chain validation stays enabled.

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

`build.py` runs JavaScript and Python tests, generates the icon, and creates `build/companion-release/DraftLab.exe` using PyInstaller. The smoke test launches the actual frozen binary, checks the bundled site/data and authenticated bridge, then shuts it down. Python integration tests generate a disposable HTTPS client certificate using OpenSSL and exercise the real local HTTPS polling path; OpenSSL is a test tool only, not a runtime requirement. Source development can run `python -m companion.app`.

The GitHub Windows workflow repeats the build and executable smoke test for `companion-v*` tags or manual runs. The binary is not code-signed. `--headless`, `--no-browser`, `--port`, `--ready-file`, and `--ca-file` are test/development options. Ready files contain a local bridge token and belong in ignored temporary/build directories.

Draft Lab is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
