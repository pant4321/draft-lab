"""Current-patch options and purchase limits from League game data."""

from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
import json
import re
from urllib.request import Request, urlopen


DRAGON = "https://ddragon.leagueoflegends.com"
GAME_DATA = "https://raw.communitydragon.org"
MAX_GAME_DATA_BYTES = 24 * 1024 * 1024


def read_json(url, limit=2 * 1024 * 1024):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=6) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise ValueError("League game data exceeded its size limit.")
    return json.loads(body)


@lru_cache(maxsize=4)
def current_version(_period):
    try:
        versions = read_json(f"{DRAGON}/api/versions.json")
        return next(version for version in versions if re.fullmatch(r"\d+\.\d+\.\d+", version))
    except (OSError, ValueError, TypeError, StopIteration):
        return None


@dataclass
class BuildCatalog:
    items: frozenset | None = None
    boots: frozenset = frozenset()
    keystones: frozenset | None = None
    runes: frozenset | None = None
    item_groups: dict = field(default_factory=dict)
    group_limits: dict = field(default_factory=dict)

    def items_available(self, keys):
        return self.items is None or all(key in self.items for key in keys)

    def can_add(self, key, owned):
        if key in owned or not self.items_available((key,)):
            return False
        counts = Counter(group for item in (*owned, key) for group in self.item_groups.get(item, ()))
        return all(count <= self.group_limits[group] for group, count in counts.items())


def purchase_limits(raw):
    limits = {key: row["mMaxGroupOwnable"] for key, row in raw.items() if isinstance(row, dict)
              and row.get("__type") == "ItemGroup" and type(row.get("mMaxGroupOwnable")) is int
              and row["mMaxGroupOwnable"] > 0}
    groups = {str(row["itemID"]): tuple(group for group in row.get("mItemGroups", []) if group in limits)
              for row in raw.values() if isinstance(row, dict) and row.get("__type") == "ItemData"
              and type(row.get("itemID")) is int}
    return groups, limits


@lru_cache(maxsize=4)
def load_catalog(version, _period):
    if not version:
        return BuildCatalog()
    catalog = BuildCatalog()
    root = f"{DRAGON}/cdn/{version}/data/en_US"
    try:
        items = read_json(f"{root}/item.json")["data"]
        catalog.items = frozenset(key for key, item in items.items() if item.get("maps", {}).get("11"))
        catalog.boots = frozenset(key for key in catalog.items if "Boots" in items[key].get("tags", []))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    try:
        trees = read_json(f"{root}/runesReforged.json")
        catalog.keystones = frozenset(str(rune["id"]) for tree in trees for rune in tree["slots"][0]["runes"])
        catalog.runes = frozenset(rune["id"] for tree in trees for slot in tree["slots"] for rune in slot["runes"])
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        pass
    try:
        patch = version.rsplit(".", 1)[0]
        raw = read_json(f"{GAME_DATA}/{patch}/game/items.cdtb.bin.json", MAX_GAME_DATA_BYTES)
        catalog.item_groups, catalog.group_limits = purchase_limits(raw)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return catalog
