import uuid
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import AIDocument, DocumentRecipe, KnowledgeQuestion, RecipeRun


def test_queue_includes_questions_and_recipes_without_counting_documents_twice(client, make_completed_job):
    job = make_completed_job([("Verificar os backups", 0, 2)])
    before = client.get("/api/system/queue").json()
    with session_scope() as db:
        recipe = DocumentRecipe(name=str(uuid.uuid4()), kind="minutes", model="local")
        db.add(recipe)
        db.flush()
        db.add(KnowledgeQuestion(question="O que foi decidido?", model="local", status="queued"))
        db.add(RecipeRun(recipe_id=recipe.id, job_id=job["job_id"], payload_json="{}", status="queued"))
    after = client.get("/api/system/queue").json()
    assert after["pending_questions"] == before["pending_questions"] + 1
    assert after["pending_recipes"] == before["pending_recipes"] + 1
    with session_scope() as db:
        from sqlalchemy import select
        run = db.scalar(select(RecipeRun).where(RecipeRun.job_id == job["job_id"]))
        document = AIDocument(job_id=job["job_id"], kind="minutes", model="local", status="generating", source_hash="hash")
        db.add(document)
        db.flush()
        run.document_id = document.id
        run.status = "running"
    generating = client.get("/api/system/queue").json()
    assert generating["pending_recipes"] == before["pending_recipes"]
    assert generating["pending_documents"] == before["pending_documents"] + 1


def test_bulk_project_assignment_schedules_existing_automatic_recipes(client, make_completed_job, monkeypatch):
    import app.queue
    from unittest.mock import Mock
    queue = Mock()
    monkeypatch.setattr(app.queue, "get_queue", lambda: queue)
    project = str(uuid.uuid4())
    with session_scope() as db:
        db.add(DocumentRecipe(name="Ata", project=project, kind="minutes", model="local", automatic=True))
    job = make_completed_job([("Verificar os backups", 0, 2)])
    response = client.post("/api/library/bulk", json={"action": "organize", "job_ids": [job["job_id"]], "project": project})
    assert response.json()["done"] == [job["job_id"]]
    queue.enqueue.assert_called_once_with("app.workspace_tasks.schedule_recipes", job["job_id"], job_timeout=60)
