"""Read public, role-specific build statistics from LoLalytics."""

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import json
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from companion.build_catalog import BuildCatalog, current_version, load_catalog
from companion.build_recommendation import (
    EARLY, LANE, MIN_CHOICES, Cohort, Matchup, covered_matchups, direct_opponent, recommend,
)

ROLES = {"top", "jungle", "middle", "bottom", "support"}
TIERS = {"all", "emerald_plus"}
ITEM_ID = r"[1-9][0-9]{3,5}"
ITEM_SECTIONS = ("startSet", "item1", "item2")
NO_BOOTS = "no-boots"
NO_BOOTS_SOURCE_ID = "9999"
BUILD_WINDOW = "30"
API_HOST = "a3.lolalytics.com"
API = f"https://{API_HOST}/mega/"
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
ABILITY_KEYS = str.maketrans("1234", "QWER")
DRAFT_ITEM_SLOTS = {"item4": "item3", "item5": "item4", "item6": "item5"}
_build_pool = ThreadPoolExecutor(max_workers=6)


def build_query(params):
    fields = {"slug", "id", "role", "tier"}
    opponent_fields = {"opponent", "opponentId", "opponentRole"}
    if set(params) not in (fields, fields | opponent_fields, fields | {"draft"}) or any(len(v) != 1 for v in params.values()):
        raise ValueError("Invalid champion build request.")
    slug, champion_id, role, tier = (params[key][0] for key in ("slug", "id", "role", "tier"))
    if (not re.fullmatch(r"[a-z0-9]{1,32}", slug) or not re.fullmatch(r"[1-9][0-9]{0,5}", champion_id)
            or role not in ROLES or tier not in TIERS):
        raise ValueError("Invalid champion build request.")
    query = (slug, int(champion_id), role, tier)
    if "draft" in params:
        draft = params["draft"][0].split(",")
        if not 1 <= len(draft) <= len(ROLES):
            raise ValueError("Invalid draft.")
        opponents = tuple(parse_opponent(entry.split(":", 3)) for entry in draft)
        if len({entry[1] for entry in opponents}) != len(draft) or len({entry[2] for entry in opponents}) != len(draft):
            raise ValueError("Duplicate draft opponent or role.")
        return (*query, None, opponents)
    if "opponent" in params:
        return (*query, parse_opponent([params[key][0] for key in ("opponent", "opponentId", "opponentRole")]))
    return query


def parse_opponent(fields):
    if len(fields) != 3:
        raise ValueError("Invalid champion build opponent.")
    opponent, opponent_id, opponent_role = fields
    if (not re.fullmatch(r"[a-z0-9]{1,32}", opponent) or not re.fullmatch(r"[1-9][0-9]{0,5}", opponent_id)
            or opponent_role not in ROLES):
        raise ValueError("Invalid champion build opponent.")
    return opponent, int(opponent_id), opponent_role


def record(value):
    return value if isinstance(value, dict) else {}


def stats(wr, games):
    if (type(wr) in (int, float) and 0 <= wr <= 100
            and type(games) is int and 0 < games <= 100_000_000):
        return {"winRate": wr, "games": games}
    return None


def options(value, pattern, *, excluded=("1001", NO_BOOTS_SOURCE_ID)):
    if not isinstance(value, list):
        return []
    result = []
    for row in value:
        if not isinstance(row, list) or len(row) < 4 or type(row[0]) not in (str, int):
            continue
        key = str(row[0])
        detail = stats(row[1], row[3])
        if (re.fullmatch(pattern, key) and detail and key not in excluded
                and type(row[2]) in (int, float) and 0 <= row[2] <= 100):
            result.append({"key": key, **detail})
    return sorted(result, key=lambda option: option["games"], reverse=True)


def rune_ids(value, count):
    if not isinstance(value, list) or len(value) != count:
        return []
    ids = [str(rune) for rune in value]
    return [int(rune) for rune in ids] if all(re.fullmatch(r"[1-9][0-9]{3,5}", rune) for rune in ids) else []


