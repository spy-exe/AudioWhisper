import json
import os
import shutil
import threading
import time
import uuid
import wave
from pathlib import Path


class SpoolSession:
    """PCM journal -> atomic WAV -> durable upload acknowledgement. Never deletes WAVs."""

    chunk_bytes = 5 * 32000

    def __init__(self, directory, manifest):
        self.directory = Path(directory)
        self.manifest = manifest
        self.chunks = []
        self.lock = threading.RLock()
        self.writer = None
        self.buffer_bytes = 0
        self.last_sync = 0

    @classmethod
    def create(cls, root, job_id, title, source):
        directory = Path(root) / str(uuid.uuid4())
        directory.mkdir(parents=True)
        session = cls(directory, {"job_id": job_id, "title": title, "source": source,
                                  "state": "recording", "uploaded": [], "error": None})
        session.save()
        return session

    @classmethod
    def load(cls, directory):
        session = cls(directory, json.loads(Path(directory, "session.json").read_text(encoding="utf-8")))
        for pcm in sorted(session.directory.glob("[0-9][0-9][0-9][0-9][0-9][0-9].pcm")):
            destination = pcm.with_suffix(".wav")
            if not destination.exists():
                data = pcm.read_bytes()
                if len(data) >= 2:
                    session.write_wav(destination, data[:len(data) // 2 * 2])
            pcm.unlink()
        start = 0.0
        for path in sorted(session.directory.glob("[0-9][0-9][0-9][0-9][0-9][0-9].wav")):
            with wave.open(str(path)) as audio:
                if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (16000, 1, 2):
                    raise ValueError("Formato inválido no arquivo de recuperação")
                duration = audio.getnframes() / 16000
            sequence = int(path.stem)
            if sequence != len(session.chunks):
                raise ValueError("Trecho ausente na captura preservada")
            session.chunks.append({"sequence": sequence, "start": start, "duration": duration})
            start += duration
        if session.manifest["state"] == "recording":
            session.manifest.update(state="stopping", error="Captura interrompida. O áudio preservado será reenviado; a entrada não é reiniciada automaticamente.")
        session.save()
        return session

    @staticmethod
    def write_wav(path, data):
        temporary = path.with_suffix(".tmp")
        with temporary.open("wb") as target:
            with wave.open(target, "wb") as audio:
                audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                audio.writeframes(data)
            target.flush()
            os.fsync(target.fileno())
        temporary.replace(path)

    def save(self):
        with self.lock:
            temporary = self.directory / "session.tmp"
            with temporary.open("w", encoding="utf-8") as target:
                json.dump(self.manifest, target, ensure_ascii=False)
                target.flush()
                os.fsync(target.fileno())
            temporary.replace(self.directory / "session.json")

    def append(self, data):
        if len(data) % 2:
            raise ValueError("PCM incompleto")
        with self.lock:
            if self.manifest["state"] != "recording":
                raise RuntimeError("Captura encerrada")
            while data:
                if self.writer is None:
                    self.writer = (self.directory / f"{len(self.chunks):06d}.pcm").open("ab")
                size = min(len(data), self.chunk_bytes - self.buffer_bytes)
                self.writer.write(data[:size])
                self.writer.flush()
                self.buffer_bytes += size
                data = data[size:]
                if time.monotonic() - self.last_sync >= 1:
                    os.fsync(self.writer.fileno())
                    self.last_sync = time.monotonic()
                    if shutil.disk_usage(self.directory).free < 64 * 1024 * 1024:
                        raise OSError("Espaço em disco insuficiente para continuar a gravação")
                if self.buffer_bytes == self.chunk_bytes:
                    self.commit_chunk()

    def commit_chunk(self):
        if not self.buffer_bytes:
            return
        self.writer.flush()
        os.fsync(self.writer.fileno())
        self.writer.close()
        self.writer = None
        sequence = len(self.chunks)
        pcm = self.directory / f"{sequence:06d}.pcm"
        self.write_wav(pcm.with_suffix(".wav"), pcm.read_bytes())
        self.chunks.append({"sequence": sequence, "start": sum(c["duration"] for c in self.chunks),
                            "duration": self.buffer_bytes / 32000})
        self.buffer_bytes = 0
        pcm.unlink()
        self.save()

    def finish(self, error=None):
        with self.lock:
            self.commit_chunk()
            self.manifest["state"] = "stopping"
            if error:
                self.manifest["error"] = error
            self.save()

    def snapshot(self):
        with self.lock:
            return {**self.manifest, "duration": sum(c["duration"] for c in self.chunks) + self.buffer_bytes / 32000,
                    "pending_chunks": len(self.chunks) - len(self.manifest["uploaded"])}

    def deliver(self, client):
        with self.lock:
            chunks = [dict(c) for c in self.chunks if c["sequence"] not in self.manifest["uploaded"]]
        for chunk in chunks:
            sequence = chunk["sequence"]
            client.upload(self.manifest["job_id"], sequence, chunk["start"], self.directory / f"{sequence:06d}.wav")
            with self.lock:
                if sequence not in self.manifest["uploaded"]:
                    self.manifest["uploaded"].append(sequence)
                self.save()
        with self.lock:
            ready = self.manifest["state"] == "stopping" and len(self.manifest["uploaded"]) == len(self.chunks)
            count, duration = len(self.chunks), sum(c["duration"] for c in self.chunks)
        if ready:
            client.stop(self.manifest["job_id"], count, duration)
            with self.lock:
                self.manifest["state"] = "uploaded"
                self.save()
