# -*- coding: utf-8 -*-
"""开发 / 生产共用入口。

    python run.py                 # 生产：加载 ui/dist
    python run.py --dev           # 自动拉起 Vite，窗口连 localhost:5173
    python run.py --dev --port 5174 --no-spawn
    python run.py --debug         # 开 DevTools
"""
import argparse
import logging
import os
import socket
import subprocess
import sys
import time
from logging.handlers import RotatingFileHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from ds_saver.core import paths  # noqa: E402


def setup_logging(debug: bool) -> None:
    handlers = []
    try:
        os.makedirs(paths.log_dir(), exist_ok=True)
        handlers.append(RotatingFileHandler(
            os.path.join(paths.log_dir(), "app.log"),
            maxBytes=1024 * 1024, backupCount=3, encoding="utf-8"))
    except OSError:
        pass
    if debug or not getattr(sys, "frozen", False):
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        handlers=handlers,
    )


def port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def wait_port(port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(0.3)
    return False


def spawn_vite(port: int) -> subprocess.Popen:
    ui_dir = os.path.join(ROOT, "ui")
    process = subprocess.Popen(
        ["cmd", "/c", "npm", "run", "dev", "--", "--port", str(port), "--strictPort"],
        cwd=ui_dir,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    return process


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="连 Vite 开发服务器")
    parser.add_argument("--port", type=int, default=5173)
    parser.add_argument("--no-spawn", action="store_true", help="不自动拉起 Vite")
    parser.add_argument("--no-tray", action="store_true")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    # v5.3 布局迁移必须在日志 handler 打开前完成（否则旧 data\logs 被锁，搬不动）
    paths.migrate_legacy_layout()
    setup_logging(args.debug)

    dev_url = None
    vite = None
    if args.dev:
        if not args.no_spawn and not port_open(args.port):
            vite = spawn_vite(args.port)
        if not wait_port(args.port):
            print(f"Vite 没在 {args.port} 起来，检查 ui/ 依赖是否装好", file=sys.stderr)
            if vite:
                vite.terminate()
            return 2
        dev_url = f"http://localhost:{args.port}"

    from ds_saver.apphost import AppHost

    try:
        AppHost(dev_url=dev_url, debug=args.debug or args.dev, no_tray=args.no_tray).run()
    finally:
        if vite:
            vite.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
