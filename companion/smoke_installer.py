"""Verify per-user install, launch forwarding, upgrade, and uninstall on Windows."""
import argparse
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import tempfile
import time

from companion.app import VERSION
from companion.installer import BUNDLE, RELEASE, build_installer
from companion.smoke import smoke
from companion.startup import RUN_KEY, RUN_NAME, START_IN_TRAY, set_start_with_windows
from companion.updates import EXECUTABLE_NAME, INSTALLER_NAME
from companion.windows_launch import ACTIVATION_URI, WindowsActivation

UNINSTALL = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\DraftEdgeCompanion_is1"
PROTOCOL = r"Software\Classes\draftedge"
SILENT = ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]


def main():
    import winreg

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iscc', type=Path, required=True)
    args = parser.parse_args()

    def has_key(hive, path):
        try:
            with winreg.OpenKey(hive, path):
                return True
        except FileNotFoundError:
            return False

    def value(path, name):
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path) as key:
            return winreg.QueryValueEx(key, name)[0]

    def has_startup_entry():
        try:
            value(RUN_KEY, RUN_NAME)
        except FileNotFoundError:
            return False
        return True

    user_key = winreg.HKEY_CURRENT_USER
    shortcut = (Path(os.environ['APPDATA']) / 'Microsoft' / 'Windows' / 'Start Menu'
                / 'Programs' / 'DraftEdge Companion.lnk')
    if (has_key(user_key, UNINSTALL) or has_key(winreg.HKEY_CLASSES_ROOT, 'draftedge')
            or shortcut.exists() or has_startup_entry()):
        raise RuntimeError('Use a Windows account without DraftEdge Companion installed or registered at startup.')
    with WindowsActivation() as activation:
        if not activation.primary:
            raise RuntimeError('Close the running DraftEdge Companion before testing the installer.')

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        destination = root / 'Installed Companion'
        packaged = BUNDLE / EXECUTABLE_NAME
        setup = RELEASE / INSTALLER_NAME
        older = build_installer(args.iscc, packaged, root / 'previous', '0.0.0')

        test_home = root / 'LocalAppData'
        settings = test_home / 'DraftLab' / 'settings.json'
        settings.parent.mkdir(parents=True)
        preferences = b'{"leagueFolder":"fixture"}'
        settings.write_bytes(preferences)
        env = {**os.environ, 'LOCALAPPDATA': str(test_home)}

        def install(package):
            subprocess.run([str(package), *SILENT, f'/DIR={destination}'],
                           env=env, check=True, timeout=90)

        executable = destination / EXECUTABLE_NAME
        legacy_startup = f'"{executable}"'
        startup = f'{legacy_startup} {START_IN_TRAY}'
        try:
            install(older)
            assert executable.is_file() and shortcut.is_file()
            assert value(UNINSTALL, 'DisplayVersion') == '0.0.0'
            assert value(PROTOCOL, 'URL Protocol') == ''
            assert not has_startup_entry()
            set_start_with_windows(legacy_startup, True)

            # Confirm that an upgrade replaces the installed binary.
            executable.write_bytes(b'old install fixture')
            install(setup)
            assert sha256(executable.read_bytes()).digest() == sha256(packaged.read_bytes()).digest()
            assert (destination / '_internal/PySide6/plugins/platforms/qwindows.dll').is_file()
            assert value(UNINSTALL, 'DisplayVersion') == VERSION
            assert shortcut.is_file() and settings.read_bytes() == preferences
            assert value(RUN_KEY, RUN_NAME) == startup

            # Hold the instance mutex in the test so a real shell launch forwards
            # the request without opening a browser or reading the League client.
            with WindowsActivation() as activation:
                assert activation.primary
                os.startfile(ACTIVATION_URI)
                deadline = time.monotonic() + 25
                while not activation.requested():
                    if time.monotonic() >= deadline:
                        raise RuntimeError('The installed protocol handler did not signal the running companion.')
                    time.sleep(.05)
            smoke(executable)
        finally:
            try:
                if has_key(user_key, UNINSTALL):
                    uninstaller = Path(value(UNINSTALL, 'UninstallString').strip('"')).resolve()
                    if uninstaller.parent != destination.resolve() or not uninstaller.is_file():
                        raise RuntimeError('Refusing to run an uninstaller outside the temporary test installation.')
                    subprocess.run([str(uninstaller), *SILENT], env=env, check=True, timeout=90)
                    assert not has_startup_entry()
            finally:
                set_start_with_windows(startup, False)

        assert not executable.exists() and not shortcut.exists()
        assert not (destination / '_internal').exists()
        assert not has_key(user_key, UNINSTALL) and not has_key(user_key, PROTOCOL)
        assert settings.read_bytes() == preferences
        print('Installer smoke passed: Start shortcut, URI activation, in-place upgrade, and startup cleanup.')


if __name__ == '__main__':
    main()
