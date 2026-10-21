from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from audiowhisper_core.config import Settings, get_settings
from audiowhisper_core.schemas import SettingsUpdateIn

from app.dependencies import get_db
from app.services import settings_service

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
def get_settings_route(
    db: Session = Depends(get_db), settings: Settings = Depends(get_settings)
) -> dict:
    return settings_service.get_all_settings(db, settings)


@router.put("")
def update_settings_route(payload: SettingsUpdateIn, db: Session = Depends(get_db)) -> dict:
    return settings_service.update_settings(db, payload.values)
