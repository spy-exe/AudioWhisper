import json
import uuid
from datetime import datetime, timezone

from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import transcript_hash
from audiowhisper_core.models import AIDocument, TranscriptSegment
from test_workspace_projects import seed


def test_tasks_persist_validate_revision_and_archive_reversibly(client):
    project = f"Tarefas-{uuid.uuid4().hex}"
    seed(project)
    response = client.post("/api/tasks", json={"title": "Verificar alertas", "project": project, "due_date": "2026-11-20", "priority": "high"})
    assert response.status_code == 201
    task = response.json()
    assert task["status"] == "open" and task["sources"] == []
    url = f"/api/tasks/{task['id']}"
    assert client.patch(url, json={"status": "doing", "revision": task["revision"]}).json()["status"] == "doing"
    assert client.patch(url, json={"status": "done", "revision": task["revision"]}).status_code == 409
    current = client.get("/api/tasks", params={"project": project}).json()["items"][0]
    archived = client.patch(url, json={"archived": True, "revision": current["revision"]}).json()
    assert client.get("/api/tasks", params={"project": project}).json()["total"] == 0
    assert client.patch(url, json={"archived": False, "revision": archived["revision"]}).status_code == 200
    assert client.post("/api/tasks", json={"title": "  "}).status_code == 422
    assert client.post("/api/tasks", json={"title": "Teste", "due_date": "amanhã"}).status_code == 422


def document(job, segment, reviewed=True):
    with session_scope() as db:
        source = db.get(TranscriptSegment, segment)
        doc = AIDocument(job_id=job, kind="actions", model="local", status="reviewed" if reviewed else "generated",
                         reviewed_at=datetime.now(timezone.utc) if reviewed else None, source_hash=transcript_hash([source], {"s1": "Ana"}),
                         content_json=json.dumps([{"kind": "action", "text": "Revisar alertas", "source_segment_ids": [segment],
                                                   "evidence_quotes": [source.text], "assignee": "Ana", "due_date": "amanhã"}]))
        db.add(doc)
        db.flush()
        return doc.id


def test_action_import_requires_current_review_is_idempotent_and_keeps_exact_sources(client):
    project = f"Import-{uuid.uuid4().hex}"
    job, segment = seed(project)
    draft = document(job, segment, False)
    assert client.post("/api/tasks/import", json={"document_id": draft}).status_code == 409
    doc = document(job, segment)
    first = client.post("/api/tasks/import", json={"document_id": doc})
    assert first.status_code == 200
    assert first.json()["imported"] == 1
    task = first.json()["items"][0]
    assert task["due_date"] is None and task["due_label"] == "amanhã"
    assert task["sources"][0]["segment_id"] == segment and not task["stale"]
    assert client.post("/api/tasks/import", json={"document_id": doc}).json()["imported"] == 0
    with session_scope() as db:
        db.get(TranscriptSegment, segment).text = "O conteúdo foi corrigido."
    assert client.get("/api/tasks", params={"project": project}).json()["items"][0]["stale"]
    assert client.post("/api/tasks/import", json={"document_id": doc}).status_code == 409


def test_notebook_binds_notes_to_the_right_recording_and_detects_source_edits(client):
    project = f"Notas-{uuid.uuid4().hex}"
    job, segment = seed(project)
    other, foreign = seed()
    payload = {"segment_id": segment, "title": "Revisar alertas", "body": "Verificar na próxima reunião", "kind": "chapter"}
    assert client.post(f"/api/jobs/{job}/notes", json={**payload, "segment_id": foreign}).status_code == 422
    response = client.post(f"/api/jobs/{job}/notes", json=payload)
    assert response.status_code == 201
    note = response.json()
    assert note["sources"][0]["start"] == 12 and note["kind"] == "chapter"
    page = client.get("/api/notebook", params={"project": project, "q": "alertas"}).json()
    assert page["total"] == 1 and page["items"][0]["id"] == note["id"]
    assert client.get("/api/notebook", params={"job_id": other}).json()["items"] == []
    assert client.patch(f"/api/notebook/{note['id']}", json={"body": "Comentário revisado", "revision": 1}).status_code == 200
    assert client.patch(f"/api/notebook/{note['id']}", json={"body": "Versão antiga", "revision": 1}).status_code == 409
    with session_scope() as db:
        db.get(TranscriptSegment, segment).text = "Texto editado"
    assert client.get("/api/notebook", params={"project": project}).json()["items"][0]["stale"]
