from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException
from fastapi.encoders import jsonable_encoder

from audiowhisper_core.config import get_settings
from audiowhisper_core.enums import ErrorCode
from audiowhisper_core.errors import AppError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": f"HTTP_{exc.status_code}",
            "message": str(exc.detail), "details": {}, "request_id": getattr(request.state, "request_id", None)}}, headers=exc.headers)

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": exc.code.value,
                    "message": exc.message,
                    "details": exc.details,
                    "request_id": request_id,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": ErrorCode.VALIDATION_ERROR.value,
                    "message": "Dados de requisição inválidos",
                    "details": {"errors": jsonable_encoder(exc.errors())},
                    "request_id": request_id,
                }
            },
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # Logged with the traceback by RequestContextMiddleware; the client only gets a stable
        # code and the request id to correlate, never internal details.
        request_id = getattr(request.state, "request_id", None)
        headers = {get_settings().request_id_header: request_id} if request_id else None
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": ErrorCode.INTERNAL_ERROR.value,
                    "message": "Erro interno inesperado. Tente novamente; se persistir, consulte os logs da API.",
                    "details": {},
                    "request_id": request_id,
                }
            },
            headers=headers,
        )
