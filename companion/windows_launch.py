"""Handle Windows links and signal the existing companion window."""
import ctypes
from ctypes import wintypes
import time
from urllib.parse import parse_qs, urlsplit

from companion.pairing import PAIRING_PORTS, TICKET, allowed_origin

ACTIVATION_URI = "draftedge://open"
INSTANCE_NAME = r"Local\DraftLabCompanion"
ERROR_ALREADY_EXISTS = 183
EVENT_MODIFY_STATE = 0x0002
SYNCHRONIZE = 0x00100000
WAIT_TIMEOUT = 258


def parse_activation_args(args):
    """Separate ordinary CLI options from validated native link activation."""
    if "--activate" not in args:
        return args, None
    if len(args) != 2 or args[0] != "--activate":
        raise ValueError("Invalid DraftEdge activation.")
    if args[1].lower() in (ACTIVATION_URI, ACTIVATION_URI + "/"):
        return [], None
    if any(ord(char) < 32 for char in args[1]):
        raise ValueError("Invalid DraftEdge activation.")
    url = urlsplit(args[1])
    tickets = tuple(url.path[1:].split("/"))
    origin, = parse_qs(url.query, strict_parsing=True).get("origin", ())
    if (url.scheme != "draftedge" or url.netloc != "connect" or url.fragment
            or len(tickets) != len(PAIRING_PORTS) or not all(TICKET.fullmatch(ticket) for ticket in tickets)
            or url.query.count("&") or not allowed_origin(origin)):
        raise ValueError("Invalid DraftEdge activation.")
    return [], (origin, tickets)


class WindowsActivation:
    def __init__(self, name=INSTANCE_NAME):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.LPCWSTR]
        kernel.CreateMutexW.restype = wintypes.HANDLE
        kernel.CreateEventW.argtypes = [wintypes.LPVOID, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
        kernel.CreateEventW.restype = wintypes.HANDLE
        kernel.OpenEventW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
        kernel.OpenEventW.restype = wintypes.HANDLE
        kernel.SetEvent.argtypes = [wintypes.HANDLE]
        kernel.SetEvent.restype = wintypes.BOOL
        kernel.ResetEvent.argtypes = [wintypes.HANDLE]
        kernel.ResetEvent.restype = wintypes.BOOL
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL

        self.kernel = kernel
        self.event_name = name + ".ShowWindow"
        self.stopping_name = name + ".Stopping"
        self.event = None
        self.stopping = None
        ctypes.set_last_error(0)
        self.mutex = kernel.CreateMutexW(None, False, name)
        error = ctypes.get_last_error()
        if not self.mutex:
            raise ctypes.WinError(error)
        self.primary = error != ERROR_ALREADY_EXISTS
        if self.primary:
            self.stopping = kernel.CreateEventW(None, True, False, self.stopping_name)
            if self.stopping and kernel.ResetEvent(self.stopping):
                self.event = kernel.CreateEventW(None, False, False, self.event_name)
            if not self.event or not self.stopping:
                error = ctypes.get_last_error()
                self.close()
                raise ctypes.WinError(error)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()

    def notify(self):
        # The first process may still be creating its event.
        for _ in range(20):
            event = self.kernel.OpenEventW(EVENT_MODIFY_STATE, False, self.event_name)
            if event:
                try:
                    return bool(self.kernel.SetEvent(event))
                finally:
                    self.kernel.CloseHandle(event)
            time.sleep(.025)
        return False

    def can_forward(self):
        stopping = self.kernel.OpenEventW(SYNCHRONIZE, False, self.stopping_name)
        if stopping:
            try:
                if self.kernel.WaitForSingleObject(stopping, 0) != WAIT_TIMEOUT:
                    return False
            finally:
                self.kernel.CloseHandle(stopping)
        ready = self.kernel.OpenEventW(SYNCHRONIZE, False, self.event_name)
        if not ready:
            return False
        self.kernel.CloseHandle(ready)
        return True

    def mark_stopping(self):
        if self.stopping:
            self.kernel.SetEvent(self.stopping)

    def requested(self):
        result = self.kernel.WaitForSingleObject(self.event, 0)
        if result == WAIT_TIMEOUT:
            return False
        if result != 0:
            raise ctypes.WinError(ctypes.get_last_error())
        return True

    def close(self):
        if self.event:
            self.kernel.CloseHandle(self.event)
            self.event = None
        if self.mutex:
            self.kernel.CloseHandle(self.mutex)
            self.mutex = None
        if self.stopping:
            self.kernel.CloseHandle(self.stopping)
            self.stopping = None
