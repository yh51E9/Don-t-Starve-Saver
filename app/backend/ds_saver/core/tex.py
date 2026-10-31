# -*- coding: utf-8 -*-
"""Klei KTEX 纹理解码。

格式（对照 ktools / Stexatlaser 的说明，并用本机样本实测）：
    0x00  b"KTEX"
    0x04  uint32 specs（平台/像素格式/纹理类型/mip 数/标志，按位打包）
    0x08  MipMetadata[n]：u16 width, u16 height, u16 pitch, u32 data_size（10 字节/条）
    之后  依次是各 mip 的像素数据

mip 数不直接信 specs 的位域，而是用 `8 + 10*n + Σdata_size == len(data)` 反推，
四个样本（512²/1024×512/1024²/64²）都唯一命中，比按位解析稳。

像素格式用首 mip 的 data_size 判断：
    ceil(w/4)*ceil(h/4)*16  → DXT5（BC3）
    ceil(w/4)*ceil(h/4)*8   → DXT1（BC1）
    w*h*4                   → ARGB（BGRA）
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

from PIL import Image


class TexError(ValueError):
    pass


@dataclass(frozen=True)
class Mip:
    level: int
    width: int
    height: int
    pitch: int
    offset: int
    size: int


@dataclass(frozen=True)
class TexFile:
    width: int
    height: int
    fmt: str
    mips: tuple[Mip, ...]


def _detect_format(width: int, height: int, size: int) -> str:
    blocks = ((width + 3) // 4) * ((height + 3) // 4)
    if size == blocks * 16:
        return "dxt5"
    if size == blocks * 8:
        return "dxt1"
    if size == width * height * 4:
        return "argb"
    raise TexError(f"无法判断像素格式：{width}x{height}, data_size={size}")


def parse_tex(data: bytes) -> TexFile:
    if len(data) < 12 or data[:4] != b"KTEX":
        raise TexError("不是 KTEX 文件")

    mips: list[Mip] = []
    for count in range(1, 33):
        header = 8 + 10 * count
        if header >= len(data):
            break
        offset = header
        candidate: list[Mip] = []
        valid = True
        for level in range(count):
            width, height, pitch, size = struct.unpack_from("<HHHI", data, 8 + 10 * level)
            if width <= 0 or height <= 0 or size <= 0:
                valid = False
                break
            candidate.append(Mip(level, width, height, pitch, offset, size))
            offset += size
        if not valid or offset != len(data):
            continue
        # 尺寸必须逐级减半到 1（允许非 2 次幂的向下取整）
        ok = True
        for index in range(1, len(candidate)):
            previous, current = candidate[index - 1], candidate[index]
            if current.width != max(1, previous.width // 2) or \
                    current.height != max(1, previous.height // 2):
                ok = False
                break
        if ok:
            mips = candidate
            break

    if not mips:
        raise TexError("KTEX 头部与数据长度不匹配")

    first = mips[0]
    fmt = _detect_format(first.width, first.height, first.size)
    return TexFile(first.width, first.height, fmt, tuple(mips))


def _rgb565(value: int) -> tuple[int, int, int]:
    red = (value >> 11) & 0x1F
    green = (value >> 5) & 0x3F
    blue = value & 0x1F
    return ((red * 255 + 15) // 31, (green * 255 + 31) // 63, (blue * 255 + 15) // 31)


def _decode_dxt5_block(block: bytes) -> list[tuple[int, int, int, int]]:
    a0, a1 = block[0], block[1]
    alpha_bits = int.from_bytes(block[2:8], "little")
    if a0 > a1:
        alphas = [a0, a1] + [((7 - i) * a0 + i * a1) // 7 for i in range(1, 7)]
    else:
        alphas = [a0, a1] + [((5 - i) * a0 + i * a1) // 5 for i in range(1, 5)] + [0, 255]

    c0, c1 = struct.unpack_from("<HH", block, 8)
    color_bits = int.from_bytes(block[12:16], "little")
    rgb0, rgb1 = _rgb565(c0), _rgb565(c1)
    if c0 > c1:
        colors = [
            rgb0, rgb1,
            tuple((2 * rgb0[i] + rgb1[i]) // 3 for i in range(3)),
            tuple((rgb0[i] + 2 * rgb1[i]) // 3 for i in range(3)),
        ]
        transparent = False
    else:
        colors = [
            rgb0, rgb1,
            tuple((rgb0[i] + rgb1[i]) // 2 for i in range(3)),
            (0, 0, 0),
        ]
        transparent = True

    pixels = []
    for index in range(16):
        alpha = alphas[(alpha_bits >> (3 * index)) & 7]
        slot = (color_bits >> (2 * index)) & 3
        red, green, blue = colors[slot]
        if transparent and slot == 3:
            alpha = 0
        pixels.append((red, green, blue, alpha))
    return pixels


def _decode_dxt1_block(block: bytes) -> list[tuple[int, int, int, int]]:
    c0, c1 = struct.unpack_from("<HH", block, 0)
    bits = int.from_bytes(block[4:8], "little")
    rgb0, rgb1 = _rgb565(c0), _rgb565(c1)
    if c0 > c1:
        colors = [
            rgb0, rgb1,
            tuple((2 * rgb0[i] + rgb1[i]) // 3 for i in range(3)),
            tuple((rgb0[i] + 2 * rgb1[i]) // 3 for i in range(3)),
        ]
        alphas = [255] * 4
    else:
        colors = [
            rgb0, rgb1,
            tuple((rgb0[i] + rgb1[i]) // 2 for i in range(3)),
            (0, 0, 0),
        ]
        alphas = [255, 255, 255, 0]

    pixels = []
    for index in range(16):
        slot = (bits >> (2 * index)) & 3
        red, green, blue = colors[slot]
        pixels.append((red, green, blue, alphas[slot]))
    return pixels


def _decode_region(data: bytes, tex: TexFile, mip: Mip,
                   x0: int, y0: int, x1: int, y1: int) -> Image.Image:
    """只解码覆盖 [x0,x1)×[y0,y1) 的 block，避免整图解码。"""
    block_size = 8 if tex.fmt == "dxt1" else 16
    blocks_per_row = max(1, (mip.width + 3) // 4)

    bx0 = max(0, (x0 // 4) * 4)
    by0 = max(0, (y0 // 4) * 4)
    bx1 = min(mip.width, ((x1 + 3) // 4) * 4)
    by1 = min(mip.height, ((y1 + 3) // 4) * 4)
    if bx1 <= bx0 or by1 <= by0:
        raise TexError("裁剪区域为空")

    width = bx1 - bx0
    height = by1 - by0
    canvas = bytearray(width * height * 4)

    for by in range(by0, by1, 4):
        for bx in range(bx0, bx1, 4):
            block_index = (by // 4) * blocks_per_row + (bx // 4)
            start = mip.offset + block_index * block_size
            block = data[start:start + block_size]
            if len(block) < block_size:
                continue
            pixels = _decode_dxt1_block(block) if tex.fmt == "dxt1" else _decode_dxt5_block(block)
            for row in range(4):
                py = by + row - by0
                if py < 0 or py >= height:
                    continue
                for col in range(4):
                    px = bx + col - bx0
                    if px < 0 or px >= width:
                        continue
                    red, green, blue, alpha = pixels[row * 4 + col]
                    index = (py * width + px) * 4
                    canvas[index:index + 4] = bytes((red, green, blue, alpha))

    image = Image.frombytes("RGBA", (width, height), bytes(canvas))
    return image.crop((x0 - bx0, y0 - by0, x1 - bx0, y1 - by0))


def decode_rect(data: bytes, tex: TexFile,
                u1: float, v1: float, u2: float, v2: float,
                *, target: int = 96, bottom_up: bool = True) -> Image.Image:
    """按 UV 矩形裁剪解码，输出 target×target。

    Klei 的贴图是自下而上存的：UV 按自上而下裁，再把裁出来的图垂直翻转。
    bottom_up=False 只给已经正向的 ARGB 贴图用。
    """
    # 选最粗且仍够 target*1.25 的 mip；不够就退回 mip0
    mip = tex.mips[0]
    for candidate in reversed(tex.mips):
        if (u2 - u1) * candidate.width >= target * 1.25 and \
                (v2 - v1) * candidate.height >= target * 1.25:
            mip = candidate
            break

    x0 = max(0, int(round(u1 * mip.width)))
    x1 = min(mip.width, int(round(u2 * mip.width)))
    y0 = max(0, int(round(v1 * mip.height)))
    y1 = min(mip.height, int(round(v2 * mip.height)))
    if x1 <= x0 or y1 <= y0:
        raise TexError(f"UV 矩形无效：{u1},{v1},{u2},{v2}")

    image = _decode_region(data, tex, mip, x0, y0, x1, y1)
    if bottom_up:
        image = image.transpose(Image.FLIP_TOP_BOTTOM)
    return image.resize((target, target), Image.LANCZOS)


def decode_all(data: bytes) -> Image.Image:
    """整图解码（mod 头像/modicon 用）。Klei tex 自底向上存储，统一翻回正向。"""
    tex = parse_tex(data)
    mip = tex.mips[0]
    image = _decode_region(data, tex, mip, 0, 0, mip.width, mip.height)
    return image.transpose(Image.FLIP_TOP_BOTTOM)
