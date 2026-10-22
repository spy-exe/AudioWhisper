import json

from audiowhisper_core.db import session_scope
from audiowhisper_core.models import Bookmark, TranscriptSegment


def _words(text, start, step=1.0):
    return [{"word": f" {w}", "start": start + i * step, "end": start + (i + 1) * step, "probability": 0.9}
            for i, w in enumerate(text.split())]


def test_split_uses_word_timings_and_keeps_order(client, make_completed_job):
    text = "Primeiro assunto encerrado agora começa o segundo"
    job = make_completed_job([(text, 10.0, 17.0, {"words": _words(text, 10.0), "speaker": "S1"}),
                              ("Fim da conversa.", 17.0, 19.0)], speakers={"S1": "Ana"})
    offset = text.index("agora")
    response = client.post(f"/api/jobs/{job['job_id']}/segments/{job['segment_ids'][0]}/split", json={"offset": offset})
    assert response.status_code == 200, response.text
    segments = response.json()
    assert [s["text"] for s in segments] == ["Primeiro assunto encerrado", "agora começa o segundo", "Fim da conversa."]
    assert [s["segment_index"] for s in segments] == [0, 1, 2]
    first, second = segments[0], segments[1]
    assert first["id"] == job["segment_ids"][0]
    assert (first["start"], first["end"]) == (10.0, 13.0)
    assert (second["start"], second["end"]) == (13.0, 17.0)
    assert second["speaker_id"] == "S1" and second["edited"] is True
    assert [w["word"].strip() for w in second["words"]] == ["agora", "começa", "o", "segundo"]


def test_split_without_words_is_proportional_and_moves_later_bookmarks(client, make_completed_job):
    job = make_completed_job([("aaaa bbbb", 0.0, 10.0, {"confidence": 0.5})])
    segment_id = job["segment_ids"][0]
    early = client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 1, "label": "Início", "segment_id": segment_id}).json()
    late = client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 9, "label": "Fim", "segment_id": segment_id}).json()
    segments = client.post(f"/api/jobs/{job['job_id']}/segments/{segment_id}/split", json={"offset": 5}).json()
    assert segments[0]["end"] == segments[1]["start"]
    assert 4.0 < segments[0]["end"] < 6.0
    assert segments[1]["confidence"] == 0.5
    with session_scope() as db:
        assert db.get(Bookmark, early["id"]).segment_id == segment_id
        assert db.get(Bookmark, late["id"]).segment_id == segments[1]["id"]


def test_split_rejects_positions_without_text_on_both_sides(client, make_completed_job):
    job = make_completed_job([("Uma frase", 0.0, 2.0)])
    url = f"/api/jobs/{job['job_id']}/segments/{job['segment_ids'][0]}/split"
    for offset in (len("Uma frase"), 50):
        response = client.post(url, json={"offset": offset})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.post(url, json={"offset": 0}).status_code == 422
    assert client.post(f"/api/jobs/{job['job_id']}/segments/nao-existe/split", json={"offset": 2}).status_code == 404


def test_segments_can_only_be_restructured_after_completion(client, make_completed_job):
    job = make_completed_job([("Uma frase longa", 0.0, 2.0), ("Outra", 2.0, 3.0)], status="transcribing")
    split = client.post(f"/api/jobs/{job['job_id']}/segments/{job['segment_ids'][0]}/split", json={"offset": 4})
    assert split.status_code == 409
    assert split.json()["error"]["code"] == "CONFLICT"
    merge = client.post(f"/api/jobs/{job['job_id']}/segments/merge", json={"segment_ids": job["segment_ids"]})
    assert merge.status_code == 409


