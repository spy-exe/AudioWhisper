import os
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from audiowhisper_capture.audio import WindowsAudio

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Adaptador WASAPI do Windows")


@pytest.fixture
def portaudio(monkeypatch):
    devices = [
        {"index": 0, "name": "Saída", "hostApi": 0, "maxInputChannels": 0, "maxOutputChannels": 2, "defaultSampleRate": 48000},
        {"index": 1, "name": "Saída [Loopback]", "hostApi": 0, "maxInputChannels": 2, "maxOutputChannels": 0, "defaultSampleRate": 48000, "isLoopbackDevice": True},
        {"index": 2, "name": "Microfone", "hostApi": 0, "maxInputChannels": 1, "maxOutputChannels": 0, "defaultSampleRate": 48000},
    ]

    class Stream:
        def __init__(self, **options):
            self.options = options
            self.closed = False

        def start_stream(self):
            data = np.full(9600 * self.options["channels"], 1000, dtype="<i2").tobytes()
            self.options["stream_callback"](data, 9600, {}, 0)

        def is_active(self):
            return True

        def stop_stream(self):
            pass

        def close(self):
            self.closed = True

    class PortAudio:
        def __init__(self):
            self.streams = []
            self.terminated = False

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.terminate()

        def get_host_api_info_by_type(self, _kind):
            return {"index": 0, "defaultInputDevice": 2, "defaultOutputDevice": 0}

        def get_default_wasapi_loopback(self):
            return devices[1]

        def get_device_count(self):
            return len(devices)

        def get_device_info_by_index(self, index):
            return devices[index]

        def open(self, **options):
            stream = Stream(**options)
            self.streams.append(stream)
            return stream

        def terminate(self):
            self.terminated = True

    instance = PortAudio()
    monkeypatch.setitem(sys.modules, "pyaudiowpatch", SimpleNamespace(PyAudio=lambda: instance, paWASAPI=13,
                                                                   paInt16=8, paContinue=0, paInputOverflow=2))
    power = Mock(return_value=1)
    monkeypatch.setattr("audiowhisper_capture.audio.ctypes.windll", SimpleNamespace(kernel32=SimpleNamespace(SetThreadExecutionState=power)))
    return instance, power


@pytest.mark.parametrize("source", ["system", "mixed", "microphone"])
def test_wasapi_adapter_resamples_to_mono_and_releases_streams_and_sleep_guard(portaudio, source):
    instance, power = portaudio
    audio = WindowsAudio(source, microphone="2", output="1")
    audio.prepare()
    frames = []

    class Stop:
        calls = 0

        def is_set(self):
            self.calls += 1
            return self.calls > len(audio.inputs)

    audio.run(frames.append, Stop())
    samples = np.frombuffer(b"".join(frames), dtype="<i2")
    assert len(samples) == 3200
    assert np.all(samples == 1000)
    assert all(stream.closed for stream in instance.streams)
    assert instance.terminated
    assert power.call_args_list[0].args == (0x80000001,)
    assert power.call_args_list[-1].args == (0x80000000,)


def test_device_listing_excludes_loopback_from_microphones(portaudio):
    devices = WindowsAudio.devices()
    assert [d["id"] for d in devices["microphones"]] == ["2"]
    assert [d["id"] for d in devices["outputs"]] == ["1"]


def test_invalid_device_selection_closes_already_opened_streams(portaudio):
    instance, _power = portaudio
    with pytest.raises(ValueError, match="loopback"):
        WindowsAudio("system", output="0").prepare()
    assert instance.terminated


def test_overflow_is_reported_instead_of_silently_discarding_audio(portaudio):
    instance, _power = portaudio
    audio = WindowsAudio("system")
    audio.prepare()
    instance.streams[0].options["stream_callback"](b"\0\0" * 9600, 4800, {}, 2)
    with pytest.raises(RuntimeError, match="perdeu amostras"):
        audio.run(lambda _data: None, SimpleNamespace(is_set=lambda: False))
    assert instance.terminated
