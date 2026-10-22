import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from audiowhisper_core.evidence import expose_sources, source_map
from audiowhisper_core.models import KnowledgeQuestion, TranscriptionJob, WorkspaceItem
from app.dependencies import get_db
from app.queue import get_queue
from app.routers.projects import require_project

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


class QuestionIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    project: str = Field(default="", max_length=128)
    job_ids: list[str] = Field(default_factory=list, max_length=20)
    model: str = Field(min_length=1, max_length=128)

    @field_validator("question", "model")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Preencha este campo.")
        return value.strip()


def question_out(question, current):
    return {**{key: getattr(question, key) for key in ("id", "question", "project", "model", "status", "retrieval_count", "error", "created_at", "updated_at")},
            "job_ids": json.loads(question.job_ids_json), "items": json.loads(question.items_json), **expose_sources(question, current)}


def enqueue_question(db, question):
    db.commit()
    try:
        get_queue().enqueue("app.workspace_tasks.run_question", question.id, job_id=f"question-{question.id}", job_timeout=7200)
    except Exception:
        question.status, question.error = "failed", "A fila está indisponível. Tente novamente."
        db.commit()
        raise HTTPException(503, question.error)
    return question_out(question, source_map(db, [question]))


@router.post("", status_code=202)
def ask(payload: QuestionIn, db: Session = Depends(get_db)):
    if payload.project:
        require_project(db, payload.project)
    for job_id in set(payload.job_ids):
        job = db.get(TranscriptionJob, job_id)
        workspace = db.get(WorkspaceItem, job_id)
        if not job or job.status != "completed" or (payload.project and (not workspace or workspace.project != payload.project)):
            raise HTTPException(422, "Selecione apenas gravações concluídas do projeto escolhido.")
    pending = db.scalar(select(func.count()).select_from(KnowledgeQuestion).where(KnowledgeQuestion.status.in_(["queued", "generating"])))
    if pending >= 5:
        raise HTTPException(409, "Aguarde as perguntas em processamento antes de adicionar outras.")
    question = KnowledgeQuestion(question=payload.question, project=payload.project, model=payload.model,
                                 job_ids_json=json.dumps(list(dict.fromkeys(payload.job_ids))))
    db.add(question)
    return enqueue_question(db, question)


@router.get("")
def history(project: str = Query(default="", max_length=128), offset: int = Query(default=0, ge=0),
            limit: int = Query(default=10, ge=1, le=50), db: Session = Depends(get_db)):
    base = select(KnowledgeQuestion)
    if project:
        base = base.where(KnowledgeQuestion.project == project)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = list(db.scalars(base.order_by(KnowledgeQuestion.created_at.desc(), KnowledgeQuestion.id).offset(offset).limit(limit)))
    current = source_map(db, items)
    return {"items": [question_out(item, current) for item in items], "total": total, "offset": offset, "limit": limit}


@router.post("/{question_id}/retry", status_code=202)
def retry(question_id: str, db: Session = Depends(get_db)):
    question = db.get(KnowledgeQuestion, question_id)
    if not question:
        raise HTTPException(404, "Pergunta não encontrada.")
    if question.status != "failed":
        raise HTTPException(409, "Somente perguntas com falha podem ser repetidas.")
    question.status, question.error = "queued", None
    return enqueue_question(db, question)
