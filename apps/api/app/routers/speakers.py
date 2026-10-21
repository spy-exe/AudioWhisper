from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from audiowhisper_core.models import WorkspaceItem
from audiowhisper_core.config import get_settings
from pathlib import Path
from app.dependencies import get_db
from app.queue import get_queue
from app.services.job_service import get_job_or_404

router = APIRouter(tags=["speakers"])


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
