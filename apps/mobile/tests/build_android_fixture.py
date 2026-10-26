"""Build an emulator-only player for the public speech fixture using the Android SDK."""
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).with_name("android-fixture")
OUTPUT = ROOT / ".devdata" / "mobile-qa-player"
SDK = Path(os.environ["ANDROID_HOME"])
JAVA = Path(os.environ["JAVA_HOME"]) / "bin"
TOOLS = SDK / "build-tools" / "36.0.0"
PLATFORM = SDK / "platforms" / "android-36" / "android.jar"


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True, cwd=OUTPUT)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name in ("assets", "classes", "dex"):
        (OUTPUT / name).mkdir(exist_ok=True)
    shutil.copyfile(ROOT / "apps/web/tests/e2e/fixtures/speech.wav", OUTPUT / "assets/speech.wav")
    run(JAVA / "javac.exe", "--release", "8", "-classpath", PLATFORM, "-d", "classes", SOURCE / "MainActivity.java")
    classes = list((OUTPUT / "classes").rglob("*.class"))
    run(TOOLS / "d8.bat", "--lib", PLATFORM, "--output", "dex", *classes)
    run(TOOLS / "aapt.exe", "package", "-f", "-M", SOURCE / "AndroidManifest.xml", "-I", PLATFORM,
        "-A", "assets", "-0", "wav", "-F", "unsigned.apk")
    with zipfile.ZipFile(OUTPUT / "unsigned.apk", "a") as archive:
        archive.write(OUTPUT / "dex/classes.dex", "classes.dex")
    run(TOOLS / "zipalign.exe", "-f", "4", "unsigned.apk", "player.apk")
    if not (OUTPUT / "qa.jks").exists():
        run(JAVA / "keytool.exe", "-genkeypair", "-keystore", "qa.jks", "-storepass", "android",
            "-keypass", "android", "-alias", "qa", "-dname", "CN=AudioWhisper QA", "-keyalg", "RSA", "-validity", "3650")
    run(TOOLS / "apksigner.bat", "sign", "--ks", "qa.jks", "--ks-pass", "pass:android", "--key-pass", "pass:android", "player.apk")
    run(TOOLS / "apksigner.bat", "verify", "player.apk")
    print(OUTPUT / "player.apk")
    probe = Path(__file__).with_name("android-probe")
    for name in ("probe-classes", "probe-dex"):
        (OUTPUT / name).mkdir(exist_ok=True)
    run(JAVA / "javac.exe", "--release", "8", "-classpath", PLATFORM, "-d", "probe-classes", probe / "DumpRunner.java")
    run(TOOLS / "d8.bat", "--lib", PLATFORM, "--output", "probe-dex", *list((OUTPUT / "probe-classes").rglob("*.class")))
    run(TOOLS / "aapt.exe", "package", "-f", "-M", probe / "AndroidManifest.xml", "-I", PLATFORM, "-F", "probe-unsigned.apk")
    with zipfile.ZipFile(OUTPUT / "probe-unsigned.apk", "a") as archive:
        archive.write(OUTPUT / "probe-dex/classes.dex", "classes.dex")
    run(TOOLS / "zipalign.exe", "-f", "4", "probe-unsigned.apk", "probe.apk")
    run(TOOLS / "apksigner.bat", "sign", "--ks", "qa.jks", "--ks-pass", "pass:android", "--key-pass", "pass:android", "probe.apk")
    run(TOOLS / "apksigner.bat", "verify", "probe.apk")
    print(OUTPUT / "probe.apk")
