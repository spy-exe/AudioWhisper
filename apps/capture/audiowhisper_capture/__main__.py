import argparse
import logging
import os
import threading
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from .client import StudioClient
from .manager import CaptureManager
from .server import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default="http://127.0.0.1:8080")
    parser.add_argument("--origin", action="append", default=["http://localhost:8080", "http://127.0.0.1:8080"])
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("LOCALAPPDATA", ".")) / "AudioWhisper" / "captures")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--no-tray", action="store_true")
    args = parser.parse_args()
    if args.env_file:
        load_dotenv(args.env_file, override=False)
    args.data_dir.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=args.data_dir.parent / "capture.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", encoding="utf-8")
    client = StudioClient(args.api_url, os.environ.get("ACCESS_TOKEN", ""))
    studio_url = client.url.replace("127.0.0.1", "localhost")
    origins = list(dict.fromkeys([*args.origin, client.url, studio_url]))
    manager = CaptureManager(args.data_dir, client)
    sender = threading.Thread(target=manager.deliver_forever, name="AudioWhisper-delivery", daemon=True)
    sender.start()
    server = uvicorn.Server(uvicorn.Config(create_app(manager, origins), host="127.0.0.1", port=8765,
                                           log_config=None, access_log=False))
    socket = server.config.bind_socket()
    if args.no_tray:
        try:
            server.run(sockets=[socket])
        finally:
            manager.close()
        return
    import pystray
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (64, 64), "#141e30")
    draw = ImageDraw.Draw(image)
    for x, height in [(16, 14), (24, 30), (32, 44), (40, 26), (48, 12)]:
        draw.line((x, 32 - height // 2, x, 32 + height // 2), fill="#9bc7ff", width=4)

    def exit_app(icon, _item):
        manager.close()
        server.should_exit = True
        icon.stop()

    def caption(_item):
        return "● Gravando no Windows" if manager.status()["recording"] else "AudioWhisper · Pronto"

    menu = pystray.Menu(
        pystray.MenuItem(caption, lambda: None, enabled=False),
        pystray.MenuItem("Abrir Studio", lambda: webbrowser.open(studio_url + "/?capture=windows"), default=True),
        pystray.MenuItem("Encerrar gravação", lambda: manager.stop(), enabled=lambda _item: manager.status()["recording"]),
        pystray.MenuItem("Abrir pasta de recuperação", lambda: os.startfile(args.data_dir)),
        pystray.MenuItem("Sair", exit_app),
    )
    server_thread = threading.Thread(target=lambda: server.run(sockets=[socket]), name="AudioWhisper-local-api", daemon=True)
    server_thread.start()
    try:
        icon = pystray.Icon("AudioWhisper", image, "AudioWhisper · Capturador Windows", menu)

        def update_indicator():
            previous = None
            while not manager.shutdown.wait(1):
                recording = manager.status()["recording"]
                icon.title = "AudioWhisper · Gravando no Windows" if recording else "AudioWhisper · Capturador pronto"
                if previous != recording:
                    active_image = image.copy()
                    if recording:
                        ImageDraw.Draw(active_image).ellipse((42, 42, 60, 60), fill="#ff9ba7")
                    icon.icon = active_image
                    icon.update_menu()
                    previous = recording

        threading.Thread(target=update_indicator, name="AudioWhisper-tray-status", daemon=True).start()
        icon.run()
    finally:
        manager.close()
        server.should_exit = True
        server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
