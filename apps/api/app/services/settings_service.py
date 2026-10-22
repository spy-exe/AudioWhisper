import json
import re
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings
from audiowhisper_core.enums import KNOWN_MODELS, ComputeType, Device
from audiowhisper_core.errors import ValidationAppError
from audiowhisper_core.models import ApplicationSettings
from audiowhisper_core.stats import DEFAULT_LOW_CONFIDENCE


def _choice(options) -> Callable[[Any], Any]:
    allowed = tuple(options)

    def check(value):
        if value not in allowed:
            raise ValueError(f"Use um destes valores: {', '.join(map(str, allowed))}")
        return value
    return check


def _boolean(value):
    if not isinstance(value, bool):
        raise ValueError("Use verdadeiro ou falso")
    return value


def _integer(low: int, high: int):
    def check(value):
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise ValueError(f"Use um número inteiro entre {low} e {high}")
        return value
    return check


def _number(low: float, high: float):
    def check(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise ValueError(f"Use um número entre {low} e {high}")
        return float(value)
    return check


def _text(max_length: int, pattern: str | None = None):
    def check(value):
        if not isinstance(value, str) or len(value) > max_length:
            raise ValueError(f"Use um texto de até {max_length} caracteres")
        value = " ".join(value.split())
        if value and pattern and not re.fullmatch(pattern, value):
            raise ValueError("Formato inválido")
        return value
    return check


VALIDATORS: dict[str, Callable[[Any], Any]] = {
    "default_model": _choice(KNOWN_MODELS),
    "transcription_device": _choice(d.value for d in Device),
    "transcription_compute_type": _choice(c.value for c in ComputeType),
    "default_beam_size": _integer(1, 10),
    "default_vad_enabled": _boolean,
    "default_word_timestamps": _boolean,
    "default_translate_to_english": _boolean,
    "default_language": _text(12, r"[a-z]{2,3}(-[A-Za-z]{2,4})?"),
    "vocabulary": _text(1000),
    "hotwords": _text(500),
    "low_confidence_threshold": _number(0.05, 0.99),
    "notifications_enabled": _boolean,
    "visual_effects_enabled": _boolean,
    "ai_model": _text(128),
    "ai_template": _choice(("minutes", "briefing", "summary", "decisions", "actions", "risks", "questions", "email", "custom")),
}
DEFAULT_KEYS = set(VALIDATORS)


def _defaults(settings: Settings) -> dict:
    return {
        "default_model": settings.default_model,
        "transcription_device": settings.transcription_device,
        "transcription_compute_type": settings.transcription_compute_type,
        "default_beam_size": settings.default_beam_size,
        "default_vad_enabled": settings.default_vad_enabled,
        "default_word_timestamps": settings.default_word_timestamps,
        "default_translate_to_english": settings.default_translate_to_english,
        "default_language": "",
        "vocabulary": "",
        "hotwords": "",
        "low_confidence_threshold": DEFAULT_LOW_CONFIDENCE,
        "notifications_enabled": False,
        "visual_effects_enabled": True,
        "ai_model": "",
        "ai_template": "minutes",
    }


def get_all_settings(db: Session, settings: Settings) -> dict:
    merged = _defaults(settings)
    rows = db.execute(select(ApplicationSettings)).scalars().all()
    for row in rows:
        if row.key in DEFAULT_KEYS:
            merged[row.key] = json.loads(row.value)
    return merged


def validate_settings(values: dict) -> dict:
    """All-or-nothing: one invalid field rejects the whole update, listing every problem.
    Unknown keys are ignored (an older open tab may still send a removed setting)."""
    errors, clean = {}, {}
    for key, value in values.items():
        validator = VALIDATORS.get(key)
        if validator is None:
            continue
        try:
            clean[key] = validator(value)
        except ValueError as exc:
            errors[key] = str(exc)
    if errors:
        raise ValidationAppError("Revise os valores destacados nas configurações.", {"fields": errors})
    return clean


def update_settings(db: Session, values: dict) -> dict:
    clean = validate_settings(values)
    for key, value in clean.items():
        row = db.get(ApplicationSettings, key)
        encoded = json.dumps(value)
        if row is None:
            row = ApplicationSettings(key=key, value=encoded)
            db.add(row)
        else:
            row.value = encoded
    db.commit()
    return clean
