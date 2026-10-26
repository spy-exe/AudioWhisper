"""Small emulator driver. All commands are pinned to the disposable QA emulator."""
import json
import base64
import os
import re
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ADB = Path(os.environ.get("ANDROID_HOME", str(ROOT / ".devdata/android-sdk"))) / "platform-tools/adb.exe"
SERIAL = "emulator-5554"
PACKAGE = "studio.audiowhisper.mobile"
OUTPUT = ROOT / ".devdata/qa/mobile"


def adb(*args, binary=False):
    result = subprocess.run([str(ADB), "-s", SERIAL, *args], check=True, capture_output=True)
    return result.stdout if binary else result.stdout.decode("utf-8", errors="replace").strip()


def guard():
    if adb("shell", "getprop", "ro.kernel.qemu") != "1":
        raise RuntimeError("Refusing a physical device")
    with urllib.request.urlopen("http://localhost:8090/api/health", timeout=10) as response:
        if json.load(response).get("environment") != "e2e":
            raise RuntimeError("Refusing a personal library")
    OUTPUT.mkdir(parents=True, exist_ok=True)


def tree():
    result = adb("shell", "am", "instrument", "-w", "studio.audiowhisper.qaprobe/.DumpRunner")
    encoded = next((line.split("tree=", 1)[1] for line in result.splitlines() if line.startswith("INSTRUMENTATION_RESULT: tree=")), None)
    if not encoded:
        raise RuntimeError("Could not obtain a fresh hierarchy: " + result)
    raw = base64.b64decode(encoded).decode("utf-8")
    (OUTPUT / "current-ui.xml").write_text(raw, encoding="utf-8")
    return ET.fromstring(raw)


def center(node):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", node.attrib["bounds"]))
    return (x1 + x2) // 2, (y1 + y2) // 2


def click(label, *, contains=False):
    def find():
        below = False
        for node in tree().iter("node"):
            values = [node.attrib.get("text", ""), node.attrib.get("content-desc", "")]
            if (any(label in value for value in values) if contains else label in values):
                bounds = list(map(int, re.findall(r"-?\d+", node.attrib["bounds"])))
                if bounds[0] < bounds[2] and bounds[1] < bounds[3]:
                    return node
                below = bounds[1] >= bounds[3]
        if below:
            width, height = map(int, re.findall(r"\d+", adb("shell", "wm", "size"))[-2:])
            adb("shell", "input", "swipe", str(width // 2), str(int(height * .65)), str(width // 2), str(int(height * .3)), "350")
        return None
    node = wait_for(find, 12)
    adb("shell", "input", "tap", *map(str, center(node)))


def fill(label, value):
    field = wait_for(lambda: next((node for node in tree().iter("node") if node.attrib.get("class") == "android.widget.EditText" and node.attrib.get("content-desc") == label), None), 12)
    adb("shell", "input", "tap", *map(str, center(field)))
    adb("shell", "input", "keycombination", "113", "29")
    adb("shell", "input", "keyevent", "67")
    adb("shell", "input", "text", value.replace(" ", "%s"))
    field = next(node for node in tree().iter("node") if node.attrib.get("class") == "android.widget.EditText" and node.attrib.get("content-desc") == label)
    assert field.attrib.get("text") == value, "Input was not updated"


def hide_keyboard():
    if "mInputShown=true" in adb("shell", "dumpsys", "input_method"):
        adb("shell", "input", "keyevent", "4")


def shot(name):
    path = OUTPUT / (name + ".png")
    path.write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    return str(path)


def sessions():
    directory = f"/data/user/0/{PACKAGE}/files/audiowhisper/recordings"
    result = []
    for entry in adb("shell", "ls", directory).splitlines():
        if re.fullmatch(r"[a-f0-9-]{36}", entry):
            value = json.loads(adb("exec-out", "cat", f"{directory}/{entry}/session.json"))
            result.append(value)
    return sorted(result, key=lambda value: value["created_at"], reverse=True)


def wait_for(check, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if isinstance(value, ET.Element) or value:
            return value
        time.sleep(1)
    raise AssertionError("Timed out waiting for emulator state")


if __name__ == "__main__":
    guard()
    print(shot("current"))
    for node in tree().iter("node"):
        values = [node.attrib.get("text"), node.attrib.get("content-desc")]
        if any(values):
            print(node.attrib.get("class"), node.attrib.get("bounds"), repr(values))
