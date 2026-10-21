import threading
import time

import numpy as np
import pytest

from audiowhisper_capture.audio import mix_pcm, mono_pcm
from audiowhisper_capture.manager import CaptureManager
from audiowhisper_capture.spool import SpoolSession


class FakeAudio:
    power_protected = True

    def __init__(self, *args):
        self.closed = False

    def prepare(self):
        pass

    def run(self, consume, stop_event):
        while not stop_event.wait(0.01):
            consume(b"\x01\x00" * 1600)

    def close(self):
        self.closed = True


class Client:
    def __init__(self):
        self.uploaded = []
        self.stopped = []

    def create(self, *args):
        return "native-test-job"

    def upload(self, *args):
        self.uploaded.append(args)

    def stop(self, *args):
        self.stopped.append(args)


def test_capture_is_owned_by_a_local_thread_and_stops_only_on_explicit_request(tmp_path):
    client = Client()
    manager = CaptureManager(tmp_path, client, FakeAudio)
    try:
        result = manager.start("Teste", "mixed", {})
        assert result["recording"]
        assert result["job_id"] == "native-test-job"
        time.sleep(0.08)
        assert manager.status()["duration"] > 0
        with pytest.raises(RuntimeError, match="andamento"):
            manager.start("Outra", "system", {})
        manager.stop()
        assert not manager.status()["recording"]
        manager.deliver_once()
        assert len(client.uploaded) == 1
        assert len(client.stopped) == 1
    finally:
        manager.close()


def test_restart_replays_pending_files_without_restarting_the_audio_device(tmp_path):
    client = Client()
    first = CaptureManager(tmp_path, client, FakeAudio)
    first.start("Teste", "system", {})
    time.sleep(0.05)
    first.close()
    second = CaptureManager(tmp_path, client, lambda *_: pytest.fail("A microphone must never be restarted by recovery"))
    try:
        assert not second.status()["recording"]
        second.deliver_once()
        assert client.uploaded
        assert client.stopped
    finally:
        second.close()


def test_failed_server_start_releases_prepared_audio(tmp_path):
    client = Client()
    audio = FakeAudio()
    client.create = lambda *_: (_ for _ in ()).throw(ConnectionError())
    manager = CaptureManager(tmp_path, client, lambda *_: audio)
    with pytest.raises(ConnectionError):
        manager.start("Teste", "system", {})
    assert audio.closed
    assert not manager.status()["recording"]


def test_pcm_downmix_and_mixing_preserve_signed_samples_without_overflow():
    stereo = np.array([[30000, 10000], [-30000, -10000]], dtype="<i2").tobytes()
    assert np.frombuffer(mono_pcm(stereo, 2), dtype="<i2").tolist() == [20000, -20000]
    assert np.frombuffer(mix_pcm([stereo, stereo]), dtype="<i2").tolist() == [30000, 10000, -30000, -10000]
    assert mono_pcm(b"\0\0", 1) == b"\0\0"


def test_an_unavailable_old_session_does_not_block_delivery_of_other_recordings(tmp_path):
    client = Client()
    original = client.upload

    def upload(job_id, *args):
        if job_id == "old-job":
            raise ConnectionError("Old session unavailable")
        original(job_id, *args)

    client.upload = upload
    manager = CaptureManager(tmp_path, client, FakeAudio)
    for job_id in ["old-job", "new-job"]:
        session = SpoolSession.create(tmp_path, job_id, "Teste", "system")
        session.append(b"\0\0" * 16000)
        session.finish()
        manager.sessions.append(session)
    with pytest.raises(ConnectionError):
        manager.deliver_once()
    assert len(client.uploaded) == 1
    assert client.stopped[0][0] == "new-job"


def test_a_damaged_audio_file_is_preserved_and_reported_without_preventing_startup(tmp_path):
    session = SpoolSession.create(tmp_path, "damaged-job", "Teste", "system")
    damaged = session.directory / "000000.wav"
    damaged.write_bytes(b"invalid audio")
    manager = CaptureManager(tmp_path, Client(), FakeAudio)
    assert manager.status()["recovery_errors"] == 1
    assert damaged.read_bytes() == b"invalid audio"


def test_device_preparation_and_capture_run_on_the_same_windows_thread(tmp_path):
    class ThreadBoundAudio(FakeAudio):
        def prepare(self):
            self.owner = threading.get_ident()

        def run(self, consume, stop_event):
            assert threading.get_ident() == self.owner
            super().run(consume, stop_event)

        def close(self):
            assert threading.get_ident() == self.owner
            super().close()

    manager = CaptureManager(tmp_path, Client(), ThreadBoundAudio)
    try:
        manager.start("Teste", "system", {})
        time.sleep(0.05)
        manager.stop()
        assert manager.status()["error"] is None
        assert manager.status()["duration"] > 0
    finally:
        manager.close()
