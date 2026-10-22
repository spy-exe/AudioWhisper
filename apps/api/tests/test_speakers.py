from unittest.mock import Mock

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import TranscriptSegment, WorkspaceItem


def test_participants_can_be_added_by_hand_and_assigned_in_bulk(client, make_completed_job):
    job = make_completed_job([("Oi", 0, 1), ("Tudo bem?", 1, 2), ("Sim", 2, 3)])
    url = f"/api/jobs/{job['job_id']}/speakers"
    ana = client.post(url, json={"name": "  Ana  "})
    assert ana.status_code == 201, ana.text
    assert ana.json()["speaker_id"] == "manual-1" and ana.json()["speakers"] == {"manual-1": "Ana"}
    bruno = client.post(url, json={"name": "Bruno"}).json()
    assert bruno["speaker_id"] == "manual-2"
    assert client.post(url, json={"name": "ana"}).status_code == 422
    assert client.post(url, json={"name": "   "}).status_code == 422

    assigned = client.put(f"/api/jobs/{job['job_id']}/segments/speaker",
                          json={"segment_ids": job["segment_ids"][:2], "speaker_id": "manual-1"})
    assert assigned.status_code == 200
    assert [s["speaker_id"] for s in assigned.json()] == ["manual-1", "manual-1"]
    assert all(s["edited"] is False for s in assigned.json())
    unknown = client.put(f"/api/jobs/{job['job_id']}/segments/speaker", json={"segment_ids": job["segment_ids"], "speaker_id": "ghost"})
    assert unknown.status_code == 404
    cleared = client.put(f"/api/jobs/{job['job_id']}/segments/speaker", json={"segment_ids": [job["segment_ids"][0]], "speaker_id": None})
    assert cleared.json()[0]["speaker_id"] is None


def test_assignment_rejects_segments_from_other_recordings(client, make_completed_job):
    job = make_completed_job([("Oi", 0, 1)], speakers={"S1": "Ana"})
    other = make_completed_job([("Outra", 0, 1)])
    response = client.put(f"/api/jobs/{job['job_id']}/segments/speaker",
                          json={"segment_ids": [job["segment_ids"][0], other["segment_ids"][0]], "speaker_id": "S1"})
    assert response.status_code == 404
    with session_scope() as db:
        assert db.get(TranscriptSegment, job["segment_ids"][0]).speaker_id is None


def test_merge_moves_every_segment_and_removes_the_duplicate_name(client, make_completed_job):
    job = make_completed_job([("A", 0, 1, {"speaker": "SPEAKER_00"}), ("B", 1, 2, {"speaker": "SPEAKER_01"}),
                              ("C", 2, 3, {"speaker": "SPEAKER_01"})], speakers={"SPEAKER_00": "Ana", "SPEAKER_01": "Ana (2)"})
    url = f"/api/jobs/{job['job_id']}/speakers/merge"
    assert client.post(url, json={"source": "SPEAKER_01", "target": "SPEAKER_01"}).status_code == 422
    assert client.post(url, json={"source": "SPEAKER_09", "target": "SPEAKER_00"}).status_code == 404
    merged = client.post(url, json={"source": "SPEAKER_01", "target": "SPEAKER_00"})
    assert merged.status_code == 200
    assert merged.json()["moved_segments"] == 2 and merged.json()["speakers"] == {"SPEAKER_00": "Ana"}
    speakers = {s["speaker_id"] for s in client.get(f"/api/jobs/{job['job_id']}/segments").json()}
    assert speakers == {"SPEAKER_00"}


def test_removing_a_participant_clears_its_segments(client, make_completed_job):
    job = make_completed_job([("A", 0, 1, {"speaker": "S1"}), ("B", 1, 2, {"speaker": "S2"})], speakers={"S1": "Ana", "S2": "Bruno"})
    removed = client.delete(f"/api/jobs/{job['job_id']}/speakers/S2")
    assert removed.status_code == 200 and removed.json()["cleared_segments"] == 1
    assert removed.json()["speakers"] == {"S1": "Ana"}
    assert client.delete(f"/api/jobs/{job['job_id']}/speakers/S2").status_code == 404


def test_participant_limit(client, make_completed_job, monkeypatch):
    from app.routers import speakers
    monkeypatch.setattr(speakers, "MAX_SPEAKERS", 1)
    job = make_completed_job([("A", 0, 1)])
    assert client.post(f"/api/jobs/{job['job_id']}/speakers", json={"name": "Ana"}).status_code == 201
    assert client.post(f"/api/jobs/{job['job_id']}/speakers", json={"name": "Bruno"}).status_code == 422


def test_diarization_preconditions_and_queue_failures(client, make_completed_job, monkeypatch, settings):
    running = make_completed_job([("A", 0, 1)], status="transcribing")
    assert client.post(f"/api/jobs/{running['job_id']}/diarize").status_code == 409
    job = make_completed_job([("A", 0, 1)])
    monkeypatch.setattr(settings, "hf_token", None)
    monkeypatch.setattr(settings, "diarization_model", "pyannote/speaker-diarization-community-1")
    assert client.post(f"/api/jobs/{job['job_id']}/diarize").status_code == 409

    monkeypatch.setattr(settings, "hf_token", "hf_test")
    queue = Mock()
    monkeypatch.setattr("app.routers.speakers.get_queue", lambda: queue)
    assert client.post(f"/api/jobs/{job['job_id']}/diarize").status_code == 202
    queue.enqueue.assert_called_once()
    assert client.post(f"/api/jobs/{job['job_id']}/diarize").status_code == 409  # already queued

    other = make_completed_job([("B", 0, 1)])
    queue.enqueue.side_effect = RuntimeError("redis down")
    failed = client.post(f"/api/jobs/{other['job_id']}/diarize")
    assert failed.status_code == 503
    with session_scope() as db:
        assert db.get(WorkspaceItem, other["job_id"]).diarization_status == "failed"