def rune_stats(raw):
    positions = {"primary": {}, "secondary": {}}
    for rune_id, rows in record(raw).items():
        if not re.fullmatch(r"[1-9][0-9]{3,5}", rune_id) or not isinstance(rows, list):
            continue
        for position, row in zip(("primary", "secondary"), rows):
            if not isinstance(row, list) or len(row) < 3:
                continue
            pick_rate, win_rate, games = row[:3]
            detail = stats(win_rate, games)
            if detail and type(pick_rate) in (int, float) and 0 <= pick_rate <= 100:
                positions[position][rune_id] = {**detail, "pickRate": pick_rate}
    return positions


def summary_item(value):
    row = record(value)
    key = str(row.get("id", ""))
    detail = stats(row.get("wr"), row.get("n"))
    if detail and re.fullmatch(ITEM_ID, key) and key not in {"1001", "9999"}:
        return {"key": key, **detail}
    return None


def parse_build(raw, champion_id, role, opponent=None, window=BUILD_WINDOW, tier=None):
    raw = record(raw)
    if raw.get("status") == 404:
        return None
    header = record(raw.get("header"))
    if (str(header.get("cid")) != str(champion_id) or header.get("lane") != role
            or str(header.get("patch")) != window or str(header.get("queue", 420)) != "420"
            or (tier is not None and header.get("tierId", tier) != tier)
            or (opponent and (str(header.get("vs")) != str(opponent[1]) or header.get("vsLane") != opponent[2]))
            or (not opponent and header.get("vs") not in (None, 0, ""))):
        raise ValueError("Unexpected LoLalytics build response.")
    if header.get("n") == 0:
        return None
    overall = stats(header.get("wr"), header.get("n"))
    if overall is None:
        raise ValueError("Invalid LoLalytics build statistics.")

    pages = []
    for kind in ("pick", "win"):
        page = record(record(record(raw.get("summary")).get(kind)).get("runes"))
        detail = stats(page.get("wr"), page.get("n"))
        runes = record(page.get("set"))
        primary = rune_ids(runes.get("pri"), 4)
        secondary = rune_ids(runes.get("sec"), 2)
        shards = rune_ids(runes.get("mod"), 3)
        if primary and secondary and shards and detail:
            pages.append({"kind": kind, "primary": primary, "secondary": secondary, "shards": shards, **detail})

    choices = {key: options(raw.get(key), rf"{ITEM_ID}(?:_{ITEM_ID}){{0,7}}") for key in ITEM_SECTIONS}
    choices["boots"] = [
        {**row, "key": NO_BOOTS, "pickRate": row["games"] / overall["games"] * 100}
        if row["key"] == NO_BOOTS_SOURCE_ID else row
        for row in options(raw.get("boots"), ITEM_ID, excluded=())
        if row["games"] <= overall["games"]
    ]
    choices.update({slot: options(raw.get(source), ITEM_ID) for slot, source in DRAFT_ITEM_SLOTS.items()})
    items = {key: choices[key][:3] for key in (*ITEM_SECTIONS, "boots")}
    items["builtBootSet3"] = []
    # The provider's build summary counts boots in its purchase slots.
    summary = record(record(record(raw.get("summary")).get("pick")).get("items"))
    for slot in ("item4", "item5", "item6"):
        rows = summary.get(slot)
        items[slot] = [item for row in rows if (item := summary_item(row))][:3] if isinstance(rows, list) else []
    # Matchups can have individual purchase stats without a full by-slot table.
    core_steps = [step for slot in ("item1", "item2", "item3") if (step := summary_item(summary.get(slot)))]
    skills = options(raw.get("skillOrder"), r"[QWER]{3,4}")
    levels = options(raw.get("skill15"), r"[1234QWER-]{3,18}")
    summoners = options(raw.get("spells"), r"[1-9][0-9]?_[1-9][0-9]?")
    choices["summoners"] = summoners
    if levels:
        levels[0]["key"] = levels[0]["key"].translate(ABILITY_KEYS)
    comparison = rune_stats(record(raw.get("runes")).get("stats"))
    return {**overall, "runes": pages, "runeStats": comparison, "items": items, "coreSteps": core_steps, "_choices": choices,
            "window": window, "_opponentRole": opponent[2] if opponent else None,
            "opponentId": opponent[1] if opponent else None, "summoners": summoners[0] if summoners else None,
            "summonerAlternatives": summoners[1:3],
            "maxOrder": skills[0] if skills else None, "levelOrder": levels[0] if levels else None}


