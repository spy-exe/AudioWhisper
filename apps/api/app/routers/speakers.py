import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from audiowhisper_core.config import get_settings
from audiowhisper_core.errors import NotFoundError, ValidationAppError
from audiowhisper_core.models import TranscriptSegment, WorkspaceItem
from app.dependencies import get_db
from app.queue import get_queue
from app.routers.jobs import _segment_to_out
from app.routers.library import workspace_out
from app.services.job_service import get_job_or_404
from app.services.workspace_service import get_or_create_item

router = APIRouter(tags=["speakers"])

MAX_SPEAKERS = 100


@router.post("/api/jobs/{job_id}/diarize", status_code=202)
def diarize(job_id: str, db: Session = Depends(get_db)):
    job = get_job_or_404(db, job_id)
    if job.status != "completed":
        raise HTTPException(409, "Conclua a transcrição antes de identificar falantes.")
    settings = get_settings()
    if not settings.hf_token and not Path(settings.diarization_model).is_dir():
        raise HTTPException(409, "Configure HF_TOKEN após aceitar o Community-1, ou informe um modelo local em DIARIZATION_MODEL.")
    item = db.get(WorkspaceItem, job_id)
    if not item:
        item = WorkspaceItem(job_id=job_id)
        db.add(item)
    if item.diarization_status in ("queued", "processing"):
        raise HTTPException(409, "A identificação de falantes já está em andamento.")
    item.diarization_status, item.diarization_error = "queued", None
    db.commit()
    try:
        get_queue().enqueue("app.diarization.diarize_job", job_id, job_id=f"diarize-{job_id}", job_timeout=7200)
    except Exception:
        item.diarization_status, item.diarization_error = "failed", "Fila indisponível. Tente novamente."
        db.commit()
        raise HTTPException(503, item.diarization_error)
    return {"status": "queued"}


class SpeakerIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)

    @field_validator("name")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Informe um nome")
        return value.strip()


def _names(item: WorkspaceItem) -> dict[str, str]:
    return json.loads(item.speakers_json or "{}")


@router.post("/api/jobs/{job_id}/speakers", status_code=201)
def add_speaker(job_id: str, payload: SpeakerIn, db: Session = Depends(get_db)):
    """Participants can be named by hand, without running automatic identification."""
    get_job_or_404(db, job_id)
    item = get_or_create_item(db, job_id)
    names = _names(item)
    if len(names) >= MAX_SPEAKERS:
        raise ValidationAppError(f"Limite de {MAX_SPEAKERS} participantes atingido.")
    if any(name.casefold() == payload.name.casefold() for name in names.values()):
        raise ValidationAppError("Já existe um participante com esse nome.")
    number = 1
    while f"manual-{number}" in names:
        number += 1
    speaker_id = f"manual-{number}"
    names[speaker_id] = payload.name
    item.speakers_json = json.dumps(names, ensure_ascii=False)
    db.commit()
    return {"speaker_id": speaker_id, **workspace_out(item)}


class MergeSpeakersIn(BaseModel):
    source: str = Field(min_length=1, max_length=64)
    target: str = Field(min_length=1, max_length=64)


@router.post("/api/jobs/{job_id}/speakers/merge")
def merge_speakers(job_id: str, payload: MergeSpeakersIn, db: Session = Depends(get_db)):
    """Diarization often splits one person in two: every segment of `source` moves to `target`."""
    get_job_or_404(db, job_id)
    if payload.source == payload.target:
        raise ValidationAppError("Escolha dois participantes diferentes.")
    item = get_or_create_item(db, job_id)
    names = _names(item)
    if payload.source not in names or payload.target not in names:
        raise NotFoundError("Participante não encontrado nesta gravação.")
    moved = db.execute(update(TranscriptSegment).where(TranscriptSegment.job_id == job_id,
                       TranscriptSegment.speaker_id == payload.source).values(speaker_id=payload.target)).rowcount
    names.pop(payload.source)
    item.speakers_json = json.dumps(names, ensure_ascii=False)
    db.commit()
    return {"moved_segments": moved, **workspace_out(item)}


@router.delete("/api/jobs/{job_id}/speakers/{speaker_id}")
def remove_speaker(job_id: str, speaker_id: str, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    item = get_or_create_item(db, job_id)
    names = _names(item)
    if speaker_id not in names:
        raise NotFoundError("Participante não encontrado nesta gravação.")
    cleared = db.execute(update(TranscriptSegment).where(TranscriptSegment.job_id == job_id,
                         TranscriptSegment.speaker_id == speaker_id).values(speaker_id=None)).rowcount
    names.pop(speaker_id)
    item.speakers_json = json.dumps(names, ensure_ascii=False)
    db.commit()
    return {"cleared_segments": cleared, **workspace_out(item)}


class AssignSpeakerIn(BaseModel):
    segment_ids: list[str] = Field(min_length=1, max_length=2000)
    speaker_id: str | None = Field(default=None, max_length=64)


@router.put("/api/jobs/{job_id}/segments/speaker")
def assign_speaker(job_id: str, payload: AssignSpeakerIn, db: Session = Depends(get_db)):
    get_job_or_404(db, job_id)
    if payload.speaker_id is not None:
        item = db.get(WorkspaceItem, job_id)
        if not item or payload.speaker_id not in _names(item):
            raise NotFoundError("Participante não encontrado nesta gravação.")
    ids = list(dict.fromkeys(payload.segment_ids))
    segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id,
                                                               TranscriptSegment.id.in_(ids))))
    if len(segments) != len(ids):
        raise NotFoundError("Um dos segmentos não pertence a esta transcrição.")
    for segment in segments:
        segment.speaker_id = payload.speaker_id
    db.commit()
    return [_segment_to_out(s) for s in sorted(segments, key=lambda s: s.segment_index)]
