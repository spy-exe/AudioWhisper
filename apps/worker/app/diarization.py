import gc
import json
from pathlib import Path
from sqlalchemy import select
from audiowhisper_core.config import get_settings
from audiowhisper_core.db import session_scope
from audiowhisper_core.models import MediaFile, TranscriptionJob, TranscriptSegment, WorkspaceItem
from app.pipeline.audio_extract import extract_mono_wav


def best_speaker(start, end, turns):
    overlaps = {}
    for turn_start, turn_end, speaker in turns:
        overlap = max(0, min(end, turn_end) - max(start, turn_start))
        overlaps[speaker] = overlaps.get(speaker, 0) + overlap
    return max(overlaps, key=overlaps.get) if overlaps and max(overlaps.values()) > 0 else None


def diarize_job(job_id):
    settings = get_settings()
    path = settings.tmp_dir / f"diarize-{job_id}.wav"
    with session_scope() as db:
        item = db.get(WorkspaceItem, job_id)
        if not item:
            return
        try:
            item.diarization_status, item.diarization_error = "processing", None
            db.commit()
            try:
                from pyannote.audio import Pipeline
            except ImportError as exc:
                raise ValueError("Instale o extra de diarização no worker e reinicie o serviço.") from exc
            from app.tasks import get_model_manager
            if settings.diarization_model != "pyannote/speaker-diarization-community-1" and not Path(settings.diarization_model).is_dir():
                raise ValueError("Use Community-1 ou um diretório local. Motores remotos não são aceitos.")
            get_model_manager(settings).current = None
            gc.collect()
            job = db.get(TranscriptionJob, job_id)
            media = db.get(MediaFile, job.media_file_id)
            extract_mono_wav(settings.uploads_dir / media.stored_name, path)
            pipeline = Pipeline.from_pretrained(settings.diarization_model, token=settings.hf_token)
            if pipeline is None:
                raise ValueError("O modelo de falantes requer aceite e token Hugging Face, ou um caminho local válido.")
            output = pipeline(str(path))
            turns = [(turn.start, turn.end, speaker) for turn, speaker in output.exclusive_speaker_diarization]
            segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.job_id == job_id)))
            for segment in segments:
                segment.speaker_id = best_speaker(segment.start, segment.end, turns)
            names = json.loads(item.speakers_json)
            for _, _, speaker in turns:
                if speaker not in names:
                    names[speaker] = f"Falante {len(names) + 1}"
            item.speakers_json = json.dumps(names, ensure_ascii=False)
            item.diarization_status = "completed"
            db.commit()
            del pipeline
            gc.collect()
        except Exception as exc:
            db.rollback()
            item = db.get(WorkspaceItem, job_id)
            item.diarization_status = "failed"
            item.diarization_error = str(exc) if isinstance(exc, ValueError) else "Não foi possível identificar os falantes. Verifique o modelo local, o token e o aceite de acesso."
            db.commit()
        finally:
            path.unlink(missing_ok=True)