def pages_for(baseline, matchups, catalog):
    pages = {}
    for build in (baseline, *matchups):
        for page in build["runes"]:
            if catalog.runes is not None and not all(rune in catalog.runes for rune in (*page["primary"], *page["secondary"])):
                continue
            pages.setdefault(str(page["primary"][0]), page)
    return pages


def cohort(build, slot, catalog, rune_keys, owned):
    if slot == "keystone":
        primary = build["runeStats"]["primary"]
        rows = ({"key": key, **row} for key, row in primary.items() if key in rune_keys)
    elif slot == "summoners":
        rows = build["_choices"][slot]
    elif slot == "startSet":
        rows = (row for row in build["_choices"][slot] if catalog.items_available(row["key"].split("_")))
    elif slot == "boots":
        rows = (row for row in build["_choices"][slot] if row["key"] == NO_BOOTS or catalog.can_add(row["key"], owned))
    else:
        rows = (row for row in build["_choices"][slot]
                if row["key"] not in catalog.boots and catalog.can_add(row["key"], owned))
    return Cohort.from_rows(rows)


def decision_sample(source, slot, catalog, owned):
    _, baseline, opponents = source
    pages = pages_for(baseline, opponents, catalog) if slot == "keystone" else {}
    rune_keys = catalog.keystones if catalog.keystones is not None else pages.keys()
    general = cohort(baseline, slot, catalog, rune_keys, owned)
    matchups = [Matchup(build["opponentId"], build["_opponentRole"], cohort(build, slot, catalog, rune_keys, owned))
                for build in opponents]
    return general, matchups, pages


def sufficient_coverage(general, matchups, slot, role, enemies):
    if general.total < MIN_CHOICES:
        return False
    if not enemies:
        return True
    has_lane = any(direct_opponent(role, enemy[2]) for enemy in enemies)
    covered = covered_matchups(general, matchups)
    if has_lane and slot in EARLY | LANE:
        return any(direct_opponent(role, matchup.role) for matchup in covered)
    return bool(covered)


def choose_sample(sources, slot, role, enemies, catalog, owned):
    fallback = None
    for source in sources:
        window, _, _ = source
        general, matchups, pages = decision_sample(source, slot, catalog, owned)
        if general.rows:
            fallback = (window, general, matchups, pages)
        if sufficient_coverage(general, matchups, slot, role, enemies):
            return fallback, True
    if fallback:
        return fallback, False
    window, baseline, opponents = sources[0]
    pages = pages_for(baseline, opponents, catalog) if slot == "keystone" else {}
    return (window, Cohort.from_rows([]), [], pages), False


