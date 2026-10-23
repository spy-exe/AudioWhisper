import json
from unittest.mock import MagicMock

import pytest

import serve_fixture


@pytest.mark.parametrize("url", [
    "http://localhost:8080", "http://127.0.0.1:8080", "http://localhost",
    "http://remote.example:8090", "http://user@localhost:8090",
    "http://localhost:8090/private", "http://localhost:8090?test=true",
])
def test_fixture_refuses_personal_or_remote_studios_before_connecting(url, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(serve_fixture, "StudioClient", client)
    with pytest.raises(ValueError, match="isolated E2E"):
        serve_fixture.test_studio_client(url)
    client.assert_not_called()


@pytest.mark.parametrize("body", [None, {}, {"environment": "production"},
    {"environment": "e2e", "status": "degraded", "service": "api"}])
def test_fixture_requires_e2e_health_before_creating_any_audio(body, monkeypatch):
    client = MagicMock()
    client.opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(body).encode()
    monkeypatch.setattr(serve_fixture, "StudioClient", lambda _url: client)
    with pytest.raises(ValueError, match="isolated E2E"):
        serve_fixture.test_studio_client("http://localhost:8090")
    client.create.assert_not_called()


def test_fixture_only_reads_health_from_the_configured_test_studio(monkeypatch):
    client = MagicMock()
    client.opener.open.return_value.__enter__.return_value.read.return_value = b'{"environment":"e2e","service":"api","status":"ok"}'
    monkeypatch.setattr(serve_fixture, "StudioClient", lambda _url: client)
    assert serve_fixture.test_studio_client("http://127.0.0.1:8090/") is client
    request = client.opener.open.call_args.args[0]
    assert request.full_url == "http://127.0.0.1:8090/api/health"
    assert request.get_method() == "GET"
    client.create.assert_not_called()
