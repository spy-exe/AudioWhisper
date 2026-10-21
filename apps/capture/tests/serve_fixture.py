"""A separate test process: synthetic PCM, real local API/worker, no hardware access."""
import argparse
import sys
import threading
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn
from audiowhisper_capture.client import StudioClient
from audiowhisper_capture.manager import CaptureManager
from audiowhisper_capture.server import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    args = parser.parse_args()

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

    manager = CaptureManager(args.directory, StudioClient("http://127.0.0.1:8080"), FixtureAudio)
    sender = threading.Thread(target=manager.deliver_forever, daemon=True)
    sender.start()
    app = create_app(manager, ["http://localhost:8080", "http://127.0.0.1:8080"], lambda: {
        "microphones": [{"id": "1", "name": "Microfone sintético", "default": True}],
        "outputs": [{"id": "2", "name": "Saída de áudio sintética", "default": True}],
    })
    try:
        uvicorn.run(app, host="127.0.0.1", port=8766, access_log=False)
    finally:
        manager.close()


if __name__ == "__main__":
    main()
