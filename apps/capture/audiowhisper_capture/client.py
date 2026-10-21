import json
import uuid
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class StudioClient:
    def __init__(self, url, token=""):
        parsed = urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.username or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("O capturador se conecta somente ao Studio HTTP local")
        self.url, self.token = url.rstrip("/"), token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, path, payload=None, data=None, content_type="application/json"):
        body = data if data is not None else json.dumps(payload).encode()
        headers = {"Content-Type": content_type}
        if self.token:
            headers["X-Access-Token"] = self.token
        with self.opener.open(Request(self.url + path, data=body, headers=headers, method="POST"), timeout=10) as response:
            return json.load(response)

    def create(self, title, source, settings):
        return self.request("/api/live", {"title": title, "source": source, "settings": settings})["id"]

    def upload(self, job_id, sequence, start, path):
        boundary = uuid.uuid4().hex
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
                + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode())
        query = urlencode({"start": start, "revision": 0, "final": "true"})
        self.request(f"/api/live/{job_id}/chunks/{sequence}?{query}", data=data, content_type=f"multipart/form-data; boundary={boundary}")

    def stop(self, job_id, expected_chunks, duration):
        self.request(f"/api/live/{job_id}/stop", {"expected_chunks": expected_chunks, "duration": duration})
