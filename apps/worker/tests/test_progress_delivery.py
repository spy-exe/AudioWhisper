import json
from types import SimpleNamespace

from app.tasks import process_transcription_job


def test_throttled_progress_delivers_every_segment(make_media_and_job, monkeypatch):
    """Fast segments between progress updates must also reach connected clients."""
    _, job = make_media_and_job("speech.wav")
    events = []
    publisher = SimpleNamespace(
        publish=lambda channel, payload: events.append(json.loads(payload)), close=lambda: None
    )
    segments = [
        SimpleNamespace(start=i, end=i + 1, text=f"Trecho {i}", words=None, avg_logprob=-0.1)
        for i in range(3)
    ]
    model = SimpleNamespace(transcribe=lambda *args, **kwargs: (iter(segments), SimpleNamespace(language="pt")))
    loaded = SimpleNamespace(model=model, model_name="tiny", device="cpu", compute_type="int8")
    monkeypatch.setattr("app.tasks.redis.from_url", lambda *args: publisher)
    monkeypatch.setattr("app.tasks.get_model_manager", lambda *args: SimpleNamespace(get_model=lambda *args: loaded))
    monkeypatch.setattr("app.tasks.time.monotonic", lambda: 100.0)

    process_transcription_job(job.id)

    delivered = [s for event in events for s in event["new_segments"]]
    assert [s["segment_index"] for s in delivered] == [0, 1, 2]
    assert len({s["id"] for s in delivered}) == 3
