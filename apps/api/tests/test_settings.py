def test_get_settings_returns_defaults(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    body = resp.json()
    assert "default_model" in body
    assert "transcription_device" in body


def test_put_settings_persists_and_is_returned(client):
    resp = client.put(
        "/api/settings", json={"values": {"default_model": "large-v3", "default_beam_size": 8}}
    )
    assert resp.status_code == 200

    got = client.get("/api/settings").json()
    assert got["default_model"] == "large-v3"
    assert got["default_beam_size"] == 8


def test_put_settings_ignores_unknown_keys(client):
    resp = client.put("/api/settings", json={"values": {"totally_unknown_key": "x"}})
    assert resp.status_code == 200
    got = client.get("/api/settings").json()
    assert "totally_unknown_key" not in got
