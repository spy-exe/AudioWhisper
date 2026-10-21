import hashlib
import json
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import ErrorCode
from audiowhisper_core.errors import AppError, FileTooLargeError, UnsupportedFormatError
from audiowhisper_core.models import MediaFile, TranscriptionJob

from app.ffprobe import probe
from app.filenames import extract_extension, sanitize_display_name
from app.mime_sniff import sniff_mime

CHUNK_SIZE = 1024 * 1024  # 1 MiB — stream to disk, never buffer the whole file

ALLOWED_MIME_PREFIXES = ("audio/", "video/")
ALLOWED_MIME_EXACT = {"application/ogg", "application/mp4", "application/octet-stream"}


def _validate_extension(settings: Settings, extension: str) -> None:
    if not extension or extension not in settings.allowed_extensions:
        raise UnsupportedFormatError(
            f"Extensão '.{extension}' não é suportada",
            {"allowed": list(settings.allowed_extensions)},
        )


def _validate_sniffed_mime(file_path: Path) -> str:
    sniffed = sniff_mime(str(file_path))
    if not (sniffed.startswith(ALLOWED_MIME_PREFIXES) or sniffed in ALLOWED_MIME_EXACT):
        raise UnsupportedFormatError(
            "O conteúdo do arquivo não corresponde a um formato de áudio ou vídeo suportado",
            {"detected_mime": sniffed},
        )
    return sniffed


async def store_upload(
    db: Session, settings: Settings, upload: UploadFile
) -> tuple[MediaFile, bool, list[str]]:
    """Stream the upload to disk, hash it, probe it with ffprobe and persist a MediaFile row.

    Returns (media_file, is_duplicate, duplicate_job_ids).
    """
    display_name = sanitize_display_name(upload.filename or "arquivo")
    extension = extract_extension(display_name)
    _validate_extension(settings, extension)

    media_id = str(uuid.uuid4())
    stored_name = f"{media_id}.{extension}"
    dest_path = settings.uploads_dir / stored_name
    if dest_path.resolve().parent != settings.uploads_dir.resolve():
        # defence in depth: this can only happen if uploads_dir itself is misconfigured
        raise AppError(ErrorCode.INTERNAL_ERROR, "Caminho de armazenamento inválido")

    hasher = hashlib.sha256()
    size_bytes = 0
    try:
        with open(dest_path, "wb") as out:
            while chunk := await upload.read(CHUNK_SIZE):
                size_bytes += len(chunk)
                if size_bytes > settings.max_upload_bytes:
                    raise FileTooLargeError(
                        "Arquivo excede o limite máximo de upload",
                        {"max_bytes": settings.max_upload_bytes},
                    )
                hasher.update(chunk)
                out.write(chunk)
    except Exception:
        dest_path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    sniffed_mime = _validate_sniffed_mime(dest_path)

    try:
        ffprobe_result = probe(str(dest_path))
    except AppError:
        dest_path.unlink(missing_ok=True)
        raise

    sha256 = hasher.hexdigest()

    existing = db.execute(
        select(MediaFile).where(MediaFile.sha256 == sha256)
    ).scalars().first()

    is_duplicate = existing is not None
    duplicate_job_ids: list[str] = []
    if is_duplicate:
        dest_path.unlink(missing_ok=True)  # keep only one copy on disk per content hash
        jobs = db.execute(
            select(TranscriptionJob.id).where(TranscriptionJob.media_file_id == existing.id)
        ).scalars().all()
        duplicate_job_ids = list(jobs)
        return existing, True, duplicate_job_ids

    media_file = MediaFile(
        id=media_id,
        original_name=display_name,
        stored_name=stored_name,
        mime_type=sniffed_mime,
        extension=extension,
        size_bytes=size_bytes,
        sha256=sha256,
        duration_seconds=ffprobe_result.duration_seconds,
        media_type=ffprobe_result.media_type,
        metadata_json=json.dumps(ffprobe_result.to_metadata_dict()),
    )
    db.add(media_file)
    db.commit()
    db.refresh(media_file)
    return media_file, False, []


def media_file_path(settings: Settings, media_file: MediaFile) -> Path:
    return settings.uploads_dir / media_file.stored_name


def delete_media_file(db: Session, settings: Settings, media_file: MediaFile) -> None:
    path = media_file_path(settings, media_file)
    path.unlink(missing_ok=True)
    db.delete(media_file)
    db.commit()
