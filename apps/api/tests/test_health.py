def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["database"] is True
    assert body["redis"] is True
    assert body["environment"] == "test"


def test_health_gpu_without_worker(client):
    resp = client.get("/api/health/gpu")
    assert resp.status_code == 200
    body = resp.json()
    assert body["gpu_available"] is False
    assert "worker" in body["error"].lower()
