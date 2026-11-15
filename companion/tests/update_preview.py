"""Preview update notifications without disturbing an already running companion."""
import argparse
import json
from pathlib import Path
from types import SimpleNamespace
import threading

from companion.app import BridgeServer, State, launcher
from companion.updates import UpdateChecker


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ready-file", type=Path, required=True)
    parser.add_argument("--installed-version", default="0.1.2")
    args = parser.parse_args()
    stop, state = threading.Event(), State()
    state.publish("connected", "Update-check preview", None)
    server = BridgeServer(("127.0.0.1", 0), state, stop)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    checker = UpdateChecker(state, stop, args.installed_version)
    worker = checker.start()
    args.ready_file.write_text(json.dumps({"url": server.launch_url}), encoding="utf-8")
    try:
        launcher(server, SimpleNamespace(), stop, checker, title="Draft Lab · Update preview")
    finally:
        stop.set();server.shutdown();server.server_close()
        serving.join(timeout=6)
        if worker is not None:
            worker.join(timeout=6)


if __name__ == "__main__":
    main()
