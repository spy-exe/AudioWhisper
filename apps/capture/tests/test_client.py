import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError

import pytest

from audiowhisper_capture.client import StudioClient


def test_native_client_delivers_multipart_audio_and_authenticated_stop_to_the_local_api(tmp_path):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            requests.append((self.path, dict(self.headers), self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps({"id": "client-test-job"}).encode())

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = StudioClient(f"http://127.0.0.1:{server.server_port}", "test-only-token")
        job_id = client.create("Teste", "system", {})
        wav = tmp_path / "sample.wav"
        wav.write_bytes(b"RIFF-test")
        client.upload(job_id, 0, 0, wav)
        client.stop(job_id, 1, 5)
        assert requests[0][0] == "/api/live"
        assert requests[0][1]["X-Access-Token"] == "test-only-token"
        assert requests[1][0] == "/api/live/client-test-job/chunks/0?start=0&revision=0&final=true"
        assert b"RIFF-test" in requests[1][2]
        assert json.loads(requests[2][2]) == {"expected_chunks": 1, "duration": 5}
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
