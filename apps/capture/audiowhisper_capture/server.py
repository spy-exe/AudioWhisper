from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware


class StartCapture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="Gravação do Windows", min_length=1, max_length=500)
    source: Literal["microphone", "system", "mixed", "obs"] = "system"
    microphone: str = Field(default="", pattern=r"^\d{0,5}$")
    output: str = Field(default="", pattern=r"^\d{0,5}$")
    prevent_sleep: bool = True
    settings: dict = Field(default_factory=dict)


def create_app(manager, origins, device_provider=None):
    app = FastAPI(title="AudioWhisper Windows Capture", docs_url=None, redoc_url=None, openapi_url=None)
    allowed = set(origins)

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        if request.url.path != "/health" and request.method != "OPTIONS":
            if request.headers.get("origin") not in allowed or request.headers.get("x-audiowhisper-capture") != "1":
                return JSONResponse({"detail": "Origem não autorizada"}, status_code=403)
            if request.method == "POST" and request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"detail": "Envie JSON"}, status_code=415)
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                return JSONResponse({"detail": "Tamanho inválido"}, status_code=400)
            if length > 16384:
                return JSONResponse({"detail": "Solicitação muito grande"}, status_code=413)
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=list(allowed), allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "X-AudioWhisper-Capture"], allow_credentials=False)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    @app.get("/health")
    def health():
        return {"service": "audiowhisper-capture", "version": "1.0.0"}

    @app.get("/status")
    def status():
        return manager.status()

    @app.get("/devices")
    def devices():
        try:
            return (device_provider or manager.audio_factory.devices)()
        except Exception:
            raise HTTPException(503, "Não foi possível listar as entradas WASAPI. Conecte uma saída de áudio e um microfone, se necessário.")

    @app.post("/start", status_code=201)
    def start(payload: StartCapture):
        if manager.status()["recording"]:
            raise HTTPException(409, "Já existe uma gravação em andamento no Windows")
        try:
            return manager.start(**payload.model_dump())
        except Exception:
            raise HTTPException(503, "Não foi possível iniciar. Verifique as entradas selecionadas, as permissões do Windows e se o Studio está disponível.")

    @app.post("/stop")
    def stop():
        return manager.stop()

    return app
