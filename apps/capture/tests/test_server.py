from fastapi.testclient import TestClient
from unittest.mock import Mock

from audiowhisper_capture.client import StudioClient
from audiowhisper_capture.server import create_app

import pytest


@pytest.fixture
def client():
    manager = Mock()
    manager.status.return_value = {"recording": False}
    manager.start.return_value = {"recording": True, "job_id": "test-job"}
    manager.stop.return_value = {"recording": False}
    app = create_app(manager, ["http://localhost:8080"], lambda: {"microphones": [], "outputs": []})
    with TestClient(app, base_url="http://127.0.0.1:8765", headers={"Origin": "http://localhost:8080", "X-AudioWhisper-Capture": "1"}) as test_client:
        yield test_client, manager


def test_only_the_configured_studio_origin_can_control_capture(client):
    browser, manager = client
    assert browser.post("/start", json={"source": "mixed"}).status_code == 201
    assert browser.post("/stop", json={}).status_code == 200
    assert browser.get("/devices").status_code == 200
    assert browser.post("/start", json={}, headers={"Origin": "https://untrusted.example"}).status_code == 403
    assert browser.get("/status", headers={"X-AudioWhisper-Capture": ""}).status_code == 403
    assert browser.post("/start", content="source=system", headers={"Content-Type": "application/x-www-form-urlencoded"}).status_code == 415
    assert manager.start.call_count == 1


def test_host_validation_blocks_dns_rebinding_and_cors_rejects_other_origins(client):
    browser, _manager = client
    assert browser.get("/health", headers={"Host": "attacker.example"}).status_code == 400
    response = browser.options("/start", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_request_cannot_change_the_upstream_url_or_supply_a_path_as_a_device(client):
    browser, manager = client
    assert browser.post("/start", json={"api_url": "https://external.example"}).status_code == 422
    assert browser.post("/start", json={"microphone": "../private"}).status_code == 422
    manager.status.return_value = {"recording": True}
    assert browser.post("/start", json={}).status_code == 409
    assert not manager.start.called


@pytest.mark.parametrize("url", ["https://external.example", "http://127.0.0.1/other", "http://user@localhost:8080"])
def test_server_client_rejects_nonlocal_or_credential_urls(url):
    with pytest.raises(ValueError):
        StudioClient(url)
