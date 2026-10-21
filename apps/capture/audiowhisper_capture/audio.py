import audioop
import ctypes
import os
import queue
import threading
import time

import numpy as np


def mono_pcm(data, channels):
    if channels == 1:
        return data
    samples = np.frombuffer(data, dtype="<i2").reshape(-1, channels)
    return np.rint(samples.astype(np.float32).mean(axis=1)).astype("<i2").tobytes()


def mix_pcm(parts):
    arrays = [np.frombuffer(data, dtype="<i2").astype(np.float32) for data in parts]
    return np.rint(sum(arrays) / len(arrays)).clip(-32768, 32767).astype("<i2").tobytes()


class WindowsAudio:
    def __init__(self, source, microphone="", output="", prevent_sleep=True):
        self.source, self.microphone, self.output = source, microphone, output
        self.prevent_sleep = prevent_sleep
        self.power_protected = False
        self.streams = []
        self.inputs = []
        self.p = None
        self.incoming = queue.Queue(maxsize=500)
        self.failure = None

    @staticmethod
    def devices():
        import pyaudiowpatch as pa
        with pa.PyAudio() as p:
            api = p.get_host_api_info_by_type(pa.paWASAPI)
            all_devices = [p.get_device_info_by_index(i) for i in range(p.get_device_count())]
            microphones = [{"id": str(d["index"]), "name": d["name"],
                            "default": d["index"] == api["defaultInputDevice"]}
                           for d in all_devices if d["hostApi"] == api["index"] and d["maxInputChannels"] > 0 and not d.get("isLoopbackDevice")]
            default = p.get_default_wasapi_loopback()
            outputs = [{"id": str(d["index"]), "name": d["name"], "default": d["index"] == default["index"]}
                       for d in all_devices if d.get("isLoopbackDevice")]
            return {"microphones": microphones, "outputs": outputs}

    def prepare(self):
        if os.name != "nt":
            raise RuntimeError("O capturador requer Windows com WASAPI")
        import pyaudiowpatch as pa
        self.pa = pa
        self.p = pa.PyAudio()
        try:
            api = self.p.get_host_api_info_by_type(pa.paWASAPI)
            if self.source in ("system", "mixed"):
                device = self.p.get_device_info_by_index(int(self.output)) if self.output else self.p.get_default_wasapi_loopback()
                if not device.get("isLoopbackDevice"):
                    raise ValueError("Selecione uma saída WASAPI com loopback")
                self.add_input(device)
                # Keep shared-mode loopback clocks moving even when applications are silent.
                render = self.p.get_device_info_by_index(int(api["defaultOutputDevice"]))
                if self.output:
                    candidates = [self.p.get_device_info_by_index(i) for i in range(self.p.get_device_count())]
                    render = next((d for d in candidates if d["hostApi"] == api["index"] and d["maxOutputChannels"] > 0
                                   and device["name"].startswith(d["name"])), render)
                channels = min(2, int(render["maxOutputChannels"]))
                self.streams.append(self.p.open(format=pa.paInt16, channels=channels, rate=int(render["defaultSampleRate"]),
                    output=True, output_device_index=int(render["index"]), start=False,
                    stream_callback=lambda _data, count, _time, _status: (b"\0" * count * channels * 2, pa.paContinue)))
            if self.source != "system":
                index = int(self.microphone) if self.microphone else int(api["defaultInputDevice"])
                device = self.p.get_device_info_by_index(index)
                if device.get("isLoopbackDevice") or device["maxInputChannels"] < 1 or device["hostApi"] != api["index"]:
                    raise ValueError("Selecione um microfone ou entrada virtual WASAPI")
                self.add_input(device)
        except Exception:
            self.close()
            raise

    def add_input(self, device):
        pa = self.pa
        index = len(self.inputs)
        info = {"channels": int(device["maxInputChannels"]), "rate": int(device["defaultSampleRate"]),
                "pending": bytearray(), "resampler": None, "last": time.monotonic()}
        self.inputs.append(info)

        def callback(data, _count, _time, status):
            if status & pa.paInputOverflow:
                self.failure = "A entrada de áudio perdeu amostras. A captura foi encerrada para preservar os trechos íntegros."
            try:
                self.incoming.put_nowait((index, data))
            except queue.Full:
                self.failure = "O disco não acompanhou a captura. O áudio já salvo foi preservado."
            return None, pa.paContinue

        self.streams.append(self.p.open(format=pa.paInt16, channels=info["channels"], rate=info["rate"],
            input=True, input_device_index=int(device["index"]), frames_per_buffer=round(info["rate"] / 10),
            start=False, stream_callback=callback))

    def run(self, consume, stop_event):
        try:
            if self.prevent_sleep:
                self.power_protected = bool(ctypes.windll.kernel32.SetThreadExecutionState(0x80000001))
            for stream in self.streams:
                stream.start_stream()
            while not stop_event.is_set():
                try:
                    self.accept(self.incoming.get(timeout=0.25), consume)
                except queue.Empty:
                    pass
                if self.failure:
                    raise RuntimeError(self.failure)
                if any(time.monotonic() - source["last"] > 5 for source in self.inputs):
                    raise RuntimeError("Uma entrada deixou de fornecer áudio. Verifique o dispositivo antes de iniciar outra captura.")
                if any(not stream.is_active() for stream in self.streams):
                    raise RuntimeError("Um dispositivo de áudio foi desconectado. O áudio já salvo foi preservado.")
        finally:
            self.close()
            while not self.incoming.empty():
                self.accept(self.incoming.get_nowait(), consume)
            tail = max((len(source["pending"]) for source in self.inputs), default=0)
            if tail:
                consume(mix_pcm([bytes(source["pending"]).ljust(tail, b"\0") for source in self.inputs]))
            if self.prevent_sleep:
                ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
                self.power_protected = False

    def accept(self, packet, consume):
        index, data = packet
        source = self.inputs[index]
        source["last"] = time.monotonic()
        data = mono_pcm(data, source["channels"])
        resampled, source["resampler"] = audioop.ratecv(data, 2, 1, source["rate"], 16000, source["resampler"])
        source["pending"].extend(resampled)
        while all(len(item["pending"]) >= 3200 for item in self.inputs):
            consume(mix_pcm([bytes(item["pending"][:3200]) for item in self.inputs]))
            for item in self.inputs:
                del item["pending"][:3200]
        if any(len(item["pending"]) > 320000 for item in self.inputs):
            raise RuntimeError("As entradas perderam a sincronização. Os trechos já capturados foram preservados.")

    def close(self):
        for stream in self.streams:
            try:
                stream.stop_stream()
                stream.close()
            except OSError:
                pass
        self.streams = []
        if self.p:
            self.p.terminate()
            self.p = None
