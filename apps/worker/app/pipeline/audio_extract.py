import subprocess
from pathlib import Path

from audiowhisper_core.enums import ErrorCode
from audiowhisper_core.errors import AppError

TARGET_SAMPLE_RATE = 16000


def extract_mono_wav(input_path: Path, output_path: Path, timeout: int = 3600) -> None:
    """Normalize any supported audio/video file to 16kHz mono PCM WAV via ffmpeg.

    Uses a structured argument list (never shell=True / string interpolation)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "ffmpeg",
        "-y",
        "-nostdin",
        "-i", str(input_path),
        "-vn",
        "-ac", "1",
        "-ar", str(TARGET_SAMPLE_RATE),
        "-f", "wav",
        str(output_path),
        "-loglevel", "error",
    ]
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise AppError(ErrorCode.FFMPEG_FAILED, "ffmpeg não está disponível no worker") from exc
    except subprocess.TimeoutExpired as exc:
        raise AppError(ErrorCode.FFMPEG_FAILED, "ffmpeg excedeu o tempo limite") from exc

    if proc.returncode != 0 or not output_path.exists():
        raise AppError(
            ErrorCode.FFMPEG_FAILED,
            "Falha ao extrair áudio do arquivo de mídia",
            {"stderr": proc.stderr[-2000:]},
        )
