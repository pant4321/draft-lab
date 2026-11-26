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
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from companion.app import BridgeServer, State, VERSION, LIVE_SITE, LIVE_ORIGIN, LIVE_ORIGINS
from companion.lcu import Credentials, LeagueClient, LiveGameClient, Poller, normalize_match, normalize_session


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


def example_match_players():
    positions = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
    teams = {"ORDER": ("Renekton", "LeeSin", "Orianna", "Caitlyn", "Xerath"),
             "CHAOS": ("Gwen", "Shaco", "Ahri", "Ashe", "Nami")}
    return [
        {"team": team, "rawChampionName": f"game_character_displayname_{key}", "position": role,
         "riotId": f"PRIVATE#{key}", "summonerName": f"PRIVATE-{key}", "puuid": "PRIVATE"}
        for team, champions in teams.items()
        for key, role in zip(champions, positions)
    ]


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

    def test_match_roles_use_the_local_players_team_and_exclude_identities(self):
        players = example_match_players()
        value = normalize_match(players, "PRIVATE#Shaco")
        self.assertEqual(value["player"], {"key": "shaco", "role": "jungle"})
        self.assertEqual(value["allies"][-1], {"key": "nami", "role": "support"})
        self.assertEqual(value["enemies"][1], {"key": "leesin", "role": "jungle"})
        self.assertNotIn("PRIVATE", json.dumps(value))
        self.assertEqual(normalize_match(players, "PRIVATE-Shaco"), value)
        self.assertIsNone(normalize_match(players, "Unknown"))
        players[0]["position"] = "NONE"
        self.assertIsNone(normalize_match(players, "PRIVATE#Shaco"))
        players[0]["position"] = "JUNGLE"
        self.assertIsNone(normalize_match(players, "PRIVATE#Shaco"))

    def test_match_api_uses_fixed_local_gets_and_skips_other_maps(self):
        from io import BytesIO
        cert = Path(__file__).parents[1] / "assets/riotgames.pem"
        client = LiveGameClient(cert)
        players = example_match_players()
        players[0]["position"] = "NONE"
        responses = [{"mapNumber": 11, "gameMode": "CLASSIC", "gameTime": 4}, players, "PRIVATE#Shaco",
                     {"mapNumber": 11, "gameMode": "CLASSIC", "gameTime": 62}, players, "PRIVATE#Shaco",
                     {"mapNumber": 12, "gameMode": "KIWI"}]
        with patch.object(client.opener, "open", side_effect=[BytesIO(json.dumps(row).encode()) for row in responses]) as get:
            self.assertEqual(client.read(), (None, False))
            self.assertEqual(client.read(), (None, True))
            self.assertEqual(client.read(), (None, True))
        self.assertEqual(
            [call.args[0] for call in get.call_args_list],
            ["https://127.0.0.1:2999/liveclientdata/" + endpoint for endpoint in
             ("gamestats", "playerlist", "activeplayername", "gamestats", "playerlist", "activeplayername", "gamestats")],
        )

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

    def test_build_route_requires_a_session_and_accepts_only_build_parameters(self):
        path = "/api/build?slug=ahri&id=103&role=middle&tier=emerald_plus"
        auth = {"X-DraftLab-Session": self.server.session_token, "Origin": LIVE_ORIGIN}
        with patch("companion.app.get_build", return_value={"games": 20}) as build:
            with self.assertRaises(HTTPError) as missing_auth:
                self.request(path, {"Origin": LIVE_ORIGIN})
            self.assertEqual(missing_auth.exception.code, 403)
            with self.assertRaises(HTTPError) as invalid:
                self.request(path + "&url=example.com", auth)
            self.assertEqual(invalid.exception.code, 400)
            with self.assertRaises(HTTPError) as partial_opponent:
                self.request(path + "&opponent=yone", auth)
            self.assertEqual(partial_opponent.exception.code, 400)
            build.assert_not_called()
            with self.request(path, auth) as response:
                self.assertEqual(json.load(response), {"build": {"games": 20}})
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], LIVE_ORIGIN)
            build.assert_called_once_with("ahri", 103, "middle", "emerald_plus")
            with self.request(path + "&opponent=yone&opponentId=777&opponentRole=top", auth) as response:
                self.assertEqual(response.status, 200)
            build.assert_called_with("ahri", 103, "middle", "emerald_plus", ("yone", 777, "top"))
            with self.request(path + "&draft=ornn:516:top,yone:777:middle", auth) as response:
                self.assertEqual(response.status, 200)
            build.assert_called_with("ahri", 103, "middle", "emerald_plus", None,
                                     (("ornn", 516, "top"), ("yone", 777, "middle")))
            with self.assertRaises(HTTPError) as duplicate_role:
                self.request(path + "&draft=ornn:516:top,yone:777:top", auth)
            self.assertEqual(duplicate_role.exception.code, 400)

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

    def test_pairing_claim_is_one_time_and_session_is_bound_to_the_preview_origin(self):
        from unittest.mock import patch
        from companion.pairing import PendingPairings

        origin, ticket = "http://127.0.0.1:8792", "a" * 64
        pair_headers = {"Origin": origin, "X-DraftLab-Pairing": ticket}
        with tempfile.TemporaryDirectory() as directory:
            self.server.pairings = PendingPairings(directory)
            with patch("companion.pairing.PAIRING_PORTS", (self.server.server_port,)):
                with self.assertRaises(HTTPError) as missing:
                    self.request("/api/pair", pair_headers, "POST")
                self.assertEqual(missing.exception.code, 404)
                self.server.pairings.offer(origin, (ticket,))
                with self.assertRaises(HTTPError) as wrong_origin:
                    self.request("/api/pair", {**pair_headers, "Origin": LIVE_ORIGIN}, "POST")
                self.assertEqual(wrong_origin.exception.code, 404)
                with self.request("/api/pair", pair_headers, "POST") as response:
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
                    session = json.load(response)
                with self.assertRaises(HTTPError) as replay:
                    self.request("/api/pair", pair_headers, "POST")
                self.assertEqual(replay.exception.code, 404)
                next_ticket = "b" * 64
                self.server.pairings.offer(origin, (next_ticket,))
                self.server.request_stop()
                with self.assertRaises(HTTPError) as stopping:
                    self.request("/api/pair", {**pair_headers, "X-DraftLab-Pairing": next_ticket}, "POST")
                self.assertEqual(stopping.exception.code, 503)
                self.assertTrue(self.server.pairings.claim(origin, self.server.server_port, next_ticket))
        auth = {"Origin": origin, "X-DraftLab-Session": session["token"]}
        with self.request("/api/state", auth) as response:
            self.assertEqual(json.load(response)["bridgeProtocol"], 1)
        for headers in ({**auth, "Origin": LIVE_ORIGIN},
                        {**auth, "X-DraftLab-Session": self.server.session_token}):
            with self.assertRaises(HTTPError) as rejected:
                self.request("/api/state", headers)
            self.assertEqual(rejected.exception.code, 403)

    def test_non_loopback_bind_is_rejected(self):
        with self.assertRaises(ValueError):
            BridgeServer(('0.0.0.0', 0), self.state, self.stop)

    def test_reconnect_key_requires_authenticated_pairing_and_is_scoped_to_origin_and_process(self):
        headers = {'Origin': LIVE_ORIGIN, 'X-DraftLab-Session': self.server.session_token}
        with self.request('/api/state', headers) as response:
            self.assertNotIn('reconnectKey', json.load(response))
        with self.assertRaises(HTTPError) as unauthenticated:
            self.request('/api/state?remember=1', {'Origin': LIVE_ORIGIN})
        self.assertEqual(unauthenticated.exception.code, 403)

        with self.request('/api/state?remember=1', headers) as response:
            key = json.load(response)['reconnectKey']
        self.assertNotEqual(key, self.server.session_token)
        reconnect = {'Origin': LIVE_ORIGIN, 'X-DraftLab-Reconnect': key}
        with self.request('/api/reconnect', reconnect, 'POST') as response:
            self.assertEqual(response.headers['Access-Control-Allow-Origin'], LIVE_ORIGIN)
            session = json.load(response)
            self.assertIs(session['championBuilds'], True)
        with self.request('/api/state', {**headers, 'X-DraftLab-Session': session['token']}) as response:
            self.assertEqual(json.load(response)['bridgeProtocol'], 1)

        invalid = (("/api/reconnect", {**reconnect, 'Origin': 'https://draftedge.website'}, 'POST'),
                   ("/api/reconnect", {**reconnect, 'X-DraftLab-Reconnect': self.server.session_token}, 'POST'),
                   ("/api/quit", {**headers, 'X-DraftLab-Session': key}, 'POST'))
        for path, credentials, method in invalid:
            with self.assertRaises(HTTPError) as rejected:
                self.request(path, credentials, method)
            self.assertEqual(rejected.exception.code, 403)

        self.request('/api/quit', headers, 'POST').close()
        self.assertTrue(self.stop.wait(1))
        with self.assertRaises(HTTPError) as stopped:
            self.request('/api/reconnect', reconnect, 'POST')
        self.assertEqual(stopped.exception.code, 403)

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
                match = normalize_match(example_match_players(), "PRIVATE#Shaco")
                with patch("companion.lcu.LiveGameClient.read",
                           side_effect=[OSError, (None, False), (match, False), (match, False)]) as live:
                    phase[0] = 'GameStart'
                    poller.tick()
                    self.assertEqual(state.read()['status'], 'in_game')
                    self.assertIsNone(state.read()['snapshot'])
                    poller.tick()
                    self.assertIsNone(state.read()['snapshot'])
                    phase[0] = 'InProgress'
                    poller.tick()
                    started = state.read()
                    self.assertEqual(started['snapshot']['sessionId'], first['snapshot']['sessionId'])
                    self.assertEqual(started['snapshot']['bans'], first['snapshot']['bans'])
                    self.assertEqual(started['snapshot']['enemies'][1], {'key': 'leesin', 'role': 'jungle'})
                    phase[0] = 'Reconnect'
                    poller.tick()
                    self.assertEqual(live.call_count, 3)
                    self.assertEqual(state.read(), started)
                    phase[0] = 'EndOfGame'
                    poller.tick()
                    self.assertIsNone(state.read()['snapshot'])
                    phase[0] = 'InProgress'
                    poller.tick()
                    joined = state.read()['snapshot']
                    self.assertNotEqual(joined['sessionId'], started['snapshot']['sessionId'])
                    self.assertEqual(joined['bans'], [])
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
