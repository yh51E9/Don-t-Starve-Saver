# -*- coding: utf-8 -*-
"""生成 exe 图标与自检预览图。图标源 = backend/ds_saver/assets/icon.png
（游戏内 Wilson 头像 + 深色圆底，构建前由头像管线生成）。

    python packaging/make_icon.py

产物：
    packaging/icon.ico      16–256 多尺寸
    packaging/preview.png   亮/暗两种底色并排，肉眼检查 16px 可辨识度
"""
import io
import os
import struct
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from ds_saver.platform.icons import load_icon  # noqa: E402

SIZES = [16, 24, 32, 48, 64, 128, 256]
OUT_ICO = os.path.join(ROOT, "packaging", "icon.ico")
OUT_PREVIEW = os.path.join(ROOT, "packaging", "preview.png")


def write_ico(path: str) -> None:
    payloads = []
    for size in SIZES:
        buffer = io.BytesIO()
        load_icon(size).save(buffer, format="PNG")
        payloads.append((size, buffer.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(payloads))
    offset = 6 + 16 * len(payloads)
    entries = b""
    data = b""
    for size, png in payloads:
        dimension = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(png), offset)
        offset += len(png)
        data += png
    with open(path, "wb") as fh:
        fh.write(header + entries + data)


def write_preview(path: str) -> None:
    band_h = 210
    width = 900
    canvas = Image.new("RGBA", (width, band_h * 2), (238, 241, 244, 255))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, band_h, width, band_h * 2), fill=(29, 31, 34, 255))

    x = 40
    for size in [128, 64, 48, 32, 24, 16]:
        icon = load_icon(size)
        for index, top in enumerate((0, band_h)):
            cy = top + band_h // 2
            canvas.alpha_composite(icon, (x, cy - size // 2))
        draw.text((x, band_h - 22), str(size), fill=(70, 78, 88, 255))
        draw.text((x, band_h * 2 - 22), str(size), fill=(180, 188, 198, 255))
        x += size + 60

    canvas.convert("RGB").save(path)


def main() -> int:
    write_ico(OUT_ICO)
    write_preview(OUT_PREVIEW)
    print("wrote", OUT_ICO)
    print("wrote", OUT_PREVIEW)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
