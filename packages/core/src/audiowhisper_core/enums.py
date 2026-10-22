from enum import Enum


class JobStatus(str, Enum):
    QUEUED = "queued"
    PREPARING = "preparing"
    EXTRACTING_AUDIO = "extracting_audio"
    LOADING_MODEL = "loading_model"
    TRANSCRIBING = "transcribing"
    GENERATING_EXPORTS = "generating_exports"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}


class MediaType(str, Enum):
    AUDIO = "audio"
    VIDEO = "video"


class ExportFormat(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    TXT = "txt"
    MARKDOWN = "markdown"
    JSON = "json"
    SRT = "srt"
    VTT = "vtt"
    CSV = "csv"


class Device(str, Enum):
    CUDA = "cuda"
    CPU = "cpu"


class ComputeType(str, Enum):
    INT8 = "int8"
    INT8_FLOAT16 = "int8_float16"
    FLOAT16 = "float16"
    FLOAT32 = "float32"


# faster-whisper model names accepted by the API. Anything else would only fail later in the worker,
# after a slow fallback ladder, instead of being rejected with a clear validation error.
KNOWN_MODELS = (
    "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
    "large-v1", "large-v2", "large-v3", "large", "turbo", "large-v3-turbo",
    "distil-small.en", "distil-medium.en", "distil-large-v2", "distil-large-v3",
)


class ModelSize(str, Enum):
    SMALL = "small"
    MEDIUM = "medium"
    TURBO = "turbo"
    LARGE_V3 = "large-v3"


class ErrorCode(str, Enum):
    GPU_OUT_OF_MEMORY = "GPU_OUT_OF_MEMORY"
    INVALID_FILE = "INVALID_FILE"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    NO_AUDIO_TRACK = "NO_AUDIO_TRACK"
    FFPROBE_FAILED = "FFPROBE_FAILED"
    FFMPEG_FAILED = "FFMPEG_FAILED"
    MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    CANCELLED = "CANCELLED"
    NOT_FOUND = "NOT_FOUND"
    DUPLICATE_FILE = "DUPLICATE_FILE"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    FILE_TOO_LARGE = "FILE_TOO_LARGE"
    CONFLICT = "CONFLICT"
    QUEUE_UNAVAILABLE = "QUEUE_UNAVAILABLE"
