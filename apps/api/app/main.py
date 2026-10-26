from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from audiowhisper_core.config import get_settings

from app.dependencies import require_access_token
from app.error_handlers import register_error_handlers
from app.request_context import RequestContextMiddleware
from app.routers import actions, bookmarks, documents, exports, health, jobs, knowledge, library, live, media, notebook, projects, recipes, search, session, settings, sharing, speakers, system, workspace, ws
from app.routers import companion

settings_obj = get_settings()

app = FastAPI(
    title="AudioWhisper API",
    version="2.1.0",
    debug=False,
    # No Swagger/ReDoc pages: they load assets from public CDNs. The schema is served below as a
    # regular route, so it sits behind the same access token as the rest of the API.
    docs_url=None,
    openapi_url=None,
    redoc_url=None,
    dependencies=[Depends(require_access_token)],
)

app.add_middleware(RequestContextMiddleware)

if settings_obj.cors_allow_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings_obj.cors_allow_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

register_error_handlers(app)

app.include_router(health.router)
app.include_router(companion.router)
app.include_router(settings.router)
app.include_router(media.router)
app.include_router(jobs.router)
app.include_router(library.router)
app.include_router(projects.router)
app.include_router(search.router)
app.include_router(actions.router)
app.include_router(notebook.router)
app.include_router(knowledge.router)
app.include_router(recipes.router)
app.include_router(workspace.router)
app.include_router(documents.router)
app.include_router(session.router)
app.include_router(sharing.router)
app.include_router(speakers.router)
app.include_router(live.router)
app.include_router(exports.router)
app.include_router(bookmarks.router)
app.include_router(system.router)
app.include_router(ws.router)


@app.get("/api/openapi.json", include_in_schema=False)
def openapi_schema() -> dict:
    return app.openapi()
