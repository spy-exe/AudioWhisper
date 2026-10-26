"""Run against the signed APK and QA player/probe already installed in emulator-5554."""
import unittest
import json
import time
import urllib.request

from android_device import PACKAGE, adb, click, fill, guard, hide_keyboard, sessions, shot, tree, wait_for


def visible_text(text):
    return any(node.attrib.get("text") == text for node in tree().iter("node"))


class AndroidCompanionFlow(unittest.TestCase):
    def setUp(self):
        guard()
        self.assertFalse(any(item["state"] == "recording" for item in sessions()), "Stop the previous QA recording first")
        self.before_ids = {item["id"] for item in sessions()}
        adb("shell", "am", "force-stop", PACKAGE)

    def tearDown(self):
        if not hasattr(self, "before_ids"):
            return
        adb("shell", "svc", "wifi", "enable")
        adb("shell", "svc", "data", "enable")
        if any(item["state"] == "recording" and item["id"] not in self.before_ids for item in sessions()):
            adb("shell", "am", "force-stop", PACKAGE)
            adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        adb("shell", "am", "force-stop", "studio.audiowhisper.qaaudio")

    def test_stop_stays_available_while_a_connection_times_out(self):
        guard()
        self.assertFalse(any(item["state"] == "recording" for item in sessions()))
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        click("Gravar")
        fill("Título da gravação", "QA stop during network request")
        hide_keyboard()
        click("Microfone")
        click("Iniciar gravação")
        item = wait_for(lambda: next((item for item in sessions() if item["id"] not in self.before_ids and item["title"] == "QA stop during network request" and item["chunks"] >= 1), None))
        try:
            click("Conexão")
            wait_for(lambda: visible_text("Use a rede local ou o endereço da sua VPN."))
            click("Alterar conexão")
            fill("Endereço do PC", "http://10.0.2.250:8090")
            hide_keyboard()
            click("Testar e conectar")
            button = next(node for node in tree().iter("node") if node.attrib.get("content-desc") == "Encerrar gravação")
            self.assertEqual("true", button.attrib.get("enabled"), "Network activity disabled the stop control")
            started = time.monotonic()
            click("Encerrar gravação")
            wait_for(lambda: next((state for state in sessions() if state["id"] == item["id"] and state["state"] == "stopped"), None), 6)
            self.assertLess(time.monotonic() - started, 6)
        finally:
            if any(state["state"] == "recording" for state in sessions()):
                adb("shell", "cmd", "statusbar", "expand-notifications")
                click("ENCERRAR GRAVAÇÃO")
                adb("shell", "cmd", "statusbar", "collapse")

    def test_mixed_live_audio_offline_delivery_and_crash_recovery(self):
        guard()
        self.assertFalse(any(item["state"] == "recording" for item in sessions()), "Stop the previous QA recording first")
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        click("Conexão")
        wait_for(lambda: visible_text("Use a rede local ou o endereço da sua VPN."))
        if visible_text("Alterar conexão"):
            click("Alterar conexão")
        fill("Endereço do PC", "http://10.0.2.2:8090")
        hide_keyboard()
        click("Testar e conectar")
        wait_for(lambda: visible_text("PC configurado"))
        click("Gravar")
        fill("Título da gravação", "QA mixed live flow")
        hide_keyboard()
        click("Microfone e áudio dos aplicativos")
        click("Iniciar gravação")
        if visible_text("A single app"):
            click("A single app")
            click("Entire screen")
        click("START")
        recording = wait_for(lambda: next((item for item in sessions() if item["id"] not in self.before_ids and item["title"] == "QA mixed live flow" and item["chunks"] > 0), None))
        self.assertEqual("recording", recording["state"])
        self.assertEqual("mixed", recording["source"])
        adb("shell", "am", "start", "-W", "-n", "studio.audiowhisper.qaaudio/.MainActivity")
        click("PLAY SYNTHETIC SPEECH")

        def live_text():
            item = next(item for item in sessions() if item["id"] == recording["id"])
            if not item.get("job_id"):
                return None
            with urllib.request.urlopen("http://localhost:8090/api/companion/captures/" + item["job_id"] + "/transcript", timeout=5) as response:
                return json.load(response)["segments"] or None

        self.assertTrue(wait_for(live_text, 90))
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        wait_for(lambda: visible_text("Gravando neste aparelho"))
        shot("mixed-live")
        try:
            adb("shell", "svc", "wifi", "disable")
            adb("shell", "svc", "data", "disable")
            time.sleep(3)
            before = sessions()[0]
            time.sleep(12)
            after = sessions()[0]
            self.assertEqual("recording", after["state"])
            self.assertGreater(after["chunks"], before["chunks"])
            self.assertEqual(after["uploaded_chunks"], before["uploaded_chunks"])
        finally:
            adb("shell", "svc", "wifi", "enable")
            adb("shell", "svc", "data", "enable")
        wait_for(lambda: sessions()[0]["uploaded_chunks"] >= after["chunks"], 90)
        adb("shell", "cmd", "statusbar", "expand-notifications")
        click("ENCERRAR GRAVAÇÃO")
        wait_for(lambda: sessions()[0]["state"] == "stopped")
        adb("shell", "cmd", "statusbar", "collapse")
        adb("shell", "am", "force-stop", "studio.audiowhisper.qaaudio")

        click("Gravar")
        fill("Título da gravação", "QA interrupted microphone")
        hide_keyboard()
        click("Microfone")
        click("Iniciar gravação")
        microphone = wait_for(lambda: next((item for item in sessions() if item["id"] not in self.before_ids and item["title"] == "QA interrupted microphone" and item["chunks"] >= 2), None))
        adb("shell", "input", "keyevent", "223")
        time.sleep(8)
        self.assertGreater(sessions()[0]["chunks"], microphone["chunks"])
        adb("shell", "input", "keyevent", "224")
        adb("shell", "wm", "dismiss-keyguard")
        adb("shell", "am", "force-stop", PACKAGE)
        adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")
        recovered = wait_for(lambda: next((item for item in sessions() if item["id"] == microphone["id"] and item["state"] == "stopped"), None))
        self.assertTrue(recovered["interrupted"])
        self.assertGreaterEqual(recovered["chunks"], microphone["chunks"])
        self.assertGreater(recovered["frames"], 0)
        click("Gravações")
        wait_for(lambda: visible_text("Áudio guardado neste aparelho e texto do seu PC."))
        shot("e2e-recordings")


if __name__ == "__main__":
    unittest.main(verbosity=2)
