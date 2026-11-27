"""Apply an explicitly requested build to a DraftEdge temporary rune page."""
from dataclasses import dataclass
import time


TEMPORARY_PAGE_NAME = "DraftEdge Temporary"


class RuneImportError(Exception):
    """A failure the browser can display without leaking League response data."""


class DraftChanged(RuneImportError):
    pass


@dataclass(frozen=True)
class RuneSelection:
    session_id: str
    primary: tuple[int, ...]
    secondary: tuple[int, ...]
    shards: tuple[int, ...]

    @classmethod
    def parse(cls, data):
        if (not isinstance(data, dict)
                or data.keys() != {"sessionId", "primary", "secondary", "shards"}):
            raise ValueError("Invalid rune import request.")
        session_id = data["sessionId"]
        if not isinstance(session_id, str) or not 0 < len(session_id) <= 128:
            raise ValueError("Invalid draft selection.")

        picks = []
        for name, count in (("primary", 4), ("secondary", 2), ("shards", 3)):
            ids = data[name]
            if (not isinstance(ids, list) or len(ids) != count
                    or any(type(rune) is not int or not 1000 <= rune <= 999999 for rune in ids)):
                raise ValueError("Invalid rune IDs.")
            picks.append(tuple(ids))
        return cls(session_id, *picks)


def rune_payload(selection, styles):
    for primary in styles:
        slots = primary["slots"]
        if len(slots) != 7:
            continue
        if not all(rune in slot["perks"] for rune, slot in zip(
                (*selection.primary, *selection.shards), slots, strict=True)):
            continue
        for secondary in styles:
            if secondary["id"] not in primary["allowedSubStyles"]:
                continue
            selected = set(selection.secondary)
            rows = [selected.intersection(slot["perks"]) for slot in secondary["slots"][1:4]]
            matches = [next(iter(row)) for row in rows if len(row) == 1]
            if len(matches) == 2 and set(matches) == selected:
                return {"primaryStyleId": primary["id"], "subStyleId": secondary["id"],
                        "selectedPerkIds": [*selection.primary, *matches, *selection.shards]}
    raise RuneImportError("These runes are unavailable in the current League client.")


def owned_temporary_page(page):
    return (isinstance(page, dict) and page.get("name") == TEMPORARY_PAGE_NAME
            and page.get("isTemporary") is True and page.get("isEditable") is True
            and type(page.get("id")) is int and page["id"] != 0)


def matches_runes(page, payload):
    return all(page.get(key) == value for key, value in payload.items())


def selected_temporary_page(active, page_id, payload):
    return (owned_temporary_page(active) and active["id"] == page_id
            and active.get("current") is True and matches_runes(active, payload))


def is_recommended_page(page, champion):
    return (champion is not None and isinstance(page, dict) and page.get("isTemporary") is True
            and page.get("recommendationChampionId") == champion and bool(page.get("runeRecommendationId")))


def select_temporary_runes(client, payload, verify_draft):
    pages = client.get("/lol-perks/v1/pages")
    if not isinstance(pages, list):
        raise RuneImportError("League's rune page list is unavailable.")
    existing = next((page for page in pages if owned_temporary_page(page)), None)
    saved_ids = {page["id"] for page in pages
                 if isinstance(page, dict) and type(page.get("id")) is int and not owned_temporary_page(page)}
    verify_draft()
    page = client.save_temporary_runes(payload, existing["id"] if existing else None)
    if (not owned_temporary_page(page) or page["id"] in saved_ids
            or (existing is not None and page["id"] != existing["id"])
            or page.get("isValid") is not True
            or not matches_runes(page, payload)):
        raise RuneImportError("League did not confirm a valid temporary rune page.")

    page_id = page["id"]
    # Match the rune dropdown's explicit selection even when the save made the page current.
    verify_draft()
    client.select_rune_page(page_id)
    return page_id


def active_rune_page(client):
    time.sleep(0.75)
    return client.get("/lol-perks/v1/currentpage")
