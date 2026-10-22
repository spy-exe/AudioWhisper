import json
import uuid
from types import SimpleNamespace
from unittest.mock import Mock

from sqlalchemy import select
from audiowhisper_core.db import session_scope
from audiowhisper_core.intelligence import EvidenceOutput
from audiowhisper_core.models import AIDocument, DocumentRecipe, KnowledgeQuestion, RecipeRun, TranscriptSegment, WorkspaceItem
from audiowhisper_core.workspace import ensure_recipe_run
from app.workspace_tasks import run_question, run_recipe, schedule_recipes


def source(make_media_and_job, project, text="Ana vai revisar os alertas de backup amanhã."):
    _, job = make_media_and_job(status="completed")
    with session_scope() as db:
        db.add(WorkspaceItem(job_id=job.id, project=project, speakers_json=json.dumps({"s1": "Ana"})))
        segment = TranscriptSegment(job_id=job.id, segment_index=0, start=2, end=5, text=text, speaker_id="s1")
        db.add(segment)
        db.flush()
        return job.id, segment.id


def ask(project, question="O que sabemos sobre backup?"):
    with session_scope() as db:
        question = KnowledgeQuestion(question=question, project=project, model="local")
        db.add(question)
        db.flush()
        return question.id


def test_question_retrieves_multiple_meetings_and_persists_literal_evidence(make_media_and_job, monkeypatch):
    project = uuid.uuid4().hex
    _, first = source(make_media_and_job, project)
    _, second = source(make_media_and_job, project, "Os alertas de backup foram revisados.")
    _, outside = source(make_media_and_job, "outro")
    question_id = ask(project)
    def generate(model, kind, instruction, segments, speakers):
        assert {s.id for s in segments} == {first, second}
        assert outside not in {s.id for s in segments}
        return EvidenceOutput.model_validate({"items": [{"kind": "summary", "text": "Revisão dos alertas de backup", "source_segment_ids": [s.id for s in segments], "evidence_quotes": [s.text for s in segments]}]})
    monkeypatch.setattr("app.workspace_tasks.OllamaProvider", lambda *args: SimpleNamespace(generate=generate))
    run_question(question_id)
    with session_scope() as db:
        question = db.get(KnowledgeQuestion, question_id)
        assert question.status == "completed"
        assert question.retrieval_count == 2
        assert {s["segment_id"] for s in json.loads(question.sources_json)} == {first, second}


def test_question_with_no_matching_evidence_does_not_call_llm(make_media_and_job, monkeypatch):
    project = uuid.uuid4().hex
    source(make_media_and_job, project)
    question = ask(project, "Qual a proposta sobre ornitorrincos?")
    provider = Mock(side_effect=AssertionError("No evidence, no inference"))
    monkeypatch.setattr("app.workspace_tasks.OllamaProvider", provider)
    run_question(question)
    with session_scope() as db:
        item = db.get(KnowledgeQuestion, question)
        assert item.status == "completed" and json.loads(item.items_json) == []
    provider.assert_not_called()


def test_question_rejects_source_changes_during_inference(make_media_and_job, monkeypatch):
    project = uuid.uuid4().hex
    _, segment_id = source(make_media_and_job, project)
    question = ask(project)
    def generate(*args):
        segments = args[3]
        with session_scope() as db:
            db.get(TranscriptSegment, segment_id).text = "Texto corrigido"
        return EvidenceOutput.model_validate({"items": [{"kind": "summary", "text": "Backup", "source_segment_ids": [segment_id], "evidence_quotes": [segments[0].text]}]})
    monkeypatch.setattr("app.workspace_tasks.OllamaProvider", lambda *a: SimpleNamespace(generate=generate))
    run_question(question)
    with session_scope() as db:
        assert db.get(KnowledgeQuestion, question).status == "failed"


def test_recipe_run_is_idempotent_and_keeps_a_draft(make_media_and_job, monkeypatch):
    project = uuid.uuid4().hex
    job, _ = source(make_media_and_job, project)
    with session_scope() as db:
        recipe = DocumentRecipe(name="Ata técnica", project=project, kind="minutes", model="local")
        db.add(recipe)
        db.flush()
        run, created = ensure_recipe_run(db, recipe, job)
        assert created
        assert ensure_recipe_run(db, recipe, job)[0].id == run.id
        run_id = run.id
    calls = []
    def generate(document_id):
        calls.append(document_id)
        with session_scope() as db:
            db.get(AIDocument, document_id).status = "generated"
    monkeypatch.setattr("app.ai_tasks.run_document", generate)
    run_recipe(run_id)
    run_recipe(run_id)
    with session_scope() as db:
        run = db.get(RecipeRun, run_id)
        assert run.status == "completed" and len(calls) == 1
        assert db.get(AIDocument, run.document_id).reviewed_at is None


def test_automatic_recipe_only_schedules_once_after_completion(make_media_and_job):
    from datetime import datetime, timedelta, timezone
    project = uuid.uuid4().hex
    job, _ = source(make_media_and_job, project)
    from audiowhisper_core.models import TranscriptionJob
    with session_scope() as db:
        db.get(TranscriptionJob, job).completed_at = datetime.now(timezone.utc)
        db.add(DocumentRecipe(name="Rotina", project=project, kind="summary", model="local", automatic=True,
                              created_at=datetime.now(timezone.utc) - timedelta(days=1)))
    queue = SimpleNamespace(enqueue=Mock())
    schedule_recipes(job, queue)
    schedule_recipes(job, queue)
    assert queue.enqueue.call_count == 1
    with session_scope() as db:
        assert db.scalar(select(RecipeRun).where(RecipeRun.job_id == job)).status == "queued"


def test_restart_recovers_questions_and_recipe_runs_without_duplicate_queue_entries(make_media_and_job):
    from app.recovery import recover_pending
    project = uuid.uuid4().hex
    job, _ = source(make_media_and_job, project)
    question_id = ask(project)
    with session_scope() as db:
        db.get(KnowledgeQuestion, question_id).status = "generating"
        recipe = DocumentRecipe(name="Ata", project=project, kind="minutes", model="local")
        db.add(recipe)
        db.flush()
        run, _ = ensure_recipe_run(db, recipe, job)
        run.status = "running"
        run_id = run.id
    queue = SimpleNamespace(get_job_ids=lambda: [], enqueue=Mock())
    recover_pending(queue)
    calls = [call.args for call in queue.enqueue.call_args_list]
    assert ("app.workspace_tasks.run_question", question_id) in calls
    assert ("app.workspace_tasks.run_recipe", run_id) in calls
    queue = SimpleNamespace(get_job_ids=lambda: [f"question-{question_id}", f"recipe-{run_id}"], enqueue=Mock())
    recover_pending(queue)
    calls = [call.args for call in queue.enqueue.call_args_list]
    assert ("app.workspace_tasks.run_question", question_id) not in calls
    assert ("app.workspace_tasks.run_recipe", run_id) not in calls
