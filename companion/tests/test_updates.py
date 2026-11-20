import copy
import io
import json
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from companion.app import State
from companion.updates import (INSTALLER_NAME, LATEST_API_URL, MAX_RESPONSE_BYTES, REPOSITORY_URL,
                               UpdateChecker, check_latest, release_update, version_tuple)


def release(version="0.1.4"):
    tag = "companion-v" + version
    return {"tag_name": tag, "draft": False, "prerelease": False, "assets": [{
        "name": "DraftLab.exe", "state": "uploaded", "size": 18000000,
        "browser_download_url": f"{REPOSITORY_URL}/releases/download/{tag}/DraftLab.exe"}]}


class UpdateTests(unittest.TestCase):
    def test_numeric_versions_and_only_newer_stable_releases(self):
        self.assertGreater(version_tuple("0.1.10"), version_tuple("0.1.9"))
        self.assertEqual(release_update(release("0.1.10"), "0.1.9")["status"], "available")
        for latest in ("0.1.3", "0.1.2"):
            self.assertEqual(release_update(release(latest), "0.1.3")["status"], "current")
        for field in ("draft", "prerelease"):
            value = release();value[field] = True
            with self.assertRaises(ValueError):
                release_update(value, "0.1.3")
        for tag in ("site-v0.1.4", "companion-v0.1.4-beta", "companion-v1.2", None):
            value = release();value["tag_name"] = tag
            with self.assertRaises(ValueError):
                release_update(value, "0.1.3")

    def test_download_must_be_an_uploaded_executable_from_this_repo_and_tag(self):
        value = release()
        result = release_update(value, "0.1.3")
        self.assertEqual(result["downloadUrl"], value["assets"][0]["browser_download_url"])
        for key, wrong in (("browser_download_url", "https://example.com/DraftLab.exe"),
                           ("browser_download_url", f"{REPOSITORY_URL}/releases/download/companion-v0.1.2/DraftLab.exe"),
                           ("name", "other.exe"), ("state", "new"), ("size", 0), ("size", True)):
            broken = copy.deepcopy(value);broken["assets"][0][key] = wrong
            with self.assertRaises(ValueError):
                release_update(broken, "0.1.3")
        value["assets"] = []
        with self.assertRaises(ValueError):
            release_update(value, "0.1.3")

    def test_update_prefers_the_installer_and_ignores_an_invalid_installer(self):
        value = release()
        installer_url = f"{REPOSITORY_URL}/releases/download/{value['tag_name']}/{INSTALLER_NAME}"
        value["assets"].append({
            "name": INSTALLER_NAME, "state": "uploaded", "size": 18000000,
            "browser_download_url": installer_url,
        })
        self.assertEqual(release_update(value, "0.1.3")["downloadUrl"], installer_url)
        value["assets"][-1]["browser_download_url"] = "https://example.com/setup.exe"
        self.assertEqual(release_update(value, "0.1.3")["downloadUrl"], value["assets"][0]["browser_download_url"])

    def test_public_metadata_request_is_bounded_and_contains_no_authentication(self):
        with patch("companion.updates.urlopen", return_value=io.BytesIO(json.dumps(release()).encode())) as fetch:
            self.assertEqual(check_latest("0.1.3")["status"], "available")
            request = fetch.call_args.args[0]
            self.assertEqual(request.full_url, LATEST_API_URL)
            self.assertEqual(request.get_method(), "GET")
            self.assertEqual(request.get_header("User-agent"), "DraftLab/0.1.3")
            self.assertIsNone(request.get_header("Authorization"))
            self.assertIsNone(request.data)
            self.assertEqual(fetch.call_args.kwargs["timeout"], 5)
        for body in (b"not JSON", b" " * (MAX_RESPONSE_BYTES + 1)):
            with patch("companion.updates.urlopen", return_value=io.BytesIO(body)):
                with self.assertRaises(ValueError):
                    check_latest("0.1.3")

    def test_check_runs_in_background_preserves_draft_and_deduplicates_retries(self):
        state, stop, entered, finish = State(), threading.Event(), threading.Event(), threading.Event()
        state.publish("champ_select", "Champion select connected", {"allies": [{"id": 9}]})
        original = state.read()

        def fetch(version):
            entered.set();finish.wait(timeout=3)
            return release_update(release(), version)

        checker = UpdateChecker(state, stop, "0.1.3", fetch)
        worker = checker.start()
        try:
            self.assertTrue(entered.wait(timeout=1))
            self.assertEqual(state.read()["update"]["status"], "checking")
            self.assertIsNone(checker.start())
            self.assertEqual(state.read()["snapshot"], original["snapshot"])
        finally:
            finish.set();worker.join(timeout=3)
        result = state.read()
        self.assertEqual(result["update"]["status"], "available")
        self.assertEqual(result["status"], original["status"])
        self.assertEqual(result["message"], original["message"])
        self.assertEqual(result["snapshot"], original["snapshot"])
        stop.set();self.assertIsNone(checker.start())

    def test_offline_rate_limited_and_bad_metadata_fail_without_interrupting_league(self):
        state = State();state.publish("connected", "Waiting for champion select", None)
        failures = (TimeoutError("PRIVATE"), HTTPError(LATEST_API_URL, 403, "PRIVATE", {}, None), ValueError("PRIVATE"))
        for error in failures:
            with self.subTest(error=type(error).__name__):
                def fetch(version):
                    raise error
                worker = UpdateChecker(state, threading.Event(), "0.1.3", fetch).start()
                worker.join(timeout=3)
                self.assertEqual(state.read()["update"], {"status": "unavailable"})
                self.assertEqual(state.read()["status"], "connected")
                self.assertNotIn("PRIVATE", json.dumps(state.read()))


if __name__ == "__main__":
    unittest.main()