def draft_build(sources, role, enemies, catalog):
    _, baseline, _ = next((source for source in sources if source[1]["games"] >= MIN_CHOICES), sources[-1])
    items = baseline["items"].copy()
    changes, alternatives, windows = {}, {}, {}
    covered = set()
    needs_wider = set()
    owned = []

    def slot_recommendation(slot):
        selected, enough = choose_sample(sources, slot, role, enemies, catalog, owned)
        window, general, matchups, pages = selected
        if not enough:
            needs_wider.add(slot)
        if general.rows:
            windows[slot] = window
        covered.update(matchup.opponent_id for matchup in covered_matchups(general, matchups))
        result = recommend(general, matchups, slot, role, window,
                           choices_with_pages=pages.keys() if slot == "keystone" else None)
        if result.change:
            changes[slot] = result.change
        if result.alternatives:
            alternatives[slot] = result.alternatives
        return result.options, pages

    items["startSet"], _ = slot_recommendation("startSet")
    spells, _ = slot_recommendation("summoners")
    keystones, pages = slot_recommendation("keystone")
    runes = []
    if keystones and (page := pages.get(keystones[0]["key"])):
        runes = [{**page, **{field: keystones[0][field] for field in ("winRate", "games")}, "kind": "pick"}]
    elif pages:
        runes = [{**next(iter(pages.values())), "statsFor": "page"}]

    items["boots"], _ = slot_recommendation("boots")
    if items["boots"] and items["boots"][0]["key"] != NO_BOOTS:
        owned.append(items["boots"][0]["key"])
    for slot in ("item1", "item2"):
        items[slot], _ = slot_recommendation(slot)
        if items[slot]:
            owned.append(items[slot][0]["key"])

    if not items["item1"] and not items["item2"]:
        # A smaller matchup response can supply single-purchase summaries only.
        boot_keys = catalog.boots | {row["key"] for row in baseline["_choices"]["boots"]}
        fallback = iter(row for row in baseline["coreSteps"] if row["key"] not in boot_keys)
        for slot in ("item1", "item2"):
            row = next((row for row in fallback if catalog.can_add(row["key"], owned)), None)
            if row:
                items[slot] = [row]
                owned.append(row["key"])
                windows[slot] = baseline["window"]
    for slot in DRAFT_ITEM_SLOTS:
        items[slot], _ = slot_recommendation(slot)
        if items[slot]:
            owned.append(items[slot][0]["key"])

    rune_baseline = next((source[1] for source in sources if source[0] == windows.get("keystone")), baseline)
    return {**baseline, "items": items, "coreSteps": [], "runes": runes, "legendarySlots": True,
            "runeStats": rune_baseline["runeStats"], "windows": windows,
            "summoners": spells[0] if spells else None, "summonerAlternatives": spells[1:],
            "draft": {"opponentIds": [enemy[1] for enemy in enemies if enemy[1] in covered],
                      "changes": changes, "alternatives": alternatives},
            "_needsWider": needs_wider}


def public_build(build):
    return {key: value for key, value in build.items() if not key.startswith("_")} if build is not None else None


def collect_window(slug, champion_id, role, tier, period, opponent, draft, window):
    query = (slug, champion_id, role, tier, period)
    baseline_request = _build_pool.submit(fetch_build, *query, opponent, window)
    requests = [_build_pool.submit(fetch_build, *query, enemy, window) for enemy in draft]

    def result(request):
        try:
            return request.result()
        except (OSError, ValueError, RecursionError):
            return None

    baseline = result(baseline_request)
    opponents = [build for request in requests if (build := result(request)) is not None]
    return (window, baseline, opponents) if baseline is not None else None


def get_build(slug, champion_id, role, tier, opponent=None, draft=()):
    # Cache upstream stats per rank, opponent and window.
    period = int(time.monotonic() // 900)
    version = current_version(period)
    windows = (version.rsplit(".", 1)[0], "14", BUILD_WINDOW) if version else ("14", BUILD_WINDOW)
    catalog_request = _build_pool.submit(load_catalog, version, period)

    def collect(selected_opponent, enemies):
        sources = []
        build = None
        for window in windows:
            source = collect_window(slug, champion_id, role, tier, period, selected_opponent, enemies, window)
            if source is None:
                continue
            sources.append(source)
            build = draft_build(sources, role, enemies, catalog_request.result())
            if not build["_needsWider"]:
                break
        return build

    build = collect(opponent, draft)
    if build is None and opponent:
        build = collect(None, ())
    if build is not None and not draft:
        build.pop("draft")
    return public_build(build)



@lru_cache(maxsize=128)
def fetch_build(slug, champion_id, role, tier, _cache_period, opponent=None, window=BUILD_WINDOW):
    query = {"ep": "build-full", "p": "d", "v": "1", "patch": window,
             "tier": tier, "queue": "420", "region": "all", "c": slug, "lane": role}
    if opponent:
        query.update(vs=opponent[0], vslane=opponent[2])
    request = Request(API + "?" + urlencode(query), headers={"Accept": "application/json", "User-Agent": "DraftEdge"})
    try:
        with urlopen(request, timeout=8) as response:
            final_url = urlsplit(response.geturl())
            if (final_url.scheme, final_url.netloc, final_url.path) != ("https", API_HOST, "/mega/"):
                raise ValueError("Unexpected LoLalytics response URL.")
            body = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("LoLalytics build response was too large.")
    return parse_build(json.loads(body), champion_id, role, opponent, window, tier)
