import json
import subprocess

from audiowhisper_core.enums import ErrorCode, MediaType
from audiowhisper_core.errors import AppError


class FfprobeResult:
    def __init__(self, raw: dict) -> None:
        self.raw = raw
        fmt = raw.get("format", {})
        streams = raw.get("streams", [])
        self.duration_seconds: float | None = (
            float(fmt["duration"]) if fmt.get("duration") else None
        )
        self.bitrate: int | None = int(fmt["bit_rate"]) if fmt.get("bit_rate") else None
        self.format_name: str | None = fmt.get("format_name")

        audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
        video_streams = [s for s in streams if s.get("codec_type") == "video"]

        self.has_audio = len(audio_streams) > 0
        self.has_video = len(video_streams) > 0
        self.media_type = MediaType.VIDEO if self.has_video else MediaType.AUDIO

        audio = audio_streams[0] if audio_streams else {}
        self.audio_codec: str | None = audio.get("codec_name")
        self.channels: int | None = audio.get("channels")
        self.sample_rate: int | None = int(audio["sample_rate"]) if audio.get("sample_rate") else None

        video = video_streams[0] if video_streams else {}
        self.video_codec: str | None = video.get("codec_name")
        self.width: int | None = video.get("width")
        self.height: int | None = video.get("height")

    def to_metadata_dict(self) -> dict:
        return {
            "duration_seconds": self.duration_seconds,
            "bitrate": self.bitrate,
            "format_name": self.format_name,
            "has_audio": self.has_audio,
            "has_video": self.has_video,
            "audio_codec": self.audio_codec,
            "channels": self.channels,
            "sample_rate": self.sample_rate,
            "video_codec": self.video_codec,
            "width": self.width,
            "height": self.height,
        }


def probe(file_path: str, timeout: int = 30) -> FfprobeResult:
    """Run ffprobe with structured arguments (never shell interpolation) and parse JSON output."""
    args = [
        "ffprobe",
        "-v", "error",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        file_path,
    ]
    try:
        proc = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout, check=False
        )
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.FFPROBE_FAILED, "ffprobe não está disponível no worker/API") from exc
    except subprocess.TimeoutExpired as exc:
        raise AppError(ErrorCode.FFPROBE_FAILED, "ffprobe excedeu o tempo limite") from exc

    if proc.returncode != 0:
        raise AppError(
            ErrorCode.FFPROBE_FAILED,
            "Não foi possível ler metadados do arquivo de mídia",
            {"stderr": proc.stderr[-2000:]},
        )

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AppError(ErrorCode.FFPROBE_FAILED, "Saída inválida do ffprobe") from exc

    result = FfprobeResult(data)
    if not result.has_audio:
        raise AppError(
            ErrorCode.NO_AUDIO_TRACK,
            "O arquivo enviado não possui faixa de áudio",
        )
    return result
