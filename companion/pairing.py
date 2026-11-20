"""Short-lived browser pairing offers created by Windows link activation."""
from hashlib import sha256
from pathlib import Path
import re
from time import time

LIVE_ORIGINS = ("https://pant4321.github.io", "https://draftedge.website")
PAIRING_PORTS = (8766, 8767, 8768)
PAIRING_LIFETIME = 60
TICKET = re.compile(r"[a-f0-9]{64}")
LOCAL_ORIGIN = re.compile(r"http://127\.0\.0\.1:([1-9][0-9]{0,4})")


def allowed_origin(origin):
    if origin in (*LIVE_ORIGINS, "http://127.0.0.1"):
        return True
    match = LOCAL_ORIGIN.fullmatch(origin or "")
    return match is not None and int(match[1]) <= 65535


class PendingPairings:
    def __init__(self, directory):
        self.directory = Path(directory)

    def _path(self, origin, port, ticket):
        # Each listening port gets a different ticket. A process on another
        # port cannot use a ticket it saw to claim this companion's session.
        key = sha256(f"{origin}\n{port}\n{ticket}".encode("ascii")).hexdigest()
        return self.directory / key

    def offer(self, origin, tickets):
        self.directory.mkdir(parents=True, exist_ok=True)
        now = time()
        for path in self.directory.iterdir():
            if not TICKET.fullmatch(path.name):
                continue
            try:
                if now - path.stat().st_mtime >= PAIRING_LIFETIME:
                    path.unlink()
            except FileNotFoundError:
                pass

        for port, ticket in zip(PAIRING_PORTS, tickets, strict=True):
            path = self._path(origin, port, ticket)
            try:
                with path.open("xb"):
                    pass
            except FileExistsError:
                pass

    def claim(self, origin, port, ticket):
        if not allowed_origin(origin) or port not in PAIRING_PORTS or not TICKET.fullmatch(ticket):
            return False
        path = self._path(origin, port, ticket)
        try:
            age = time() - path.stat().st_mtime
            path.unlink()
        except FileNotFoundError:
            return False
        return 0 <= age < PAIRING_LIFETIME
