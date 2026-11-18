import json
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from companion.app import BridgeServer, State, VERSION, LIVE_SITE, LIVE_ORIGIN, LIVE_ORIGINS
from companion.lcu import Credentials, LeagueClient, Poller, normalize_session


def example_session():
    return {"localPlayerCellId": 0, "myTeam": [
        {"cellId": 0, "championId": 35, "assignedPosition": "jungle", "puuid": "PRIVATE"},
        {"cellId": 1, "championId": 516, "assignedPosition": "top", "gameName": "PRIVATE"},
        {"cellId": 2, "championId": 103, "assignedPosition": "middle"}],
        "theirTeam": [{"cellId": 5, "championId": 64, "assignedPosition": "middle", "summonerId": 123}],
        "actions": [[{"actorCellId": 0, "championId": 35, "type": "pick", "completed": True},
                     {"actorCellId": 1, "championId": 516, "type": "pick", "completed": True},
                     {"actorCellId": 2, "championId": 103, "type": "pick", "completed": False},
                     {"actorCellId": 5, "championId": 64, "type": "pick", "completed": True}]],
        "bans": {"myTeamBans": [111, -1, 0], "theirTeamBans": [111, 58]}}


class ClientTests(unittest.TestCase):
    def test_visible_locked_picks_only_and_no_identifiers(self):
        value = normalize_session(example_session())
        self.assertEqual(value["allies"], [{"id": 516, "role": "top"}])
        self.assertEqual(value["enemies"], [{"id": 64, "role": None}])
        self.assertEqual(value["bans"], [111, 58])
        self.assertEqual(value["playerRole"], "jungle")
        self.assertEqual(value["playerChampion"], 35)
        self.assertNotIn("PRIVATE", json.dumps(value))
        self.assertNotIn("summonerId", json.dumps(value))

    def test_trades_use_roster_ids_and_local_hover_is_not_a_lock(self):
        raw = example_session()
        raw["myTeam"][1]["championId"] = 222
        raw["actions"][0][0]["completed"] = False
        value = normalize_session(raw)
        self.assertEqual(value["allies"][0]["id"], 222)
        self.assertIsNone(value["playerChampion"])

    def test_credentials_are_validated_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lockfile"
            path.write_text("LeagueClient:123:4567:test-password:https")
            value = Credentials.read(path)
            self.assertEqual(value.port, 4567)
            self.assertNotIn("test-password", repr(value))
            path.write_text("LeagueClient:123:4567:test-password:http")
            with self.assertRaises(ValueError):
                Credentials.read(path)
        client = LeagueClient(Credentials(1234, "test"), Path(__file__).parents[1] / "assets/riotgames.pem")
        with self.assertRaises(ValueError):
            client.get("/lol-champ-select/v1/session/actions/1")

    def test_custom_bot_roster_without_pick_actions_and_unassigned_local_role(self):
        raw = {"isCustomGame": True, "localPlayerCellId": 0, "myTeam": [
            {"cellId": 0, "championId": 0, "championPickIntent": 32, "assignedPosition": ""},
            {"cellId": 1, "championId": 9, "assignedPosition": "jungle"},
            {"cellId": 2, "championId": 83, "assignedPosition": "top"},
            {"cellId": 3, "championId": 50, "assignedPosition": "bottom"},
            {"cellId": 4, "championId": 147, "assignedPosition": "utility"}],
            "theirTeam": [{"cellId": 5, "championId": 64, "assignedPosition": "jungle"},
                          {"cellId": 6, "championId": 0}],
            "actions": [[{"actorCellId": 0, "championId": 32, "type": "pick", "completed": False}]]}
        value = normalize_session(raw)
        self.assertEqual([p["id"] for p in value["allies"]], [9, 83, 50, 147])
        self.assertEqual(value["enemies"], [{"id": 64, "role": None}])
        self.assertEqual(value["playerRole"], "middle")
        self.assertIsNone(value["playerChampion"])
        # A human hover remains excluded, even if its roster ID is populated.
        raw["myTeam"][0]["championId"] = 32
        self.assertIsNone(normalize_session(raw)["playerChampion"])
        raw["actions"][0][0]["completed"] = True
        self.assertEqual(normalize_session(raw)["playerChampion"], 32)
        # Do not apply this custom-game fallback to ordinary draft sessions.
        raw["isCustomGame"] = False
        self.assertEqual(normalize_session(raw)["allies"], [])
        raw["myTeam"][4]["assignedPosition"] = ""
        self.assertIsNone(normalize_session(raw)["playerRole"])


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.stop = threading.Event()
        self.state = State()
        self.server = BridgeServer(("127.0.0.1", 0), self.state, self.stop)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, headers=None, method="GET"):
        return urlopen(Request(self.server.origin + path, headers=headers or {}, method=method), timeout=2)

    def test_auth_host_origin_and_no_static_file_serving(self):
        for path in ("/", "/draft.mjs", "/data/draft/catalog.json", "/../companion/app.py"):
            with self.assertRaises(HTTPError) as error:
                self.request(path)
            self.assertEqual(error.exception.code, 404)
        with self.assertRaises(HTTPError) as error:
            self.request("/api/state")
        self.assertEqual(error.exception.code, 403)
        auth = {"X-DraftLab-Session": self.server.session_token}
        self.assertEqual(json.load(self.request("/api/state", auth))["companionVersion"], VERSION)
        for headers in ({**auth, "Host": "evil.example"}, {**auth, "Origin": "https://evil.example"}):
            with self.assertRaises(HTTPError) as error:
                self.request("/api/state", headers)
            self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError):
            self.request("/data/")
        self.request("/api/quit", auth, "POST").close()
        self.assertTrue(self.stop.wait(1))

    def test_live_launch_and_strict_cors_preflight(self):
        from urllib.parse import parse_qs, urlsplit
        launch = urlsplit(self.server.launch_url)
        self.assertEqual(launch.scheme + '://' + launch.netloc + launch.path, LIVE_SITE)
        self.assertEqual(launch.query, '')
        self.assertEqual(parse_qs(launch.fragment), {'companion': [self.server.session_token], 'port': [str(self.server.server_port)]})
        headers = {'Origin': LIVE_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-draftlab-session'}
        for origin in LIVE_ORIGINS:
            with self.request('/api/state', {**headers, 'Origin': origin}, 'OPTIONS') as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], origin)
                self.assertEqual(response.headers['Access-Control-Allow-Methods'], 'GET')
                self.assertEqual(response.headers['Access-Control-Allow-Headers'], 'X-DraftLab-Session')
                self.assertIsNone(response.headers.get('Access-Control-Allow-Credentials'))
        for broken in ({**headers, 'Origin': 'https://evil.example'}, {**headers, 'Origin': LIVE_ORIGIN + '.evil.example'},
                       {**headers, 'Origin': 'https://draftedge.website.evil.example'}, {**headers, 'Origin': 'http://draftedge.website'},
                       {**headers, 'Host': 'evil.example'}, {**headers, 'Access-Control-Request-Method': 'POST'},
                       {**headers, 'Access-Control-Request-Headers': 'x-draftlab-session, authorization'}):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/state', broken, 'OPTIONS')
            self.assertEqual(error.exception.code, 403)
            if broken.get('Origin') != LIVE_ORIGIN or broken.get('Host') == 'evil.example':
                self.assertIsNone(error.exception.headers.get('Access-Control-Allow-Origin'))

    def test_live_origin_needs_token_and_only_exposes_read_only_client_state(self):
        headers = {'Origin': LIVE_ORIGIN, 'X-DraftLab-Session': self.server.session_token}
        for origin in LIVE_ORIGINS:
            with self.request('/api/state', {**headers, 'Origin': origin}) as response:
                self.assertEqual(json.load(response)['bridgeProtocol'], 1)
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], origin)
        for token in ('', 'wrong', 'é'):
            with self.assertRaises(HTTPError) as error:
                self.request('/api/state', {**headers, 'X-DraftLab-Session': token})
            self.assertEqual(error.exception.code, 403)
        with self.assertRaises(HTTPError) as error:
            self.request('/lol-champ-select/v1/session/actions/1', headers, 'POST')
        self.assertEqual(error.exception.code, 404)
        with self.request('/api/quit', {'Origin': LIVE_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-draftlab-session'}, 'OPTIONS') as response:
            self.assertEqual(response.status, 204)
        self.request('/api/quit', headers, 'POST').close()
        self.assertTrue(self.stop.wait(1))

    def test_non_loopback_bind_is_rejected(self):
        with self.assertRaises(ValueError):
            BridgeServer(('0.0.0.0', 0), self.state, self.stop)

    def test_state_revision_changes_only_when_meaningful(self):
        self.state.publish("connected", "Ready", None)
        revision = self.state.read()["revision"]
        self.state.publish("connected", "Ready", None)
        self.assertEqual(self.state.read()["revision"], revision)
        self.state.publish("champ_select", "Ready", {"allies": []})
        self.assertGreater(self.state.read()["revision"], revision)


class LocalClientIntegrationTests(unittest.TestCase):
    def test_real_https_transport_polling_normalization_and_new_lobby(self):
        openssl = shutil.which('openssl') or 'C:/Program Files/Git/usr/bin/openssl.exe'
        if not Path(openssl).is_file():
            self.skipTest('OpenSSL is required to generate a disposable local TLS test certificate.')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cert, key = root / 'test.pem', root / 'test.key'
            subprocess.run([openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                            '-out', str(cert), '-days', '1', '-subj', '/CN=localhost'],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            phase, calls = ['ChampSelect'], []
            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_GET(self):
                    calls.append((self.command, self.path))
                    expected = 'Basic ' + base64.b64encode(b'riot:test-password').decode()
                    if self.headers.get('Authorization') != expected:
                        self.send_error(401)
                        return
                    payload = phase[0] if self.path.endswith('gameflow-phase') else example_session()
                    body = json.dumps(payload).encode()
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(str(cert), str(key))
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                (root / 'lockfile').write_text(f'LeagueClient:123:{server.server_port}:test-password:https')
                state = State()
                poller = Poller(state, threading.Event(), cert, root)
                poller.tick()
                first = state.read()
                self.assertEqual(first['status'], 'champ_select')
                self.assertEqual(first['snapshot']['enemies'], [{'id': 64, 'role': None}])
                self.assertNotIn('test-password', json.dumps(first))
                phase[0] = 'Lobby'
                poller.tick()
                self.assertIsNone(state.read()['snapshot'])
                phase[0] = 'ChampSelect'
                poller.tick()
                self.assertNotEqual(first['snapshot']['sessionId'], state.read()['snapshot']['sessionId'])
                self.assertTrue(all(method == 'GET' and path in ('/lol-gameflow/v1/gameflow-phase', '/lol-champ-select/v1/session') for method, path in calls))
                untrusted = Poller(State(), threading.Event(), Path(__file__).parents[1] / 'assets/riotgames.pem', root)
                untrusted.tick()
                self.assertEqual(untrusted.state.read()['status'], 'reconnecting')
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
