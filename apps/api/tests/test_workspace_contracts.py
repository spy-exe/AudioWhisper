import json
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import KnowledgeQuestion, RecipeRun, WorkspaceItem
from test_workspace_projects import seed
from test_workspace_actions import document


@pytest.fixture
def queue(monkeypatch):
    value = SimpleNamespace(enqueue=Mock())
    monkeypatch.setattr("app.routers.knowledge.get_queue", lambda: value)
    monkeypatch.setattr("app.routers.recipes.get_queue", lambda: value)
    return value


@pytest.mark.parametrize("method,path,body", [
    ("patch", "/api/tasks/missing", {"revision": 1, "title": "Teste"}),
    ("patch", "/api/notebook/missing", {"revision": 1, "body": "Teste"}),
    ("patch", "/api/recipes/missing", {"revision": 1, "enabled": False}),
    ("post", "/api/knowledge/missing/retry", {}),
    ("post", "/api/recipe-runs/missing/retry", {}),
    ("post", "/api/recipes/missing/run", {"job_id": "missing"}),
])
def test_missing_workspace_records_return_404(client, method, path, body):
    assert getattr(client, method)(path, json=body).status_code == 404


def test_new_workspace_endpoints_inherit_the_existing_access_boundary(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "access_token", "workspace-test-access-token")
    client.cookies.clear()
    for path in ("projects", "search", "tasks", "notebook", "knowledge", "recipes", "recipe-runs", "workspace"):
        assert client.get(f"/api/{path}").status_code == 401


@pytest.mark.parametrize("patch", [{"title": "  "}, {"title": None}, {"status": None}, {"archived": None}])
def test_invalid_task_edits_preserve_saved_content(client, patch):
    task = client.post("/api/tasks", json={"title": "Conteúdo preservado"}).json()
    assert client.patch(f"/api/tasks/{task['id']}", json={**patch, "revision": 1}).status_code == 422
    saved = client.get("/api/tasks", params={"task_id": task["id"]}).json()["items"][0]
    assert saved["title"] == "Conteúdo preservado" and saved["revision"] == 1


def test_tasks_clear_deadlines_and_filter_by_status_and_literal_content(client):
    project = uuid.uuid4().hex
    seed(project)
    task = client.post("/api/tasks", json={"title": "Verificar 100%_literal", "project": project, "due_date": "2026-12-01"}).json()
    response = client.patch(f"/api/tasks/{task['id']}", json={"due_date": None, "status": "done", "revision": 1})
    assert response.json()["due_date"] is None
    assert client.get("/api/tasks", params={"project": project, "status": "done", "q": "100%_literal"}).json()["total"] == 1
    assert client.get("/api/tasks", params={"project": project, "status": "open"}).json()["total"] == 0
    assert client.post("/api/tasks", json={"title": "Teste", "project": "inexistente"}).status_code == 404


def test_notebook_archiving_and_speaker_corrections_keep_provenance_visible(client):
    project = uuid.uuid4().hex
    job, segment = seed(project)
    note = client.post(f"/api/jobs/{job}/notes", json={"segment_id": segment, "title": "Fonte", "kind": "bookmark"}).json()
    with session_scope() as db:
        db.get(WorkspaceItem, job).speakers_json = json.dumps({"s1": "Nome corrigido"})
    page = client.get("/api/notebook", params={"project": project, "kind": "bookmark"}).json()
    assert page["items"][0]["stale"]
    assert client.patch(f"/api/notebook/{note['id']}", json={"revision": 1, "title": None}).status_code == 422
    assert client.patch(f"/api/notebook/{note['id']}", json={"revision": 1, "archived": True}).status_code == 200
    assert client.get("/api/notebook", params={"project": project}).json()["total"] == 0
    assert client.get("/api/notebook", params={"project": project, "archived": True}).json()["total"] == 1


def test_import_with_no_actions_is_an_explicit_no_op(client):
    job, segment = seed(uuid.uuid4().hex)
    doc = document(job, segment)
    from audiowhisper_core.models import AIDocument
    with session_scope() as db:
        db.get(AIDocument, doc).content_json = "[]"
    assert client.post("/api/tasks/import", json={"document_id": doc}).json() == {"imported": 0, "items": []}


def test_recipe_snapshots_and_retry_survive_edits_and_queue_failure(client, queue):
    project = uuid.uuid4().hex
    job, _ = seed(project)
    recipe = client.post("/api/recipes", json={"name": "Original", "kind": "summary", "model": "local", "project": project, "instruction": "Texto original"}).json()
    queue.enqueue.side_effect = RuntimeError("offline")
    assert client.post(f"/api/recipes/{recipe['id']}/run", json={"job_id": job}).status_code == 503
    run = client.get("/api/recipe-runs", params={"project": project}).json()["items"][0]
    assert run["status"] == "failed"
    assert client.patch(f"/api/recipes/{recipe['id']}", json={"revision": 1, "instruction": "Novas instruções"}).status_code == 200
    with session_scope() as db:
        assert json.loads(db.get(RecipeRun, run["id"]).payload_json)["instruction"] == "Texto original"
    queue.enqueue.side_effect = None
    assert client.post(f"/api/recipe-runs/{run['id']}/retry", json={}).status_code == 202
    assert client.post(f"/api/recipe-runs/{run['id']}/retry", json={}).status_code == 409
    assert client.patch(f"/api/recipes/{recipe['id']}", json={"revision": 2, "enabled": False}).status_code == 200
    assert client.post(f"/api/recipes/{recipe['id']}/run", json={"job_id": job}).status_code == 409
    assert client.patch(f"/api/recipes/{recipe['id']}", json={"revision": 3, "name": " "}).status_code == 422
    assert client.patch(f"/api/recipes/{recipe['id']}", json={"revision": 3, "instruction": None}).status_code == 422


def test_questions_enforce_project_scope_and_retry_failed_queue_submission(client, queue):
    project = uuid.uuid4().hex
    seed(project)
    other, _ = seed(uuid.uuid4().hex)
    payload = {"question": "Onde estão os alertas?", "project": project, "model": "local"}
    assert client.post("/api/knowledge", json={**payload, "job_ids": [other]}).status_code == 422
    queue.enqueue.side_effect = RuntimeError("offline")
    assert client.post("/api/knowledge", json=payload).status_code == 503
    question = client.get("/api/knowledge", params={"project": project}).json()["items"][0]
    queue.enqueue.side_effect = None
    assert client.post(f"/api/knowledge/{question['id']}/retry", json={}).status_code == 202
    assert client.post(f"/api/knowledge/{question['id']}/retry", json={}).status_code == 409
    with session_scope() as db:
        db.get(KnowledgeQuestion, question["id"]).status = "completed"


def test_pending_question_limit_is_recoverable_after_jobs_finish(client, queue):
    created = []
    try:
        for _ in range(5):
            response = client.post("/api/knowledge", json={"question": "Como estão os alertas?", "model": "local"})
            if response.status_code == 202:
                created.append(response.json()["id"])
        assert client.post("/api/knowledge", json={"question": "Uma nova pergunta", "model": "local"}).status_code == 409
    finally:
        with session_scope() as db:
            for question in db.scalars(select(KnowledgeQuestion).where(KnowledgeQuestion.id.in_(created))):
                question.status = "completed"
