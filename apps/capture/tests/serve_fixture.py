"""A separate test process: synthetic PCM, real local API/worker, no hardware access."""
import argparse
import json
import sys
import threading
import wave
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from audiowhisper_capture.client import StudioClient
from audiowhisper_capture.manager import CaptureManager
from audiowhisper_capture.server import create_app


def test_studio_client(url):
    error = "The capture fixture requires an isolated E2E Studio on localhost:8090"
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1")
            or parsed.port != 8090 or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError(error)
    client = StudioClient(url)
    try:
        with client.opener.open(Request(url.rstrip("/") + "/api/health", method="GET"), timeout=5) as response:
            health = json.loads(response.read())
        if not isinstance(health, dict) or health.get("environment") != "e2e" or health.get("service") != "api" or health.get("status") != "ok":
            raise ValueError(error)
    except Exception as exc:
        raise ValueError(error) from exc
    return client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--api-url", required=True)
    args = parser.parse_args()
    client = test_studio_client(args.api_url)

    class FixtureAudio:
        power_protected = True

        def __init__(self, *_args):
            pass

        def prepare(self):
            pass

        def close(self):
            pass

        def run(self, consume, stop_event):
            with wave.open(str(args.audio)) as audio:
                while not stop_event.wait(0.1):
                    data = audio.readframes(1600)
                    if not data:
                        audio.rewind()
                        data = audio.readframes(1600)
                    consume(data)

    manager = CaptureManager(args.directory, client, FixtureAudio)
    sender = threading.Thread(target=manager.deliver_forever, daemon=True)
    sender.start()
    app = create_app(manager, [client.url], lambda: {
        "microphones": [{"id": "1", "name": "Microfone sintético", "default": True}],
        "outputs": [{"id": "2", "name": "Saída de áudio sintética", "default": True}],
    })
    try:
        uvicorn.run(app, host="127.0.0.1", port=8766, access_log=False)
    finally:
        manager.close()


if __name__ == "__main__":
    main()
