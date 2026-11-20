from argparse import Namespace
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import urlencode
from uuid import uuid4

from companion.app import main, run
from companion.windows_launch import ACTIVATION_URI, WindowsActivation, parse_activation_args


class ActivationTests(unittest.TestCase):
    def test_protocol_launch_uses_the_default_entry_point(self):
        for uri in (ACTIVATION_URI, ACTIVATION_URI + "/", ACTIVATION_URI.upper()):
            with self.subTest(uri=uri):
                self.assertEqual(parse_activation_args(["--activate", uri]), ([], None))
        self.assertEqual(parse_activation_args(["--headless", "--port", "0"]),
                         (["--headless", "--port", "0"], None))

    def test_pairing_links_are_limited_to_the_site_and_loopback(self):
        tickets = ("a" * 64, "b" * 64, "c" * 64)
        base = "draftedge://connect/" + "/".join(tickets)
        for origin in ("https://draftedge.website", "http://127.0.0.1:8792"):
            uri = base + "?" + urlencode({"origin": origin})
            self.assertEqual(parse_activation_args(["--activate", uri]), ([], (origin, tickets)))
        for origin in ("https://evil.example", "http://127.0.0.1:65536"):
            uri = base + "?" + urlencode({"origin": origin})
            with self.assertRaises(ValueError):
                parse_activation_args(["--activate", uri])

    def test_protocol_launch_cannot_supply_a_destination_or_runtime_options(self):
        invalid = [
            ["--activate"],
            ["--activate", "draftedge://open?url=https://example.com/"],
            ["--activate", "draftedge://open#other"],
            ["--activate", "draftedge://example.com/"],
            ["--activate", ACTIVATION_URI, "--ready-file", "token.json"],
            ["--league-folder", "example", "--activate", ACTIVATION_URI],
        ]
        with patch("companion.app.run") as run:
            for args in invalid:
                with self.subTest(args=args):
                    self.assertEqual(main(args), 2)
            run.assert_not_called()

    def test_companion_startup_opens_only_the_launcher(self):
        args = Namespace(port=0, league_folder=None, ca_file=None, no_update_check=True,
                         ready_file=None, headless=False, no_browser=False)
        launcher = Mock()
        with (patch("companion.app.Poller"),
              patch.dict(sys.modules, {"companion.launcher": SimpleNamespace(launcher=launcher)}),
              patch("webbrowser.open_new_tab") as browser):
            self.assertEqual(run(args), 0)
            launcher.assert_called_once()
            browser.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows activation uses named kernel objects')
    def test_website_activation_waits_for_shutdown_then_starts_a_replacement(self):
        name = r'Local\DraftEdgeActivationTest-' + uuid4().hex
        tickets = '/'.join(char * 64 for char in 'abc')
        uri = 'draftedge://connect/' + tickets + '?' + urlencode({'origin': 'http://127.0.0.1:8792'})
        with tempfile.TemporaryDirectory() as directory, WindowsActivation(name) as previous:
            with (patch('companion.app.WindowsActivation', lambda: WindowsActivation(name)),
                  patch('companion.app.settings_path', return_value=Path(directory) / 'settings.json'),
                  patch('companion.app.run', return_value=0) as start,
                  patch('companion.app.time.sleep', side_effect=lambda _: previous.close()) as retry):
                self.assertEqual(main(['--activate', uri]), 0)
                start.assert_not_called()
                retry.assert_not_called()

                previous.mark_stopping()
                self.assertEqual(main(['--activate', uri]), 0)
                retry.assert_called_once()
                start.assert_called_once()
                self.assertTrue(start.call_args.args[1].primary)
