import io
import zipfile

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.enums import ExportFormat
from audiowhisper_core.errors import ConflictError, NotFoundError
from audiowhisper_core.models import ExportFile, MediaFile, TranscriptionJob
from audiowhisper_core.schemas import ExportFileOut, ExportRequestIn

from app.dependencies import get_db
from app.filenames import content_disposition
from app.services import job_service
from app.services.export_service import extension_for, generate_export, render_export, safe_filename_stem
from app.services.workspace_service import bookmarks_for, ordered_segments, speakers_for, title_for

router = APIRouter(tags=["exports"])

_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
    "markdown": "text/markdown; charset=utf-8",
    "json": "application/json",
    "srt": "application/x-subrip",
    "vtt": "text/vtt",
    "csv": "text/csv; charset=utf-8",
}


def _export_options(db: Session, job: TranscriptionJob, include_speakers: bool) -> dict:
    return {"speakers": speakers_for(db, job.id), "bookmarks": bookmarks_for(db, job.id),
            "include_speakers": include_speakers, "title": title_for(db, job)}


@router.post("/api/jobs/{job_id}/exports", response_model=list[ExportFileOut])
def create_exports(
    job_id: str,
    payload: ExportRequestIn,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[ExportFileOut]:
    job = job_service.get_job_or_404(db, job_id)
    media = db.get(MediaFile, job.media_file_id)
    segments = ordered_segments(db, job_id)
    options = _export_options(db, job, payload.include_speakers)

    results = []
    for fmt in dict.fromkeys(payload.formats):
        export_file = generate_export(db, settings, job, media, segments, fmt, payload.include_timestamps, **options)
        results.append(ExportFileOut.model_validate(export_file))
    return results


@router.get("/api/jobs/{job_id}/exports", response_model=list[ExportFileOut])
def list_exports(job_id: str, db: Session = Depends(get_db)) -> list[ExportFileOut]:
    job_service.get_job_or_404(db, job_id)
    stmt = select(ExportFile).where(ExportFile.job_id == job_id).order_by(ExportFile.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [ExportFileOut.model_validate(r) for r in rows]


@router.get("/api/jobs/{job_id}/exports/bundle")
def export_bundle(
    job_id: str,
    formats: list[ExportFormat] = Query(default=list(ExportFormat)),
    include_timestamps: bool = True,
    include_speakers: bool = True,
    db: Session = Depends(get_db),
) -> Response:
    """Every requested format in one ZIP, rendered on the fly (nothing is left in the exports dir)."""
    job = job_service.get_job_or_404(db, job_id)
    segments = ordered_segments(db, job_id)
    if not segments:
        raise ConflictError("A transcrição ainda não tem texto para exportar.")
    media = db.get(MediaFile, job.media_file_id)
    options = _export_options(db, job, include_speakers)
    stem = safe_filename_stem(options["title"])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for fmt in dict.fromkeys(formats):
            content = render_export(fmt, job, media, segments, include_timestamps, **options)
            archive.writestr(f"{stem}.{extension_for(fmt)}", content)
    return Response(buffer.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": content_disposition(f"{stem}.zip"), "Cache-Control": "no-store"})


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

    format_value = ExportFormat(export_file.format).value
    job = db.get(TranscriptionJob, export_file.job_id)
    filename = f"{safe_filename_stem(title_for(db, job) if job else None)}.{extension_for(format_value)}"
    media_type = _MEDIA_TYPES.get(format_value, "application/octet-stream")
    return FileResponse(path, media_type=media_type, headers={"Content-Disposition": content_disposition(filename)})