def test_merge_joins_consecutive_segments_with_weighted_confidence(client, make_completed_job):
    job = make_completed_job([
        ("Começo", 0.0, 1.0, {"confidence": 1.0, "words": _words("Começo", 0.0)}),
        ("meio", 1.0, 4.0, {"confidence": 0.6, "speaker": "S2", "words": _words("meio", 1.0)}),
        ("e fim.", 4.0, 5.0, {"confidence": None}),
        ("Separado", 6.0, 7.0),
    ], speakers={"S2": "Bruno"})
    a, b, c, d = job["segment_ids"]
    bookmark = client.post(f"/api/jobs/{job['job_id']}/bookmarks", json={"start": 4.5, "label": "Ponto", "segment_id": c}).json()
    response = client.post(f"/api/jobs/{job['job_id']}/segments/merge", json={"segment_ids": [c, a, b]})
    assert response.status_code == 200, response.text
    merged, rest = response.json()
    assert merged["id"] == a and rest["id"] == d
    assert merged["text"] == "Começo meio e fim."
    assert (merged["start"], merged["end"]) == (0.0, 5.0)
    assert abs(merged["confidence"] - (1.0 * 1 + 0.6 * 3) / 4) < 1e-9
    assert merged["speaker_id"] == "S2"  # first assigned speaker wins over an unassigned first segment
    assert [w["word"].strip() for w in merged["words"]] == ["Começo", "meio"]
    assert [s["segment_index"] for s in response.json()] == [0, 1]
    with session_scope() as db:
        assert db.get(TranscriptSegment, c) is None
        assert db.get(Bookmark, bookmark["id"]).segment_id == a


def test_merge_requires_consecutive_segments_of_the_same_job(client, make_completed_job):
    job = make_completed_job([("A", 0, 1), ("B", 1, 2), ("C", 2, 3)])
    other = make_completed_job([("X", 0, 1)])
    a, _, c = job["segment_ids"]
    url = f"/api/jobs/{job['job_id']}/segments/merge"
    assert client.post(url, json={"segment_ids": [a, c]}).status_code == 422
    assert client.post(url, json={"segment_ids": [a, a]}).status_code == 422
    assert client.post(url, json={"segment_ids": [a, other["segment_ids"][0]]}).status_code == 404
    assert client.post(url, json={"segment_ids": [a]}).status_code == 422


def test_segment_update_validates_times_and_length(client, make_completed_job):
    job = make_completed_job([("Texto", 0.0, 2.0)])
    url = f"/api/jobs/{job['job_id']}/segments/{job['segment_ids'][0]}"
    assert client.patch(url, json={"text": "x", "start": 3, "end": 1}).status_code == 422
    assert client.patch(url, json={"text": "x", "start": -1}).status_code == 422
    assert client.patch(url, json={"text": "x" * 20001}).status_code == 422
    ok = client.patch(url, json={"text": "Novo texto", "start": 0.5, "end": 1.5})
    assert ok.status_code == 200
    assert (ok.json()["start"], ok.json()["end"], ok.json()["edited"]) == (0.5, 1.5, True)


def test_replace_transcript_rejects_count_mismatch(client, make_completed_job):
    job = make_completed_job([("A", 0, 1), ("B", 1, 2)])
    response = client.put(f"/api/jobs/{job['job_id']}/transcript", json={"segments": [{"text": "só um"}]})
    assert response.status_code == 422
    assert response.json()["error"]["details"] == {"expected": 2, "received": 1}
    replaced = client.put(f"/api/jobs/{job['job_id']}/transcript", json={"segments": [{"text": "um"}, {"text": "dois", "start": 1.5}]})
    assert [s["text"] for s in replaced.json()] == ["um", "dois"]
    assert replaced.json()[1]["start"] == 1.5


def test_words_survive_split_round_trip_as_valid_json(client, make_completed_job):
    text = "um dois três quatro"
    job = make_completed_job([(text, 0.0, 4.0, {"words": _words(text, 0.0)})])
    client.post(f"/api/jobs/{job['job_id']}/segments/{job['segment_ids'][0]}/split", json={"offset": 7})
    with session_scope() as db:
        for segment in db.query(TranscriptSegment).filter_by(job_id=job["job_id"]):
            assert isinstance(json.loads(segment.words_json), list)
