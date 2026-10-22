import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from audiowhisper_core.models import MediaFile, Project, TranscriptionJob, WorkspaceItem
from app.dependencies import get_db
from app.routers.library import library

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectDetails(BaseModel):
    description: str = Field(default="", max_length=4000)
    color: Literal["blue", "amber", "violet", "green"] = "blue"


class ProjectIn(ProjectDetails):
    name: str = Field(min_length=1, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 for c in value):
            raise ValueError("Informe um nome de projeto sem caracteres de controle.")
        return value


def project_rows(db, name=None, q="", offset=0, limit=24):
    names = union(select(Project.name.label("name")), select(WorkspaceItem.project.label("name")).where(WorkspaceItem.project != "")).subquery()
    stats = select(WorkspaceItem.project.label("name"), func.count(TranscriptionJob.id).label("recording_count"),
                   func.coalesce(func.sum(MediaFile.duration_seconds), 0).label("duration_seconds"),
                   func.max(TranscriptionJob.updated_at).label("last_activity")).join(
                       TranscriptionJob, TranscriptionJob.id == WorkspaceItem.job_id).join(MediaFile).group_by(WorkspaceItem.project).subquery()
    conditions = [names.c.name == name] if name is not None else []
    if q.strip():
        conditions.append(names.c.name.icontains(q.strip(), autoescape=True))
    base = select(names.c.name, Project.description, Project.color, stats.c.recording_count,
                  stats.c.duration_seconds, stats.c.last_activity).outerjoin(Project, Project.name == names.c.name).outerjoin(stats, stats.c.name == names.c.name).where(*conditions)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.execute(base.order_by(names.c.name).offset(offset).limit(limit)).mappings()
    return {"items": [{**row, "description": row["description"] or "", "color": row["color"] or "blue",
                       "recording_count": row["recording_count"] or 0, "duration_seconds": row["duration_seconds"] or 0} for row in rows],
            "total": total, "offset": offset, "limit": limit}


def require_project(db, name):
    result = project_rows(db, name=name)
    if not result["items"]:
        raise HTTPException(404, "Projeto não encontrado.")
    return result["items"][0]


@router.get("")
def list_projects(q: str = Query(default="", max_length=200), offset: int = Query(default=0, ge=0),
                  limit: int = Query(default=24, ge=1, le=100), db: Session = Depends(get_db)):
    return project_rows(db, q=q, offset=offset, limit=limit)


@router.post("", status_code=201)
def create_project(payload: ProjectIn, db: Session = Depends(get_db)):
    if project_rows(db, name=payload.name)["items"]:
        raise HTTPException(409, "Já existe um projeto com esse nome.")
    db.add(Project(**payload.model_dump()))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Já existe um projeto com esse nome.")
    return require_project(db, payload.name)


@router.get("/{name:path}")
def project_detail(name: str, offset: int = Query(default=0, ge=0), db: Session = Depends(get_db)):
    detail = require_project(db, name)
    participants = set()
    for value in db.scalars(select(WorkspaceItem.speakers_json).where(WorkspaceItem.project == name)):
        participants.update(json.loads(value).values())
    recordings = library(q="", status="all", folder="", project=name, tag="", offset=offset, limit=12, db=db)
    return {**detail, "participants": sorted(participants), "recordings": recordings}


@router.put("/{name:path}")
def update_project(name: str, payload: ProjectDetails, db: Session = Depends(get_db)):
    require_project(db, name)
    project = db.get(Project, name)
    if not project:
        project = Project(name=name)
        db.add(project)
    project.description, project.color = payload.description.strip(), payload.color
    db.commit()
    return require_project(db, name)
