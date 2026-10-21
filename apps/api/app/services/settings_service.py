import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.models import ApplicationSettings

DEFAULT_KEYS = {
    "default_model",
    "transcription_device",
    "transcription_compute_type",
    "default_beam_size",
    "default_vad_enabled",
    "default_word_timestamps",
    "default_translate_to_english",
    "visual_effects_enabled",
    "ai_model",
    "ai_template",
}


def _defaults(settings: Settings) -> dict:
    return {
        "default_model": settings.default_model,
        "transcription_device": settings.transcription_device,
        "transcription_compute_type": settings.transcription_compute_type,
        "default_beam_size": settings.default_beam_size,
        "default_vad_enabled": settings.default_vad_enabled,
        "default_word_timestamps": settings.default_word_timestamps,
        "default_translate_to_english": settings.default_translate_to_english,
        "visual_effects_enabled": True,
        "ai_model": "",
        "ai_template": "minutes",
    }


def get_all_settings(db: Session, settings: Settings) -> dict:
    merged = _defaults(settings)
    rows = db.execute(select(ApplicationSettings)).scalars().all()
    for row in rows:
        merged[row.key] = json.loads(row.value)
    return merged


def update_settings(db: Session, values: dict) -> dict:
    for key, value in values.items():
        if key not in DEFAULT_KEYS:
            continue
        row = db.get(ApplicationSettings, key)
        encoded = json.dumps(value)
        if row is None:
            row = ApplicationSettings(key=key, value=encoded)
            db.add(row)
        else:
            row.value = encoded
    db.commit()
    return values
