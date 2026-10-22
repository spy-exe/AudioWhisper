from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from audiowhisper_core.evidence import source_map
from audiowhisper_core.models import AIDocument, ActionTask, KnowledgeQuestion, MediaFile, NotebookEntry, RecipeRun, TranscriptionJob, WorkspaceItem
from app.dependencies import get_db
from app.routers.actions import task_out
from app.routers.library import library
from app.routers.projects import project_rows

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


@router.get("")
def overview(today: date | None = None, project: str = Query(default="", max_length=128), db: Session = Depends(get_db)):
    today = today or date.today()
    recordings = select(func.count(TranscriptionJob.id), func.coalesce(func.sum(MediaFile.duration_seconds), 0)).join(
        MediaFile).outerjoin(WorkspaceItem)
    if project:
        recordings = recordings.where(WorkspaceItem.project == project)
    recording_count, duration = db.execute(recordings).one()
    conditions = [ActionTask.archived.is_(False)]
    if project:
        conditions.append(ActionTask.project == project)
    counts = dict(db.execute(select(ActionTask.status, func.count()).where(*conditions).group_by(ActionTask.status)).all())
    due_conditions = [*conditions, ActionTask.status != "done", ActionTask.due_date.is_not(None)]
    overdue = db.scalar(select(func.count()).select_from(ActionTask).where(*due_conditions, ActionTask.due_date < today.isoformat()))
    tasks = list(db.scalars(select(ActionTask).where(*due_conditions).order_by(ActionTask.due_date, ActionTask.created_at).limit(6)))
    notes = select(func.count(NotebookEntry.id)).outerjoin(WorkspaceItem, WorkspaceItem.job_id == NotebookEntry.job_id).where(NotebookEntry.archived.is_(False))
    drafts = select(func.count(AIDocument.id)).outerjoin(WorkspaceItem, WorkspaceItem.job_id == AIDocument.job_id).where(AIDocument.status == "generated")
    runs = select(func.count(RecipeRun.id)).outerjoin(WorkspaceItem, WorkspaceItem.job_id == RecipeRun.job_id).where(RecipeRun.status.in_(["queued", "running"]))
    questions = select(func.count(KnowledgeQuestion.id)).where(KnowledgeQuestion.status.in_(["queued", "generating"]))
    if project:
        notes, drafts, runs = [query.where(WorkspaceItem.project == project) for query in (notes, drafts, runs)]
        questions = questions.where(KnowledgeQuestion.project == project)
    current = source_map(db, tasks)
    return {"recording_count": recording_count, "duration_seconds": duration,
            "project_count": project_rows(db, name=project if project else None, limit=1)["total"],
            "task_counts": {status: counts.get(status, 0) for status in ("open", "doing", "done")}, "overdue_count": overdue,
            "due_tasks": [task_out(task, current) for task in tasks],
            "note_count": db.scalar(notes), "draft_count": db.scalar(drafts), "pending_questions": db.scalar(questions), "pending_runs": db.scalar(runs),
            "recent": library(q="", status="all", folder="", project=project, tag="", offset=0, limit=6, db=db)}
