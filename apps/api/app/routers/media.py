import json

from fastapi import APIRouter, Depends, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import Response

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.errors import NotFoundError
from audiowhisper_core.models import MediaFile
from audiowhisper_core.schemas import MediaFileOut

from app.dependencies import get_db
from app.range_response import range_file_response
from app.services import media_service

router = APIRouter(prefix="/api/media", tags=["media"])


def _to_out(media: MediaFile, is_duplicate: bool = False, duplicate_job_ids: list[str] | None = None) -> MediaFileOut:
    # Built field-by-field rather than via model_validate(media, from_attributes=True):
    # SQLAlchemy's DeclarativeBase reserves `.metadata` for its MetaData registry, which would
    # shadow our `metadata` output field if pydantic read attributes automatically.
    return MediaFileOut(
        id=media.id,
        original_name=media.original_name,
        mime_type=media.mime_type,
        extension=media.extension,
        size_bytes=media.size_bytes,
        sha256=media.sha256,
        duration_seconds=media.duration_seconds,
        media_type=media.media_type,
        metadata=json.loads(media.metadata_json) if media.metadata_json else None,
        created_at=media.created_at,
        is_duplicate=is_duplicate,
        duplicate_of_job_ids=duplicate_job_ids or [],
    )


@router.post("/upload", response_model=MediaFileOut)
async def upload_media(
    file: UploadFile,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> MediaFileOut:
    media, is_duplicate, duplicate_job_ids = await media_service.store_upload(db, settings, file)
    return _to_out(media, is_duplicate, duplicate_job_ids)


@router.get("", response_model=list[MediaFileOut])
def list_media(db: Session = Depends(get_db)) -> list[MediaFileOut]:
    rows = db.execute(select(MediaFile).order_by(MediaFile.created_at.desc())).scalars().all()
    return [_to_out(m) for m in rows]


@router.get("/{media_id}", response_model=MediaFileOut)
def get_media(media_id: str, db: Session = Depends(get_db)) -> MediaFileOut:
    media = db.get(MediaFile, media_id)
    if media is None:
        raise NotFoundError(f"Arquivo de mídia '{media_id}' não encontrado")
    return _to_out(media)


@router.get("/{media_id}/stream")
def stream_media(
    media_id: str,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    media = db.get(MediaFile, media_id)
    if media is None:
        raise NotFoundError(f"Arquivo de mídia '{media_id}' não encontrado")

    path = media_service.media_file_path(settings, media)
    if not path.exists():
        raise NotFoundError("Arquivo de mídia não encontrado em disco")

    return range_file_response(request, path, media.mime_type)


@router.delete("/{media_id}", status_code=204)
def delete_media(
    media_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    media = db.get(MediaFile, media_id)
    if media is None:
        raise NotFoundError(f"Arquivo de mídia '{media_id}' não encontrado")
    media_service.delete_media_file(db, settings, media)
