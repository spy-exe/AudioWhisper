import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from audiowhisper_core.enums import KNOWN_MODELS, ComputeType, Device, ExportFormat, JobStatus, MediaType

_LANGUAGE = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4})?$")


class MediaFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_name: str
    mime_type: str
    extension: str
    size_bytes: int
    sha256: str
    duration_seconds: float | None
    media_type: MediaType
    metadata: dict[str, Any] | None = None
    created_at: datetime
    is_duplicate: bool = False
    duplicate_of_job_ids: list[str] = Field(default_factory=list)


class TranscriptionSettingsIn(BaseModel):
    model_name: str = "turbo"
    language: str | None = None
    device: Device = Device.CUDA
    compute_type: ComputeType = ComputeType.INT8_FLOAT16
    beam_size: int = Field(default=5, ge=1, le=10)
    vad_enabled: bool = True
    word_timestamps: bool = True
    translate_to_english: bool = False
    temperature: float = Field(default=0.0, ge=0.0, le=1.0)
    # Vocabulary hints: names and jargon steer recognition without changing what was said.
    initial_prompt: str | None = Field(default=None, max_length=1000)
    hotwords: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(use_enum_values=True)

    @field_validator("model_name")
    @classmethod
    def _known_model(cls, value: str) -> str:
        if value not in KNOWN_MODELS:
            raise ValueError(f"Modelo desconhecido: {value}")
        return value

    @field_validator("language", mode="before")
    @classmethod
    def _language_code(cls, value):
        if value is None or (isinstance(value, str) and not value.strip()):
            return None
        if not isinstance(value, str) or not _LANGUAGE.match(value.strip()):
            raise ValueError("Use um código de idioma como pt, en ou es")
        return value.strip()

    @field_validator("initial_prompt", "hotwords", mode="before")
    @classmethod
    def _blank_to_none(cls, value):
        if isinstance(value, str):
            value = " ".join(value.split())
            return value or None
        return value


class JobCreateIn(BaseModel):
    media_file_id: str
    settings: TranscriptionSettingsIn = Field(default_factory=TranscriptionSettingsIn)


class TranscriptionJobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    media_file_id: str
    status: JobStatus
    cancel_requested: bool = False
    progress: float
    current_stage: str | None
    model_name: str
    language_requested: str | None
    language_detected: str | None
    compute_type: str
    device: str
    started_at: datetime | None
    completed_at: datetime | None
    failed_at: datetime | None
    error_code: str | None
    error_message: str | None
    processing_seconds: float | None
    real_time_factor: float | None
    created_at: datetime
    updated_at: datetime


class WordOut(BaseModel):
    word: str
    start: float
    end: float
    probability: float | None = None


class TranscriptSegmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    segment_index: int
    start: float
    end: float
    text: str
    confidence: float | None
    words: list[WordOut] | None = None
    edited: bool
    speaker_id: str | None = None
    updated_at: datetime


class SegmentUpdateIn(BaseModel):
    text: str = Field(max_length=20000)
    start: float | None = Field(default=None, ge=0, le=172800)
    end: float | None = Field(default=None, ge=0, le=172800)
    speaker_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def _ordered(self):
        if self.start is not None and self.end is not None and self.end < self.start:
            raise ValueError("O fim do segmento não pode ser anterior ao início")
        return self


class TranscriptUpdateIn(BaseModel):
    segments: list[SegmentUpdateIn]


class ExportFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    format: ExportFormat
    size_bytes: int
    created_at: datetime


class ExportRequestIn(BaseModel):
    formats: list[ExportFormat] = Field(min_length=1, max_length=8)
    include_timestamps: bool = True
    include_speakers: bool = True


class SegmentSplitIn(BaseModel):
    offset: int = Field(ge=1, description="Posição no texto onde o segmento é dividido")


class SegmentMergeIn(BaseModel):
    segment_ids: list[str] = Field(min_length=2, max_length=50)


BookmarkColor = Literal["amber", "violet", "spectral", "rose", "blue"]


class BookmarkIn(BaseModel):
    start: float = Field(ge=0, le=172800)
    label: str = Field(min_length=1, max_length=200)
    note: str = Field(default="", max_length=2000)
    color: BookmarkColor = "amber"
    segment_id: str | None = Field(default=None, max_length=36)

    @field_validator("label")
    @classmethod
    def _trim_label(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Dê um nome ao marcador")
        return value.strip()


class BookmarkUpdateIn(BaseModel):
    start: float | None = Field(default=None, ge=0, le=172800)
    label: str | None = Field(default=None, min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    color: BookmarkColor | None = None


class BookmarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    job_id: str
    segment_id: str | None
    start: float
    label: str
    note: str
    color: str
    created_at: datetime
    updated_at: datetime


class SettingsOut(BaseModel):
    key: str
    value: Any


class SettingsUpdateIn(BaseModel):
    values: dict[str, Any]


class ProgressEvent(BaseModel):
    job_id: str
    status: JobStatus
    progress: float
    current_stage: str | None = None
    language_detected: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    new_segments: list[TranscriptSegmentOut] = Field(default_factory=list)
    eta_seconds: float | None = None
    ts: float


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class GpuDiagnostics(BaseModel):
    gpu_available: bool
    gpu_name: str | None = None
    total_memory_mb: float | None = None
    free_memory_mb: float | None = None
    driver_version: str | None = None
    cuda_runtime_version: str | None = None
    ctranslate2_version: str | None = None
    ctranslate2_cuda_device_count: int | None = None
    loaded_model: str | None = None
    compute_type: str | None = None
    device_in_use: str | None = None
    checked_at: float | None = None
    error: str | None = None
