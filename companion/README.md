# DraftEdge Companion

## Install and connect

1. Download and run `DraftEdgeCompanionSetup.exe` from the [GitHub releases](https://github.com/pant4321/draft-lab/releases). Setup installs for your Windows account and adds **DraftEdge Companion** to Start search. The beta installer is unsigned, so Windows may show a warning.
2. On DraftEdge, choose **Companion → Open Companion**. Allow the app to open and grant local access if prompted. The app starts or reuses the running companion and connects the tab you clicked from, including a local preview at `127.0.0.1`.
3. Keep the companion running with League while drafting. The launcher shows the League connection and has an **Open DraftEdge** button for the live site. Opening the companion itself leaves your browser alone.

To uninstall, go to **Settings → Apps → Installed apps → DraftEdge Companion**. Uninstall removes the installed copy's startup entry. Your League folder and window preference are saved separately and survive upgrades or reinstalls.

The release also includes `DraftLab-portable.zip`. Extract the ZIP and run `DraftLab.exe` from the extracted folder. Choose **Open DraftEdge** inside the launcher to connect. The installer registers the website's **Open Companion** link. Both editions bundle the Windows x64 League bridge, Python, Qt, and Riot's local client CA certificate. The live site loads from GitHub Pages and requires internet access. Refresh the page to receive published website changes.

The launcher detects the League install directory from common locations or its running executable path. If detection fails, use **League folder…** and select the directory containing `LeagueClientUx.exe` and `lockfile`. The selected directory and close behavior are saved to `%LOCALAPPDATA%/DraftLab/settings.json`. Authentication credentials are read from League's lockfile into memory and never written to settings or logs. The companion does not read other processes' memory.

## Windows behavior

**Start with Windows** is off by default. **Close to system tray** is on by default. Upgrades keep any saved choice.

- **Start with Windows** starts the companion in the system tray when you sign in to your Windows account. Click the DraftEdge tray icon or open the companion from Start to show the window. Upgrades migrate an existing DraftEdge startup registration. If you move a portable copy, turn this setting on from its new location.
- **Close to system tray** hides the window and keeps League sync running when you close it. Click the DraftEdge icon by the Windows clock to reopen the window. The icon may be in the hidden icons menu. Right-click it for **Open DraftEdge Companion** and **Quit**. With the switch off, closing the window exits. The standard minimize button still minimizes to the taskbar.

The bridge tries loopback ports 8766, 8767, and 8768. The website button uses a short-lived, one-time request for its own origin and listening port. Chrome and Edge may prompt before allowing local access. If all three ports are occupied, use **Open DraftEdge** in the launcher to connect through its fallback port. That explicit launcher action supplies its session in a URL fragment. DraftEdge removes the fragment before Analytics starts. Both flows keep the session in the connected tab's session storage so refresh can resume. With companion 0.1.10 or later, the browser saves a separate reconnect key after connecting. Reopening the site in the same browser reconnects quietly while the same companion is running and local access is available. If the companion has restarted, use **Open Companion** again.

When a new launcher session needs browser permission, choose **Connect to League** in the setup dialog, then **Allow** in the browser prompt. Refreshing a connected tab resumes quietly on a local preview or when the browser reports an existing permission grant. If another tab has already paired with a restarted companion, DraftEdge can use that pairing to recover an expired session. If access needs attention after a refresh, open the connection menu for status and reconnect options. An **Open Companion** request during shutdown waits for the old bridge to close. Failed connections keep manual drafting available.

- **Waiting** means the companion is running and looking for League. Start League and enter a supported champion select to begin syncing. **Ready** means League is open and the companion is waiting for champion select.
- **Offline** or **Expired** offers **Reconnect → Open Companion** from the League menu. If the app is still running and the session is offline, you can also retry the existing connection.
- After **Quit companion**, choose **Reopen Companion** in the same menu to start the app and reconnect the tab. **Blocked** offers local permission instructions, and **Update** offers the installer.

## Startup update check

The companion makes one background request at startup to GitHub's latest stable release endpoint for `pant4321/draft-lab`. It compares numeric `companion-vMAJOR.MINOR.PATCH` versions and checks that the published download belongs to that release. It prefers `DraftEdgeCompanionSetup.exe`, with the portable ZIP and legacy `DraftLab.exe` as manual fallbacks. The request sends the app version and ordinary HTTP request metadata. [GitHub release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)

Starting with 0.1.12, an installed copy shows **Update** when a newer installer has a published SHA-256 digest. One click downloads and verifies the installer before closing the companion. Windows runs setup in the background and reopens the app in the same installation folder. A failed download leaves the companion running and offers **Retry update**. Portable copies and releases without a verifiable installer offer **Download update** for a manual upgrade. To upgrade manually, quit the companion and run the newer installer.

Equal or older releases show **Up to date**. Network errors, invalid metadata, or rate limits show **Update check unavailable** with **Retry**. The metadata request has a five-second timeout and a 512 KiB response cap.

The one-click updater accepts installers up to 256 MiB and offers **Download update** for larger ones. Release the higher cap in an installer at or below 64 MiB first so existing copies can receive it through one-click update. The updater checks the latest stable release, so users who skip that update and still have the old cap will need to install the first larger release manually.

`--no-update-check` disables the request for offline smoke tests. Source UI testing can use `python -m companion.tests.update_preview --ready-file build/update-preview.json` to preview an older installed version with a simulated League connection.

**Your pool** saves champions separately for each role, then shows them ahead of other recommendations with the existing blindability or draft-edge ordering preserved within each section. Pools are saved in browser-local storage and survive draft resets. They do not change scores or override bans, taken picks, or data requirements.

## Saved datasets

The website loads the combined view listed in the [live dataset index](https://pant4321.github.io/draft-lab/data/datasets.json), verifying file checksums before use. Data updates are independent of executable releases. See [dataset maintenance](../docs/data.md) for collection and archive rules.

## Sync behavior

With no revealed picks, the website shows champions sorted by blindability for your role. As soon as a pick arrives it switches to draft edge.

Version 0.1.3 changes blindability to counterpick safety only: negative enemy deltas multiplied by opponent role pick-rate share, with sample adjustment. Rare picks count less. Base WR, positive bonuses, and ally synergy do not affect this score. Spread graphs remain available as a separate visual.

- Import locked picks and completed bans during champion select. Unlocked hovers are excluded.
- Custom-game bots are imported from their selected roster champions because League omits their pick actions. Human hovers remain excluded. If your assigned role is blank and teammates occupy four known roles, use the remaining role.
- Use the local player's assigned role when available. Enemy roles are inferred from the website's saved role counts, not hidden opponent information.
- Use teammate assigned positions as hints. Manual moves and swaps override those hints.
- Recompute recommendations when picks, bans, or roles change. Defer updates while a card is being dragged or its move dialog is open.
- Draft settings can apply separate synergy/counter multipliers to each assigned role. Live imports preserve these preferences and use them when reranking. Editing multipliers does not pause live sync or affect blindability.
- Preserve corrections by champion ID within a draft. Clear them for a new champion-select session.
- Pause `Live sync` for manual drafting. Resume to import the latest client state. Manually adding/removing picks or bans while synced also pauses importing.
- Display your own locked champion in your reserved slot. It is excluded from ally pair inputs.

Client state is read through `GET /lol-gameflow/v1/gameflow-phase` and `GET /lol-champ-select/v1/session`. No client write endpoints are used. The API response exposed to the browser contains draft champion IDs and role hints, with names, PUUIDs, account IDs, and local client credentials removed. The bridge validates the Host, Origin, and credential for each request. `POST /api/pair` accepts an origin-bound offer created by the native link. `GET /api/state` and `POST /api/quit` require a session token. CORS permits the two production origins and previews on `http://127.0.0.1`. Paired tokens are scoped to the exact origin. Bridge protocol 1 is separate from the executable version. Riot TLS validation uses the bundled certificate. [Riot's developer docs](https://developer.riotgames.com/docs/lol#league-client-api)

An authenticated tab can request a reconnect key with `GET /api/state?remember=1`. `POST /api/reconnect` exchanges that key for a tab session on the same origin. The bridge holds reconnect keys in memory until it quits.

The build overlay opens in the draft tab after League confirms your pick. The authenticated `GET /api/build` route looks up public LoLalytics Ranked Solo/Duo statistics for the selected champion, role, and rank filter. It checks the current patch, 14 days, and 30 days in order for each choice. For draft recommendations, it uses the general sample and up to five revealed champion and role pairs within the selected window. Unavailable matchups leave the general data and other matchup samples usable. The matchup picker can also request a single opponent. Riot Data Dragon supplies the patch version, current options, and artwork. CommunityDragon supplies item purchase limits extracted from League's game data.

The live site's Google Analytics stream measures page visits. Draft state, searches, pools, League identities, and companion credentials are not sent as analytics events. Tag configuration and sanitization are in [analytics.ts](../web/src/services/analytics.ts). See the [privacy notice](https://pant4321.github.io/draft-lab/privacy.html).

This first release targets standard role-based Summoner's Rift drafts. Other champion-select modes and unusual client schema changes need separate validation. The local League Client API is not officially supported for third-party apps, and Riot asks developers to register products and their API usage. See [Riot's current guidance](https://developer.riotgames.com/docs/lol#league-client-api).

Version 0.1.1 was checked in a live custom champion-select session: four allied bot picks imported and Mid recommendations appeared automatically. Enemy bot champions that the client has not revealed remain empty.

## Build and verify

On Windows with Python 3.10+, Node 24+, Inno Setup 7, and access to the private dataset submodule:

```
git submodule update --init -- dist/data
npm ci
python -m venv .venv-companion
.venv-companion\Scripts\python -m pip install -r companion/requirements-build.txt
.venv-companion\Scripts\python companion/build.py
python companion/smoke.py build/companion-release/DraftLab/DraftLab.exe --gui
python -m companion.installer --iscc "C:\path\to\ISCC.exe"
python -m companion.smoke_installer --iscc "C:\path\to\ISCC.exe"
```

`build.py` runs JavaScript and Python tests and freezes the PySide6 Essentials launcher and bridge into `build/companion-release/DraftLab/`. The launcher, executable, installer, and system tray use the website favicon. `--gui` checks that the frozen executable opens its window on Windows. Run it with the companion closed. The smoke test also checks the live-site launch URL, CORS preflight, authenticated bridge, reconnect, and shutdown. Python integration tests use OpenSSL to generate a disposable certificate for exercising local HTTPS. For source development, install `companion/requirements.txt` with pip and run `python -m companion.app`.

The installer smoke test requires a Windows account without the companion installed or registered to start at sign-in. It verifies the Start shortcut, launch forwarding through the registered `draftedge://open` link, in-place upgrade, and startup entry cleanup on uninstall using a temporary installation and fixture settings.

The GitHub Windows workflow runs these checks for `companion-v*` tags or manual runs. It uploads the portable ZIP, installer, and their SHA-256 files. To release, use a tag that matches the version in `companion/app.py` and attach all four files to the GitHub release. Both packages include the license texts and [Qt notices and corresponding source links](THIRD-PARTY-NOTICES.md). Publish the first installer on the latest stable release before deploying the website's direct installer link. For a prerelease, share its release page so testers can find the installer.

`--headless`, `--port`, `--ready-file`, and `--ca-file` are test and development options. Ready files contain a local bridge token and belong in ignored temporary or build directories.

Draft Lab is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
