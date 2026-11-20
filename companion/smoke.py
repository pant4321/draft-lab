"""Exercise a frozen executable as a black box without changing the League client."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import time
import sys
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.app import VERSION, LIVE_SITE, LIVE_ORIGIN, LIVE_ORIGINS


def smoke(executable):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        ready = root / 'ready.json'
        # A deliberately invalid fixture prevents discovery of the user's League client.
        (root / 'lockfile').write_text('fixture', encoding='ascii')
        process = subprocess.Popen([str(Path(executable).resolve(strict=True)), '--headless', '--no-browser',
                                    '--no-update-check', '--port', '0', '--ready-file', str(ready),
                                    '--league-folder', str(root)])
        try:
            deadline = time.monotonic() + 45
            while not ready.is_file():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Companion did not start.')
                time.sleep(.1)
            launch = urlsplit(json.loads(ready.read_text())['url'])
            assert launch.scheme + '://' + launch.netloc + launch.path == LIVE_SITE
            params = parse_qs(launch.fragment)
            origin = 'http://127.0.0.1:' + params['port'][0]
            token = params['companion'][0]
            headers = {'X-DraftLab-Session': token, 'Origin': LIVE_ORIGIN}
            for live_origin in LIVE_ORIGINS:
                preflight = {'Origin': live_origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-draftlab-session'}
                with urlopen(Request(origin + '/api/state', headers=preflight, method='OPTIONS'), timeout=5) as response:
                    assert response.status == 204 and response.headers['Access-Control-Allow-Origin'] == live_origin
                with urlopen(Request(origin + '/api/state', headers={**headers, 'Origin': live_origin}), timeout=5) as response:
                    assert response.headers['Access-Control-Allow-Origin'] == live_origin
                    assert json.load(response)['companionVersion'] == VERSION
            with urlopen(Request(origin + '/api/state?remember=1', headers=headers), timeout=5) as response:
                key = json.load(response)['reconnectKey']
            assert key != token
            reconnect = {'X-DraftLab-Reconnect': key, 'Origin': LIVE_ORIGIN}
            with urlopen(Request(origin + '/api/reconnect', headers=reconnect, method='POST'), timeout=5) as response:
                session = json.load(response)
            with urlopen(Request(origin + '/api/state', headers={**headers, 'X-DraftLab-Session': session['token']}), timeout=5) as response:
                assert json.load(response)['bridgeProtocol'] == 1
            try:
                urlopen(origin + '/api/state', timeout=5)
                raise AssertionError('Unauthenticated client state was exposed.')
            except HTTPError as error:
                assert error.code == 403
            with urlopen(Request(origin + '/api/quit', headers=headers, method='POST'), timeout=5) as response:
                assert json.load(response)['stopping']
            assert process.wait(timeout=15) == 0
            print('Frozen executable smoke test passed: live-site launch, strict CORS, authenticated API, reconnect, shutdown.')
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('executable', type=Path)
    smoke(parser.parse_args().executable)


if __name__ == '__main__':
    main()
