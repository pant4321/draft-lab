"""Manual browser QA fixture. Never reads or modifies the League client."""
import argparse
import json
from pathlib import Path
import threading
from companion.app import BridgeServer, State


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('ready', type=Path)
    args = parser.parse_args()
    stop, state = threading.Event(), State()
    server = BridgeServer(('127.0.0.1', 8767), state, stop)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    args.ready.write_text(json.dumps({'url': server.launch_url}), encoding='utf-8')
    try:
        while not stop.is_set():
            if args.snapshot.is_file():
                try:
                    state.publish('champ_select', 'Test draft connection', json.loads(args.snapshot.read_text(encoding='utf-8')))
                except ValueError:
                    pass
            stop.wait(.25)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
