from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.errors import NotFoundError
from audiowhisper_core.models import ExportFile, MediaFile, TranscriptSegment
from audiowhisper_core.schemas import ExportFileOut, ExportRequestIn

from app.dependencies import get_db
from app.services import job_service
from app.services.export_service import generate_export

router = APIRouter(tags=["exports"])

_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
    "markdown": "text/markdown; charset=utf-8",
    "json": "application/json",
    "srt": "application/x-subrip",
    "vtt": "text/vtt",
}


@router.post("/api/jobs/{job_id}/exports", response_model=list[ExportFileOut])
def create_exports(
    job_id: str,
    payload: ExportRequestIn,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[ExportFileOut]:
    job = job_service.get_job_or_404(db, job_id)
    media = db.get(MediaFile, job.media_file_id)
    stmt = (
        select(TranscriptSegment)
        .where(TranscriptSegment.job_id == job_id)
        .order_by(TranscriptSegment.segment_index)
    )
    segments = list(db.execute(stmt).scalars().all())

    results = []
    for fmt in payload.formats:
        export_file = generate_export(
            db, settings, job, media, segments, fmt, payload.include_timestamps
        )
        results.append(ExportFileOut.model_validate(export_file))
    return results


@router.get("/api/jobs/{job_id}/exports", response_model=list[ExportFileOut])
def list_exports(job_id: str, db: Session = Depends(get_db)) -> list[ExportFileOut]:
    job_service.get_job_or_404(db, job_id)
    stmt = select(ExportFile).where(ExportFile.job_id == job_id).order_by(ExportFile.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [ExportFileOut.model_validate(r) for r in rows]


@router.get("/api/exports/{export_id}/download")
def download_export(
    export_id: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> FileResponse:
    export_file = db.get(ExportFile, export_id)
    if export_file is None:
        raise NotFoundError(f"Export '{export_id}' não encontrado")

    path = (settings.exports_dir / export_file.path).resolve()
    if settings.exports_dir.resolve() not in path.parents:
        raise NotFoundError("Caminho de export inválido")
    if not path.exists():
        raise NotFoundError("Arquivo de export não encontrado em disco")

    format_value = str(export_file.format)
    filename = f"transcript.{format_value}"
    media_type = _MEDIA_TYPES.get(format_value, "application/octet-stream")
    return FileResponse(path, media_type=media_type, filename=filename)
