from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from audiowhisper_core.enums import ExportFormat, JobStatus, MediaType


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
    device: str = "cuda"
    compute_type: str = "int8_float16"
    beam_size: int = Field(default=5, ge=1, le=10)
    vad_enabled: bool = True
    word_timestamps: bool = True
    translate_to_english: bool = False
    temperature: float = Field(default=0.0, ge=0.0, le=1.0)


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
    text: str
    start: float | None = None
    end: float | None = None
    speaker_id: str | None = Field(default=None, max_length=64)


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
    formats: list[ExportFormat]
    include_timestamps: bool = True


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
