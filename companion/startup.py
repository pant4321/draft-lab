"""Register the current Windows executable to launch at user sign-in."""
import os
import sys


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_NAME = "DraftEdge Companion"
START_IN_TRAY = "--start-in-tray"


def startup_command():
    if os.name == "nt" and getattr(sys, "frozen", False):
        return f'"{sys.executable}" {START_IN_TRAY}'
    return None


def starts_with_windows(command, *, migrate=False):
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, kind = winreg.QueryValueEx(key, RUN_NAME)
    except FileNotFoundError:
        return False
    if kind != winreg.REG_SZ:
        return False
    if value.casefold() == command.casefold():
        return True
    if value.casefold() != command.removesuffix(" " + START_IN_TRAY).casefold():
        return False
    if migrate:
        set_start_with_windows(command, True)
    return True


def set_start_with_windows(command, enabled):
    import winreg

    if enabled:
        # Windows limits Run commands to MAX_PATH, including quotes.
        if len(command.encode("utf-16-le")) // 2 > 260:
            raise OSError("The companion path is too long for Windows startup.")
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, access=winreg.KEY_SET_VALUE) as key:
            winreg.SetValueEx(key, RUN_NAME, 0, winreg.REG_SZ, command)
    else:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, access=winreg.KEY_QUERY_VALUE | winreg.KEY_SET_VALUE) as key:
                value, kind = winreg.QueryValueEx(key, RUN_NAME)
                if kind == winreg.REG_SZ and value.casefold() in (
                    command.casefold(), command.removesuffix(" " + START_IN_TRAY).casefold()
                ):
                    winreg.DeleteValue(key, RUN_NAME)
        except FileNotFoundError:
            pass
