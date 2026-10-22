import csv
import io
import json
import re
import unicodedata
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import ExportFormat
from audiowhisper_core.models import ExportFile, MediaFile, TranscriptionJob, TranscriptSegment

PARAGRAPH_GAP_SECONDS = 2.5


def _srt_timestamp(seconds: float) -> str:
    ms = round(max(0.0, seconds) * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _vtt_timestamp(seconds: float) -> str:
    return _srt_timestamp(seconds).replace(",", ".")


def _clock(seconds: float) -> str:
    return _vtt_timestamp(seconds)[:8]


def _vtt_escape(text: str) -> str:
    # Cue text is parsed for tags and entities: a literal "<" or "&" would corrupt the cue.
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def speaker_label(segment: TranscriptSegment, speakers: dict | None) -> str | None:
    if not segment.speaker_id:
        return None
    return (speakers or {}).get(segment.speaker_id) or segment.speaker_id


def _group_paragraphs(segments: list[TranscriptSegment], by_speaker: bool = False) -> list[list[TranscriptSegment]]:
    paragraphs: list[list[TranscriptSegment]] = []
    current: list[TranscriptSegment] = []
    prev_end: float | None = None
    for seg in segments:
        gap = prev_end is not None and seg.start - prev_end > PARAGRAPH_GAP_SECONDS
        turn = by_speaker and current and seg.speaker_id != current[-1].speaker_id
        if current and (gap or turn):
            paragraphs.append(current)
            current = []
        current.append(seg)
        prev_end = seg.end
    if current:
        paragraphs.append(current)
    return paragraphs


def _with_speakers(segments, speakers, include_speakers) -> bool:
    return include_speakers and any(s.speaker_id for s in segments)


def _spoken(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    return [s for s in segments if s.text.strip()]


def render_txt(job: TranscriptionJob, segments: list[TranscriptSegment], speakers: dict | None = None,
               include_speakers: bool = True) -> str:
    segments = _spoken(segments)
    labelled = _with_speakers(segments, speakers, include_speakers)
    blocks = []
    for paragraph in _group_paragraphs(segments, by_speaker=labelled):
        text = " ".join(s.text.strip() for s in paragraph if s.text.strip())
        label = speaker_label(paragraph[0], speakers) if labelled else None
        blocks.append(f"{label}: {text}" if label else text)
    return "\n\n".join(blocks) + "\n"


def render_markdown(
    job: TranscriptionJob, media: MediaFile, segments: list[TranscriptSegment], include_timestamps: bool,
    speakers: dict | None = None, bookmarks: list | None = None, include_speakers: bool = True, title: str | None = None,
) -> str:
    lines = [f"# {title or media.original_name}", ""]
    lines.append("| Campo | Valor |")
    lines.append("|---|---|")
    lines.append(f"| Idioma | {job.language_detected or job.language_requested or 'desconhecido'} |")
    duration = media.duration_seconds or 0
    lines.append(f"| Duração | {int(duration // 60)}m{int(duration % 60):02d}s |")
    lines.append(f"| Modelo | {job.model_name} |")
    lines.append(f"| Gerado em | {job.completed_at.isoformat() if job.completed_at else ''} |")
    lines.append("")
    if bookmarks:
        lines.extend(["## Marcadores", ""])
        for bookmark in sorted(bookmarks, key=lambda b: b.start):
            note = f" · {bookmark.note.strip()}" if bookmark.note and bookmark.note.strip() else ""
            lines.append(f"- **[{_clock(bookmark.start)}]** {bookmark.label}{note}")
        lines.extend(["", "## Transcrição", ""])
    segments = _spoken(segments)
    labelled = _with_speakers(segments, speakers, include_speakers)
    for paragraph in _group_paragraphs(segments, by_speaker=labelled):
        text = " ".join(s.text.strip() for s in paragraph if s.text.strip())
        label = speaker_label(paragraph[0], speakers) if labelled else None
        prefix = []
        if include_timestamps:
            prefix.append(f"[{_clock(paragraph[0].start)}]")
        if label:
            prefix.append(f"{label}:")
        lines.append(f"**{' '.join(prefix)}** {text}" if prefix else text)
        lines.append("")
    return "\n".join(lines)


def render_json(job: TranscriptionJob, media: MediaFile, segments: list[TranscriptSegment],
                speakers: dict | None = None, bookmarks: list | None = None) -> str:
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
        "speakers": speakers or {},
        "segments": [
            {
                "index": s.segment_index,
                "start": s.start,
                "end": s.end,
                "text": s.text,
                "speaker_id": s.speaker_id,
                "speaker": speaker_label(s, speakers),
                "confidence": s.confidence,
                "words": json.loads(s.words_json) if s.words_json else None,
                "edited": s.edited,
            }
            for s in segments
        ],
        "bookmarks": [
            {"start": b.start, "label": b.label, "note": b.note, "color": b.color, "segment_id": b.segment_id}
            for b in sorted(bookmarks or [], key=lambda b: b.start)
        ],
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _cues(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    # An empty cue would end the subtitle block early and desynchronize every following one.
    return _spoken(segments)


def render_srt(segments: list[TranscriptSegment], speakers: dict | None = None, include_speakers: bool = True) -> str:
    labelled = _with_speakers(segments, speakers, include_speakers)
    lines = []
    for i, s in enumerate(_cues(segments), start=1):
        label = speaker_label(s, speakers) if labelled else None
        lines.append(str(i))
        lines.append(f"{_srt_timestamp(s.start)} --> {_srt_timestamp(max(s.end, s.start))}")
        lines.append(f"{label}: {s.text.strip()}" if label else s.text.strip())
        lines.append("")
    return "\n".join(lines)


def render_vtt(segments: list[TranscriptSegment], speakers: dict | None = None, include_speakers: bool = True) -> str:
    labelled = _with_speakers(segments, speakers, include_speakers)
    lines = ["WEBVTT", ""]
    for s in _cues(segments):
        label = speaker_label(s, speakers) if labelled else None
        text = _vtt_escape(s.text.strip())
        lines.append(f"{_vtt_timestamp(s.start)} --> {_vtt_timestamp(max(s.end, s.start))}")
        lines.append(f"<v {_vtt_escape(label)}>{text}" if label else text)
        lines.append("")
    return "\n".join(lines)


def render_csv(segments: list[TranscriptSegment], speakers: dict | None = None) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(["indice", "inicio", "fim", "inicio_hhmmss", "falante", "texto", "confianca", "editado"])
    for s in segments:
        text = s.text.strip()
        # Spreadsheet apps evaluate cells starting with these characters as formulas.
        if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
            text = "'" + text
        writer.writerow([
            s.segment_index, f"{s.start:.3f}", f"{s.end:.3f}", _clock(s.start), speaker_label(s, speakers) or "",
            text, "" if s.confidence is None else f"{s.confidence:.3f}", "sim" if s.edited else "não",
        ])
    # BOM so spreadsheet apps detect UTF-8 accents correctly.
    return "﻿" + buffer.getvalue()


_EXTENSIONS = {
    ExportFormat.PDF: "pdf",
    ExportFormat.DOCX: "docx",
    ExportFormat.TXT: "txt",
    ExportFormat.MARKDOWN: "md",
    ExportFormat.JSON: "json",
    ExportFormat.SRT: "srt",
    ExportFormat.VTT: "vtt",
    ExportFormat.CSV: "csv",
}


def extension_for(fmt: ExportFormat | str) -> str:
    return _EXTENSIONS[ExportFormat(fmt)]


def safe_filename_stem(title: str | None, fallback: str = "transcricao") -> str:
    """A readable, filesystem-safe stem: accents and punctuation removed, never a path."""
    stem = re.sub(r"\.[A-Za-z0-9]{1,5}$", "", title or "")
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "", stem).strip(" .-_")
    stem = re.sub(r"\s+", " ", stem)[:80].strip()
    return stem or fallback


def render_export(
    fmt: ExportFormat, job: TranscriptionJob, media: MediaFile, segments: list[TranscriptSegment],
    include_timestamps: bool = True, *, speakers: dict | None = None, bookmarks: list | None = None,
    include_speakers: bool = True, title: str | None = None,
) -> str | bytes:
    fmt = ExportFormat(fmt)
    speakers = speakers if include_speakers else {}
    if fmt in (ExportFormat.PDF, ExportFormat.DOCX):
        from audiowhisper_core.document_exports import export_document
        markdown = render_markdown(job, media, segments, include_timestamps, speakers, bookmarks, include_speakers, title)
        return export_document(fmt.value, title or media.original_name, markdown)
    if fmt == ExportFormat.TXT:
        return render_txt(job, segments, speakers, include_speakers)
    if fmt == ExportFormat.MARKDOWN:
        return render_markdown(job, media, segments, include_timestamps, speakers, bookmarks, include_speakers, title)
    if fmt == ExportFormat.JSON:
        return render_json(job, media, segments, speakers, bookmarks)
    if fmt == ExportFormat.SRT:
        return render_srt(segments, speakers, include_speakers)
    if fmt == ExportFormat.VTT:
        return render_vtt(segments, speakers, include_speakers)
    return render_csv(segments, speakers)


def generate_export(
    db: Session,
    settings: Settings,
    job: TranscriptionJob,
    media: MediaFile,
    segments: list[TranscriptSegment],
    fmt: ExportFormat,
    include_timestamps: bool = True,
    **options,
) -> ExportFile:
    content = render_export(fmt, job, media, segments, include_timestamps, **options)
    job_dir = settings.exports_dir / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    export_id = str(uuid.uuid4())
    filename = f"{export_id}.{extension_for(fmt)}"
    path = job_dir / filename
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8", newline="\n")

    export_file = ExportFile(
        id=export_id,
        job_id=job.id,
        format=ExportFormat(fmt),
        path=str(Path(job.id) / filename),
        size_bytes=path.stat().st_size,
    )
    db.add(export_file)
    db.commit()
    db.refresh(export_file)
    return export_file
