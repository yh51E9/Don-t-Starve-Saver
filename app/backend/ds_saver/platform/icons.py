# -*- coding: utf-8 -*-
"""应用图标：游戏内 Wilson 头像 + 深色圆底。

图片由打包前预生成（backend/ds_saver/assets/icon.png），
运行时只负责按尺寸加载——不再在代码里画猪人。
"""
import os

from PIL import Image

from ..core import paths

_FALLBACK = Image.new("RGBA", (64, 64), (32, 35, 40, 255))


def load_icon(size: int = 64) -> Image.Image:
    try:
        with Image.open(os.path.join(paths.assets_dir(), "icon.png")) as source:
            return source.convert("RGBA").resize((size, size), Image.LANCZOS)
    except OSError:
        return _FALLBACK.copy()
