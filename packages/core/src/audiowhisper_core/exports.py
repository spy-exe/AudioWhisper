import json
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import ExportFormat
from audiowhisper_core.models import ExportFile, MediaFile, TranscriptionJob, TranscriptSegment

PARAGRAPH_GAP_SECONDS = 2.5


def _srt_timestamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _vtt_timestamp(seconds: float) -> str:
    return _srt_timestamp(seconds).replace(",", ".")


def _group_paragraphs(segments: list[TranscriptSegment]) -> list[list[TranscriptSegment]]:
    paragraphs: list[list[TranscriptSegment]] = []
    current: list[TranscriptSegment] = []
    prev_end: float | None = None
    for seg in segments:
        if current and prev_end is not None and seg.start - prev_end > PARAGRAPH_GAP_SECONDS:
            paragraphs.append(current)
            current = []
        current.append(seg)
        prev_end = seg.end
    if current:
        paragraphs.append(current)
    return paragraphs


def render_txt(job: TranscriptionJob, segments: list[TranscriptSegment]) -> str:
    paragraphs = _group_paragraphs(segments)
    return "\n\n".join(" ".join(s.text.strip() for s in p) for p in paragraphs) + "\n"


def render_markdown(
    job: TranscriptionJob, media: MediaFile, segments: list[TranscriptSegment], include_timestamps: bool
) -> str:
    lines = [f"# {media.original_name}", ""]
    lines.append("| Campo | Valor |")
    lines.append("|---|---|")
    lines.append(f"| Idioma | {job.language_detected or job.language_requested or 'desconhecido'} |")
    duration = media.duration_seconds or 0
    lines.append(f"| Duração | {int(duration // 60)}m{int(duration % 60):02d}s |")
    lines.append(f"| Modelo | {job.model_name} |")
    lines.append(f"| Gerado em | {job.completed_at.isoformat() if job.completed_at else ''} |")
    lines.append("")
    for paragraph in _group_paragraphs(segments):
        text = " ".join(s.text.strip() for s in paragraph)
        if include_timestamps:
            lines.append(f"**[{_vtt_timestamp(paragraph[0].start)[:8]}]** {text}")
        else:
            lines.append(text)
        lines.append("")
    return "\n".join(lines)


def render_json(job: TranscriptionJob, media: MediaFile, segments: list[TranscriptSegment]) -> str:
    payload = {
        "media": {
            "id": media.id,
            "original_name": media.original_name,
            "duration_seconds": media.duration_seconds,
        },
        "job": {
            "id": job.id,
            "model_name": job.model_name,
            "language_detected": job.language_detected,
            "real_time_factor": job.real_time_factor,
        },
        "segments": [
            {
                "index": s.segment_index,
                "start": s.start,
                "end": s.end,
                "text": s.text,
                "confidence": s.confidence,
                "words": json.loads(s.words_json) if s.words_json else None,
                "edited": s.edited,
            }
            for s in segments
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def render_srt(segments: list[TranscriptSegment]) -> str:
    lines = []
    for i, s in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_srt_timestamp(s.start)} --> {_srt_timestamp(s.end)}")
        lines.append(s.text.strip())
        lines.append("")
    return "\n".join(lines)


def render_vtt(segments: list[TranscriptSegment]) -> str:
    lines = ["WEBVTT", ""]
    for s in segments:
        lines.append(f"{_vtt_timestamp(s.start)} --> {_vtt_timestamp(s.end)}")
        lines.append(s.text.strip())
        lines.append("")
    return "\n".join(lines)


_RENDERERS = {
    ExportFormat.TXT: lambda job, media, segs, inc: render_txt(job, segs),
    ExportFormat.MARKDOWN: lambda job, media, segs, inc: render_markdown(job, media, segs, inc),
    ExportFormat.JSON: lambda job, media, segs, inc: render_json(job, media, segs),
    ExportFormat.SRT: lambda job, media, segs, inc: render_srt(segs),
    ExportFormat.VTT: lambda job, media, segs, inc: render_vtt(segs),
}

_EXTENSIONS = {
    ExportFormat.PDF: "pdf",
    ExportFormat.DOCX: "docx",
    ExportFormat.TXT: "txt",
    ExportFormat.MARKDOWN: "md",
    ExportFormat.JSON: "json",
    ExportFormat.SRT: "srt",
    ExportFormat.VTT: "vtt",
}


def generate_export(
    db: Session,
    settings: Settings,
    job: TranscriptionJob,
    media: MediaFile,
    segments: list[TranscriptSegment],
    fmt: ExportFormat,
    include_timestamps: bool = True,
) -> ExportFile:
    if fmt in (ExportFormat.PDF, ExportFormat.DOCX):
        from audiowhisper_core.document_exports import export_document
        content = export_document(fmt.value, media.original_name, render_markdown(job, media, segments, include_timestamps))
    else:
        content = _RENDERERS[fmt](job, media, segments, include_timestamps)
    job_dir = settings.exports_dir / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    export_id = str(uuid.uuid4())
    filename = f"{export_id}.{_EXTENSIONS[fmt]}"
    path = job_dir / filename
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8")

    export_file = ExportFile(
        id=export_id,
        job_id=job.id,
        format=fmt,
        path=str(Path(job.id) / filename),
        size_bytes=path.stat().st_size,
    )
    db.add(export_file)
    db.commit()
    db.refresh(export_file)
    return export_file
