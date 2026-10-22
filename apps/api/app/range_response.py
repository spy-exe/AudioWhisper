import re
from pathlib import Path

from fastapi import Request
from starlette.responses import Response, StreamingResponse

_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)\s*")
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


def _full_response(path: Path, file_size: int, media_type: str) -> StreamingResponse:
    return StreamingResponse(
        _iter_file(path, 0, file_size),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


def range_file_response(request: Request, path: Path, media_type: str) -> Response:
    """Streams a file with HTTP Range support (206 Partial Content), required for
    <audio>/<video> seeking. Starlette's built-in FileResponse doesn't support this."""
    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    if range_header is None:
        return _full_response(path, file_size, media_type)

    if "," in range_header:
        # Multipart ranges are optional (RFC 9110 §14.2); players only ask for one, so serve it all.
        return _full_response(path, file_size, media_type)

    match = _RANGE_RE.fullmatch(range_header.strip())
    if not match:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    start_str, end_str = match.groups()
    if not start_str and not end_str:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    if not start_str:
        # Suffix range: "bytes=-500" is the LAST 500 bytes, not bytes 0-500.
        suffix = int(end_str)
        if suffix == 0:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
        start, end = max(0, file_size - suffix), file_size - 1
    else:
        start = int(start_str)
        end = min(int(end_str) if end_str else file_size - 1, file_size - 1)

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
