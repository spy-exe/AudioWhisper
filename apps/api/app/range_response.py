import re
from pathlib import Path

from fastapi import Request
from starlette.responses import Response, StreamingResponse

_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
_CHUNK_SIZE = 1024 * 1024


def _iter_file(path: Path, start: int, length: int):
    with open(path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            chunk = f.read(min(_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def range_file_response(request: Request, path: Path, media_type: str) -> Response:
    """Streams a file with HTTP Range support (206 Partial Content), required for
    <audio>/<video> seeking. Starlette's built-in FileResponse doesn't support this."""
    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    if range_header is None:
        return StreamingResponse(
            _iter_file(path, 0, file_size),
            media_type=media_type,
            headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
        )

    match = _RANGE_RE.match(range_header)
    if not match:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    start_str, end_str = match.groups()
    if not start_str and not end_str:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    start = int(start_str) if start_str else 0
    end = int(end_str) if end_str else file_size - 1
    end = min(end, file_size - 1)

    if start > end or start >= file_size:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    length = end - start + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
    }
    return StreamingResponse(
        _iter_file(path, start, length), status_code=206, media_type=media_type, headers=headers
    )
