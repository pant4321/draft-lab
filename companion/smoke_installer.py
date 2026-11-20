"""Verify per-user install, launch forwarding, upgrade, and uninstall on Windows."""
import argparse
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import tempfile
import time

from companion.app import VERSION
from companion.installer import RELEASE, build_installer
from companion.smoke import smoke
from companion.updates import INSTALLER_NAME, PORTABLE_NAME
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

    user_key = winreg.HKEY_CURRENT_USER
    shortcut = (Path(os.environ['APPDATA']) / 'Microsoft' / 'Windows' / 'Start Menu'
                / 'Programs' / 'DraftEdge Companion.lnk')
    if (has_key(user_key, UNINSTALL) or has_key(winreg.HKEY_CLASSES_ROOT, 'draftedge')
            or shortcut.exists()):
        raise RuntimeError('Use a Windows account without DraftEdge Companion installed for this smoke test.')
    with WindowsActivation() as activation:
        if not activation.primary:
            raise RuntimeError('Close the running DraftEdge Companion before testing the installer.')

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        destination = root / 'Installed Companion'
        portable = RELEASE / PORTABLE_NAME
        setup = RELEASE / INSTALLER_NAME
        older = build_installer(args.iscc, portable, root / 'previous', '0.0.0')

        test_home = root / 'LocalAppData'
        settings = test_home / 'DraftLab' / 'settings.json'
        settings.parent.mkdir(parents=True)
        preferences = b'{"leagueFolder":"fixture"}'
        settings.write_bytes(preferences)
        env = {**os.environ, 'LOCALAPPDATA': str(test_home)}

        def install(package):
            subprocess.run([str(package), *SILENT, f'/DIR={destination}'],
                           env=env, check=True, timeout=90)

        try:
            install(older)
            executable = destination / PORTABLE_NAME
            assert executable.is_file() and shortcut.is_file()
            assert value(UNINSTALL, 'DisplayVersion') == '0.0.0'
            assert value(PROTOCOL, 'URL Protocol') == ''

            # Confirm that an upgrade replaces the installed binary.
            executable.write_bytes(b'old install fixture')
            install(setup)
            assert sha256(executable.read_bytes()).digest() == sha256(portable.read_bytes()).digest()
            assert value(UNINSTALL, 'DisplayVersion') == VERSION
            assert shortcut.is_file() and settings.read_bytes() == preferences

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
            if has_key(user_key, UNINSTALL):
                uninstaller = Path(value(UNINSTALL, 'UninstallString').strip('"')).resolve()
                if uninstaller.parent != destination.resolve() or not uninstaller.is_file():
                    raise RuntimeError('Refusing to run an uninstaller outside the temporary test installation.')
                subprocess.run([str(uninstaller), *SILENT], env=env, check=True, timeout=90)

        assert not executable.exists() and not shortcut.exists()
        assert not has_key(user_key, UNINSTALL) and not has_key(user_key, PROTOCOL)
        assert settings.read_bytes() == preferences
        print('Installer smoke passed: Start shortcut, URI activation, in-place upgrade, and uninstall.')


if __name__ == '__main__':
    main()
