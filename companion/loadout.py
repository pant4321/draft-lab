"""Validate a champion-select loadout sent by the paired website."""
from dataclasses import dataclass

from companion.rune_import import RuneSelection


FLASH = 4


class SpellImportError(Exception):
    """A spell import failure safe to display in the website."""


def current_spells(player):
    return player.get("spell1Id"), player.get("spell2Id")


def flash_position(spells):
    left, right = spells
    if (left == FLASH) == (right == FLASH):
        return None
    return "left" if left == FLASH else "right"


def order_spells(spells, position):
    current = flash_position(spells)
    return spells[::-1] if position and current and current != position else spells


@dataclass(frozen=True)
class LoadoutSelection:
    session_id: str
    runes: RuneSelection | None
    spells: tuple[int, int] | None
    flash_position: str | None

    @classmethod
    def parse(cls, data):
        if not isinstance(data, dict) or data.keys() != {"sessionId", "runes", "spells", "flashPosition"}:
            raise ValueError("Invalid loadout request.")
        session = data["sessionId"]
        position = data["flashPosition"]
        if not isinstance(session, str) or not 0 < len(session) <= 128 or position not in (None, "left", "right"):
            raise ValueError("Invalid draft or Flash position.")
        runes, spells = data["runes"], data["spells"]
        if runes is not None:
            if not isinstance(runes, dict) or runes.keys() != {"primary", "secondary", "shards"}:
                raise ValueError("Invalid rune selection.")
            runes = RuneSelection.parse({"sessionId": session, **runes})
        if spells is not None:
            if (not isinstance(spells, list) or len(spells) != 2 or spells[0] == spells[1]
                    or any(type(spell) is not int or not 1 <= spell <= 99 for spell in spells)):
                raise ValueError("Invalid summoner spells.")
            spells = tuple(spells)
        if runes is None and spells is None:
            raise ValueError("Choose runes or spells to apply.")
        return cls(session, runes, spells, position)
