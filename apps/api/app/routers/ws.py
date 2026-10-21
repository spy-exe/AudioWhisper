import asyncio
import contextlib
import json

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from audiowhisper_core.config import get_settings
from audiowhisper_core.db import session_scope
from audiowhisper_core.enums import TERMINAL_STATUSES
from audiowhisper_core.models import TranscriptionJob, TranscriptSegment, LiveChunk, LiveSession
from audiowhisper_core.progress import progress_channel
from audiowhisper_core.schemas import TranscriptionJobOut
from app.routers.jobs import _segment_to_out

router = APIRouter(tags=["ws"])


def _current_job_snapshot(job_id: str) -> dict | None:
    with session_scope() as db:
        job = db.get(TranscriptionJob, job_id)
        if job is None:
            return None
        stmt = (
            select(TranscriptSegment)
            .where(TranscriptSegment.job_id == job_id)
            .order_by(TranscriptSegment.segment_index)
        )
        segments = list(db.execute(stmt).scalars().all())
        job_out = TranscriptionJobOut.model_validate(job).model_dump(mode="json")
        chunks = list(db.scalars(select(LiveChunk).where(LiveChunk.job_id == job_id).order_by(LiveChunk.sequence, LiveChunk.revision)))
        drafts, finished = {}, set()
        for chunk in chunks:
            if chunk.final and chunk.status == "completed":
                finished.add(chunk.sequence)
            elif not chunk.final and chunk.status == "completed":
                drafts[chunk.sequence] = json.loads(chunk.result_json)
        return {
            "type": "snapshot",
            "job": job_out,
            "segment_count": len(segments),
            "segments": [_segment_to_out(s).model_dump(mode="json") for s in segments],
            "provisional_segments": [s for sequence, values in drafts.items() if sequence not in finished for s in values],
        }


@router.websocket("/ws/jobs/{job_id}")
async def job_progress_ws(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    settings = get_settings()

    snapshot = _current_job_snapshot(job_id)
    if snapshot is None:
        await websocket.send_json({"type": "error", "message": "job não encontrado"})
        await websocket.close(code=4404)
        return
    if snapshot["job"]["status"] in {s.value for s in TERMINAL_STATUSES}:
        await websocket.send_json(snapshot)
        await websocket.close(code=1000)
        return

    redis_conn = aioredis.from_url(settings.redis_url)
    pubsub = redis_conn.pubsub()
    channel = progress_channel(settings, job_id)
    await pubsub.subscribe(channel)
    # Subscribe before taking the recovery snapshot; commits between these operations
    # may appear twice, and clients reconcile by segment ID rather than losing them.
    snapshot = _current_job_snapshot(job_id)
    await websocket.send_json(snapshot)
    if snapshot["job"]["status"] in {s.value for s in TERMINAL_STATUSES}:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await redis_conn.close()
        await websocket.close(code=1000)
        return

    async def forward_progress() -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            payload = json.loads(message["data"])
            await websocket.send_json({"type": "progress", **payload})
            if payload.get("status") in {s.value for s in TERMINAL_STATUSES}:
                break

    async def watch_disconnect() -> None:
        with contextlib.suppress(WebSocketDisconnect):
            while True:
                await websocket.receive_text()

    forward_task = asyncio.create_task(forward_progress())
    watch_task = asyncio.create_task(watch_disconnect())
    try:
        done, pending = await asyncio.wait(
            {forward_task, watch_task}, return_when=asyncio.FIRST_COMPLETED
        )
        for task in pending:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        for task in done:
            with contextlib.suppress(WebSocketDisconnect, RuntimeError):
                task.result()
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await redis_conn.close()
        with contextlib.suppress(RuntimeError):
            await websocket.close()
