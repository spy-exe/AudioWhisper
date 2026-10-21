import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from audiowhisper_core.config import get_settings
from audiowhisper_core.logging import configure_logging

logger = configure_logging("api", get_settings().log_level)


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        settings = get_settings()
        request_id = request.headers.get(settings.request_id_header) or str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.monotonic()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            logger.exception(
                "unhandled_exception",
                extra={"request_id": request_id, "duration_ms": duration_ms},
            )
            raise
        duration_ms = round((time.monotonic() - start) * 1000, 2)
        response.headers[settings.request_id_header] = request_id
        safe_path = "/api/shared/<redacted>" if request.url.path.startswith("/api/shared/") else request.url.path
        logger.info(
            f"{request.method} {safe_path} {response.status_code}",
            extra={"request_id": request_id, "duration_ms": duration_ms},
        )
        return response
