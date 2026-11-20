import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from companion.preferences import read_settings, update_settings
from companion.startup import RUN_NAME, set_start_with_windows, starts_with_windows


class PreferencesTests(unittest.TestCase):
    def test_updates_preserve_existing_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "settings.json"
            path.write_text('{"leagueFolder":"old","other":1}', encoding="utf-8")
            with patch("companion.preferences.settings_path", return_value=path):
                self.assertNotIn("minimizeOnClose", read_settings())
                update_settings(minimizeOnClose=True)
                update_settings(leagueFolder="new")
                self.assertEqual(read_settings(), {"leagueFolder": "new", "minimizeOnClose": True, "other": 1})

    @unittest.skipUnless(os.name == "nt", "Windows startup uses the per-user registry")
    def test_startup_registration_can_be_enabled_and_removed_only_by_its_owner(self):
        import winreg

        test_key = r"Software\DraftEdgeStartupTest-" + uuid4().hex
        command = r'"C:\Example Path\DraftLab.exe"'
        other_copy = r'"C:\Other Path\DraftLab.exe"'
        with patch("companion.startup.RUN_KEY", test_key):
            try:
                self.assertFalse(starts_with_windows(command))
                set_start_with_windows(command, True)
                self.assertTrue(starts_with_windows(command))
                set_start_with_windows(other_copy, False)
                self.assertTrue(starts_with_windows(command))
                set_start_with_windows(command, False)
                self.assertFalse(starts_with_windows(command))
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, test_key) as key:
                    with self.assertRaises(FileNotFoundError):
                        winreg.QueryValueEx(key, RUN_NAME)
            finally:
                try:
                    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, test_key)
                except FileNotFoundError:
                    pass
