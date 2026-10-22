"""Persist literal snapshots and expose source changes without rewriting history."""
import hashlib
import json

from sqlalchemy import select
from audiowhisper_core.models import MediaFile, TranscriptSegment, TranscriptionJob, WorkspaceItem


def fingerprint(segment, speaker_name=None):
    return hashlib.sha256(json.dumps([segment.text, segment.start, segment.end, segment.speaker_id, speaker_name], ensure_ascii=False).encode()).hexdigest()


def snapshots(db, segment_ids):
    if not segment_ids:
        return []
    rows = db.execute(select(TranscriptSegment, MediaFile.original_name, WorkspaceItem).join(
        TranscriptionJob, TranscriptionJob.id == TranscriptSegment.job_id).join(MediaFile).outerjoin(
            WorkspaceItem, WorkspaceItem.job_id == TranscriptionJob.id).where(TranscriptSegment.id.in_(segment_ids)))
    found = {}
    for segment, filename, workspace in rows:
        names = json.loads(workspace.speakers_json) if workspace else {}
        found[segment.id] = {"segment_id": segment.id, "job_id": segment.job_id, "title": (workspace.title if workspace else "") or filename,
                             "text": segment.text, "start": segment.start, "end": segment.end, "fingerprint": fingerprint(segment, names.get(segment.speaker_id)),
                             "speaker": names.get(segment.speaker_id) or segment.speaker_id or "Falante não identificado"}
    return [found[source] for source in dict.fromkeys(segment_ids) if source in found]


def source_map(db, records):
    ids = {source["segment_id"] for record in records for source in json.loads(record.sources_json)}
    if not ids:
        return {}
    rows = db.execute(select(TranscriptSegment, WorkspaceItem.speakers_json).outerjoin(
        WorkspaceItem, WorkspaceItem.job_id == TranscriptSegment.job_id).where(TranscriptSegment.id.in_(ids)))
    return {segment.id: fingerprint(segment, json.loads(names or "{}").get(segment.speaker_id)) for segment, names in rows}


def expose_sources(record, current):
    sources = [{**{k: v for k, v in source.items() if k != "fingerprint"},
                "stale": current.get(source["segment_id"]) != source["fingerprint"]} for source in json.loads(record.sources_json)]
    return {"sources": sources, "stale": any(source["stale"] for source in sources)}
