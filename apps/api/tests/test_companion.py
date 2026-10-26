import uuid


def test_companion_identifies_the_same_installation_and_live_contract(client):
    first = client.get('/api/companion')
    assert first.status_code == 200
    body = first.json()
    assert body['service'] == 'audiowhisper'
    assert body['protocol_version'] == 1
    assert uuid.UUID(body['instance_id'])
    assert client.get('/api/companion').json()['instance_id'] == body['instance_id']
    assert body['audio'] == {'sample_rate': 16000, 'channels': 1, 'sample_width': 2, 'chunk_seconds': 4, 'max_chunk_seconds': 30}
    assert 'access_token' not in body


def test_mobile_live_creation_retries_preserve_one_job_and_its_original_title(client):
    payload = {'title': 'Captura móvel sintética', 'capture_id': str(uuid.uuid4()), 'source': 'microphone'}
    first = client.post('/api/live', json=payload)
    assert first.status_code == 201
    second = client.post('/api/live', json=payload)
    assert second.status_code == 201
    assert second.json()['id'] == first.json()['id']
    assert second.json()['media_file_id'] == first.json()['media_file_id']
    changed = client.post('/api/live', json={**payload, 'title': 'Outro título'})
    assert changed.status_code == 409


def test_mobile_capture_id_is_validated_and_optional_for_existing_clients(client):
    assert client.post('/api/live', json={'title': 'Inválida', 'capture_id': 'not-a-uuid'}).status_code == 422
    first = client.post('/api/live', json={'title': 'Captura anterior'})
    second = client.post('/api/live', json={'title': 'Captura anterior'})
    assert first.json()['id'] != second.json()['id']


def test_live_transcript_paginates_confirmed_segments_and_preserves_status(client, make_completed_job):
    job = make_completed_job([('Uma fala', 0, 2), ('Outra fala', 2, 4), ('Última fala', 4, 6)])
    response = client.get(f"/api/companion/captures/{job['job_id']}/transcript?after_index=0&limit=1")
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'completed'
    assert [segment['text'] for segment in body['segments']] == ['Outra fala']
    assert client.get('/api/companion/captures/missing/transcript').status_code == 404
    assert client.get(f"/api/companion/captures/{job['job_id']}/transcript?limit=501").status_code == 422


def test_companion_keeps_the_existing_access_control(client, settings, monkeypatch):
    monkeypatch.setattr(settings, 'access_token', 'companion-test-only')
    assert client.get('/api/companion').status_code == 401
    response = client.get('/api/companion', headers={'X-Access-Token': 'companion-test-only'})
    assert response.status_code == 200
    assert response.json()['authentication_required'] is True
    assert 'companion-test-only' not in response.text


def test_transcript_cursor_detects_late_segments_edits_and_deletions(client, make_completed_job):
    from audiowhisper_core.db import session_scope
    from audiowhisper_core.models import TranscriptSegment

    job = make_completed_job([('Primeira fala', 0, 2), ('Fala posterior', 4, 6)])
    path = f"/api/companion/captures/{job['job_id']}/transcript"
    with session_scope() as db:
        db.get(TranscriptSegment, job['segment_ids'][1]).segment_index = 2
    first = client.get(path + '?limit=1').json()
    assert first['has_more'] is True
    second = client.get(path, params={'after_index': 0, 'known_hash': first['prefix_hash'], 'limit': 1}).json()
    assert second['reset'] is False
    assert second['has_more'] is False
    assert second['segments'][0]['segment_index'] == 2
    with session_scope() as db:
        db.add(TranscriptSegment(job_id=job['job_id'], segment_index=1, text='Fala atrasada', start=2, end=4))
    reset = client.get(path, params={'after_index': 2, 'known_hash': second['prefix_hash']}).json()
    assert reset['reset'] is True
    assert [s['text'] for s in reset['segments']] == ['Primeira fala', 'Fala atrasada', 'Fala posterior']
    with session_scope() as db:
        db.get(TranscriptSegment, job['segment_ids'][0]).text = 'Correção humana'
        db.delete(db.get(TranscriptSegment, job['segment_ids'][1]))
    edited = client.get(path, params={'after_index': 2, 'known_hash': reset['prefix_hash']}).json()
    assert edited['reset'] is True
    assert [s['text'] for s in edited['segments']] == ['Correção humana', 'Fala atrasada']
    unchanged = client.get(path, params={'after_index': 1, 'known_hash': edited['prefix_hash']}).json()
    assert unchanged['reset'] is False
    assert unchanged['segments'] == []
    assert unchanged['prefix_hash'] == edited['prefix_hash']
    assert client.get(path, params={'known_hash': 'invalid'}).status_code == 422


def test_empty_transcript_has_a_stable_cursor(client, make_completed_job):
    job = make_completed_job([])
    path = f"/api/companion/captures/{job['job_id']}/transcript"
    first = client.get(path).json()
    second = client.get(path, params={'known_hash': first['prefix_hash']}).json()
    assert first['segments'] == []
    assert second['has_more'] is False
    assert second['reset'] is False
    assert first['prefix_hash'] == second['prefix_hash']
