import json
import wave
from pathlib import Path

from audiowhisper_capture.spool import SpoolSession


def test_audio_is_committed_before_delivery_and_acknowledgements_survive_restart(tmp_path):
    session = SpoolSession.create(tmp_path, "job-1", "Reunião", "system")
    session.append(b"\x01\x00" * 16000)
    session.finish()
    assert session.snapshot()["pending_chunks"] == 1
    delivered = []

    class Client:
        def upload(self, job_id, sequence, start, path):
            assert path.exists()
            with wave.open(str(path)) as audio:
                assert (audio.getframerate(), audio.getnchannels(), audio.getnframes()) == (16000, 1, 16000)
            delivered.append((job_id, sequence, start))

        def stop(self, job_id, expected_chunks, duration):
            delivered.append((job_id, expected_chunks, duration))

    session.deliver(Client())
    restored = SpoolSession.load(session.directory)
    restored.deliver(Client())
    assert delivered == [("job-1", 0, 0), ("job-1", 1, 1)]
    assert restored.snapshot()["pending_chunks"] == 0
    assert restored.snapshot()["state"] == "uploaded"


def test_failed_delivery_keeps_the_wav_and_manifest_for_retry(tmp_path):
    session = SpoolSession.create(tmp_path, "job-2", "Reunião", "mixed")
    session.append(b"\0\0" * 80000)

    class Offline:
        def upload(self, *args):
            raise ConnectionError("offline")

    try:
        session.deliver(Offline())
    except ConnectionError:
        pass
    assert session.snapshot()["pending_chunks"] == 1
    assert session.directory.joinpath("000000.wav").exists()
    assert json.loads(session.directory.joinpath("session.json").read_text())["uploaded"] == []


def test_process_restart_recovers_a_partial_pcm_without_starting_a_microphone(tmp_path):
    session = SpoolSession.create(tmp_path, "job-3", "Recuperação", "microphone")
    # Simulate a process killed before the five-second WAV was finalized.
    session.directory.joinpath("000000.pcm").write_bytes(b"\0\0" * 24000)
    restored = SpoolSession.load(session.directory)
    assert restored.snapshot()["state"] == "stopping"
    assert restored.snapshot()["duration"] == 1.5
    assert restored.snapshot()["pending_chunks"] == 1


def test_recovery_does_not_duplicate_a_wav_committed_before_a_crash(tmp_path):
    session = SpoolSession.create(tmp_path, "job-4", "Recuperação", "system")
    session.append(b"\0\0" * 80000)
    # Crash between WAV rename and removing the corresponding raw journal.
    session.directory.joinpath("000000.pcm").write_bytes(b"\0\0" * 80000)
    restored = SpoolSession.load(session.directory)
    assert restored.snapshot()["duration"] == 5
    assert restored.snapshot()["pending_chunks"] == 1


def test_chunks_have_continuous_offsets_and_include_the_last_partial_buffer(tmp_path):
    session = SpoolSession.create(tmp_path, "job-5", "Contínua", "system")
    session.append(b"\0\0" * 176000)
    session.finish()
    assert [item["start"] for item in session.chunks] == [0, 5, 10]
    assert [item["duration"] for item in session.chunks] == [5, 5, 1]
    assert session.snapshot()["duration"] == 11


def test_empty_journal_after_a_crash_is_not_uploaded_as_invalid_audio(tmp_path):
    session = SpoolSession.create(tmp_path, "empty-job", "Teste", "system")
    session.directory.joinpath("000000.pcm").touch()
    restored = SpoolSession.load(session.directory)
    assert restored.snapshot()["duration"] == 0
    assert restored.snapshot()["pending_chunks"] == 0
