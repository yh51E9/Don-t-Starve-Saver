# -*- coding: utf-8 -*-
r"""兜底素材链：未知角色问号头像等"图片库兜底"素材。

三级来源（设计共识：代码不内嵌任何图片，素材一律落盘）：
  1. data/images/fallback/ 里已有文件 → 直接用
  2. exe assets/avatars/unknown.png（官方预生成）→ 拷贝落盘
  3. 网络拉取（Klei/Steam CDN 候选地址，逐个试）→ 落盘
三级都失败：调用方回落首字母占位。
"""
import base64
import io
import os
import urllib.request

from . import paths

FALLBACK_DIR_NAME = "images/fallback"
UNKNOWN_FILE = "unknown.png"

# 网络兜底候选：官方 Wiki 的问号头像（best-effort，全挂就算了）
NETWORK_SOURCES = (
    "https://static.wikia.nocookie.net/dontstarve_game_gamepedia_en/images/d/da/Unknown.png",
)


def fallback_dir() -> str:
    return paths.data_dir(FALLBACK_DIR_NAME)


def unknown_path() -> str:
    return os.path.join(fallback_dir(), UNKNOWN_FILE)


def _official_unknown() -> str | None:
    from . import avatars

    path = os.path.join(avatars.official_dir(), UNKNOWN_FILE)
    return path if os.path.isfile(path) else None


def _save(png_bytes: bytes) -> bytes:
    os.makedirs(fallback_dir(), exist_ok=True)
    path = unknown_path()
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(png_bytes)
    os.replace(tmp, path)
    return png_bytes


def ensure_unknown(game_dir: str | None = None) -> dict:
    """确保 unknown.png 就位，返回 {ok, source, url?}。"""
    path = unknown_path()
    if os.path.isfile(path):
        try:
            with open(path, "rb") as fh:
                return {"ok": True, "source": "file", "url": _data_url(fh.read())}
        except OSError:
            pass

    # ② 官方预生成（assets/avatars/unknown.png）→ 拷贝落盘
    official = _official_unknown()
    if official:
        try:
            with open(official, "rb") as fh:
                return {"ok": True, "source": "official", "url": _data_url(_save(fh.read()))}
        except OSError:
            pass

    # ③ 网络
    for url in NETWORK_SOURCES:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310 - 固定白名单地址
                data = resp.read(512 * 1024)
            if data[:8] == b"\x89PNG\r\n\x1a\n":
                return {"ok": True, "source": "network", "url": _data_url(_save(data))}
        except Exception:
            continue
    return {"ok": False, "source": "none", "url": ""}


def _data_url(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
