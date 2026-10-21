from collections.abc import Generator

import hmac
from fastapi import Header, HTTPException, WebSocketException
from starlette.requests import HTTPConnection
from app.auth import COOKIE, valid_session
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.db import get_db as _get_db

get_db = _get_db


def get_app_settings() -> Settings:
    return get_settings()


async def require_access_token(connection: HTTPConnection, x_access_token: str | None = Header(default=None)) -> None:
    path = connection.url.path
    if path == "/api/session" or (path.startswith("/api/shared/") and connection.scope.get("method") == "GET"):
        return
    settings = get_settings()
    if not settings.access_token:
        return
    if not (x_access_token and hmac.compare_digest(x_access_token, settings.access_token)) and not valid_session(connection.cookies.get(COOKIE)):
        if connection.scope["type"] == "websocket":
            raise WebSocketException(code=4401, reason="Session requise")
        raise HTTPException(status_code=401, detail="Token de acesso inválido ou ausente")


DbSession = Session
