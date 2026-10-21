import hmac
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from audiowhisper_core.config import get_settings
from app.auth import COOKIE, SESSION_SECONDS, session_cookie, valid_session

router = APIRouter(prefix="/api/session", tags=["session"])


@router.get("")
def session_status(request: Request):
    required = bool(get_settings().access_token)
    return {"required": required, "authenticated": not required or valid_session(request.cookies.get(COOKIE))}


class LoginIn(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


@router.post("")
def login(payload: LoginIn, request: Request, response: Response):
    token = get_settings().access_token
    if token and not hmac.compare_digest(payload.token, token):
        raise HTTPException(401, "Token de acesso inválido")
    if token:
        response.set_cookie(COOKIE, session_cookie(token), httponly=True, samesite="strict", secure=request.url.scheme == "https", max_age=SESSION_SECONDS)
    return {"authenticated": True}


@router.delete("")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"authenticated": False}
