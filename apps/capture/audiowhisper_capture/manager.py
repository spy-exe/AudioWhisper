import logging
import threading
import time
import wave
from pathlib import Path

import numpy as np

from .audio import WindowsAudio
from .spool import SpoolSession

logger = logging.getLogger(__name__)


class CaptureManager:
    def __init__(self, root, client, audio_factory=WindowsAudio):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.client, self.audio_factory = client, audio_factory
        self.lock = threading.RLock()
        self.sessions = []
        self.current = None
        self.audio = None
        self.thread = None
        self.stopping = threading.Event()
        self.shutdown = threading.Event()
        self.level = 0
        self.delivery_error = None
        self.recovery_errors = 0
        for path in sorted(self.root.glob("*/session.json"), key=lambda p: p.stat().st_mtime):
            try:
                self.sessions.append(SpoolSession.load(path.parent))
            except (OSError, ValueError, KeyError, wave.Error, EOFError):
                self.recovery_errors += 1
                logger.error("Uma captura local requer recuperação manual; arquivos preservados")
        if self.sessions:
            self.current = self.sessions[-1]

    def status(self):
        with self.lock:
            snapshot = self.current.snapshot() if self.current else {}
            return {"version": "1.0.0", "recording": bool(self.thread and self.thread.is_alive()),
                    "sleep_protected": bool(self.audio and self.audio.power_protected), "level": self.level,
                    "delivery_error": self.delivery_error, "recovery_errors": self.recovery_errors,
                    "pending_total": sum(s.snapshot()["pending_chunks"] for s in self.sessions), **snapshot}

    def start(self, title, source, settings, microphone="", output="", prevent_sleep=True):
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise RuntimeError("Já existe uma gravação em andamento no Windows")
            audio = self.audio_factory(source, microphone, output, prevent_sleep)
            audio.prepare()
            try:
                job_id = self.client.create(title, source, settings)
                try:
                    session = SpoolSession.create(self.root, job_id, title, source)
                except Exception:
                    self.client.stop(job_id, 0, 0)
                    raise
            except Exception:
                audio.close()
                raise
            self.current, self.audio = session, audio
            self.sessions.append(session)
            self.stopping.clear()
            self.thread = threading.Thread(target=self.record, args=(session, audio), name="AudioWhisper-capture", daemon=False)
            self.thread.start()
            return self.status()

    def record(self, session, audio):
        error = None

        def consume(data):
            session.append(data)
            samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
            self.level = min(1, float(np.sqrt(np.mean(samples * samples))) * 12) if samples.size else 0
            if session.snapshot()["duration"] >= 86395:
                self.stopping.set()

        try:
            audio.run(consume, self.stopping)
        except Exception:
            error = "A entrada foi interrompida. Os trechos salvos serão processados; verifique os dispositivos antes de iniciar outra gravação."
            logger.exception("A captura de áudio foi interrompida")
        finally:
            try:
                session.finish(error)
            except Exception:
                session.manifest["error"] = "Falha ao consolidar o arquivo local. Libere espaço em disco; os arquivos de recuperação foram preservados."
                logger.exception("Falha ao consolidar a captura local")
            self.level = 0

    def stop(self):
        with self.lock:
            thread = self.thread
            self.stopping.set()
        if thread and thread is not threading.current_thread():
            thread.join(timeout=15)
        return self.status()

    def deliver_once(self):
        with self.lock:
            sessions = list(self.sessions)
        failure = None
        for session in sessions:
            if session.snapshot()["state"] != "uploaded":
                try:
                    session.deliver(self.client)
                except Exception as error:
                    failure = error
        if failure:
            raise failure

    def deliver_forever(self):
        delay = 1
        while not self.shutdown.is_set():
            try:
                self.deliver_once()
                self.delivery_error = None
                delay = 1
            except Exception:
                self.delivery_error = "Conexão com o Studio indisponível. O áudio continua salvo no Windows e será reenviado automaticamente."
                delay = min(30, max(2, delay * 2))
            self.shutdown.wait(delay)

    def close(self):
        self.stop()
        self.shutdown.set()
