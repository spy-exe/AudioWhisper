import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from test_workspace_projects import seed


@pytest.fixture
def queue(monkeypatch):
    value = SimpleNamespace(enqueue=Mock())
    monkeypatch.setattr("app.routers.knowledge.get_queue", lambda: value)
    monkeypatch.setattr("app.routers.recipes.get_queue", lambda: value)
    return value


def test_questions_validate_selection_persist_and_surface_queue_failure(client, queue):
    project = f"Conhecimento-{uuid.uuid4().hex}"
    job, _ = seed(project)
    payload = {"question": "O que foi decidido sobre os alertas?", "project": project, "job_ids": [job], "model": "local"}
    response = client.post("/api/knowledge", json=payload)
    assert response.status_code == 202
    question = response.json()
    assert question["status"] == "queued"
    assert queue.enqueue.call_args.args == ("app.workspace_tasks.run_question", question["id"])
    assert client.get("/api/knowledge", params={"project": project}).json()["items"][0]["question"] == payload["question"]
    assert client.post("/api/knowledge", json={**payload, "job_ids": ["missing"]}).status_code == 422
    assert client.post("/api/knowledge", json={**payload, "question": "  "}).status_code == 422
    queue.enqueue.side_effect = RuntimeError("offline")
    failed = client.post("/api/knowledge", json=payload)
    assert failed.status_code == 503
    assert client.get("/api/knowledge", params={"project": project}).json()["items"][0]["status"] == "failed"


def test_recipes_are_explicit_templates_and_runs_are_idempotent(client, queue):
    project = f"Receitas-{uuid.uuid4().hex}"
    job, _ = seed(project)
    payload = {"name": "Ata de infraestrutura", "project": project, "kind": "minutes", "model": "local", "instruction": "Destaque os riscos"}
    response = client.post("/api/recipes", json=payload)
    assert response.status_code == 201
    recipe = response.json()
    assert not recipe["automatic"]
    assert client.post(f"/api/recipes/{recipe['id']}/run", json={"job_id": job}).status_code == 202
    first = client.get("/api/recipe-runs", params={"project": project}).json()["items"][0]
    again = client.post(f"/api/recipes/{recipe['id']}/run", json={"job_id": job}).json()
    assert again["id"] == first["id"] and queue.enqueue.call_count == 1
    updated = client.patch(f"/api/recipes/{recipe['id']}", json={"automatic": True, "revision": 1}).json()
    assert updated["automatic"]
    assert client.patch(f"/api/recipes/{recipe['id']}", json={"enabled": False, "revision": 1}).status_code == 409
    assert client.post("/api/recipes", json={**payload, "kind": "invalid"}).status_code == 422
    other, _ = seed(f"Outro-{uuid.uuid4().hex}")
    assert client.post(f"/api/recipes/{recipe['id']}/run", json={"job_id": other}).status_code == 422
