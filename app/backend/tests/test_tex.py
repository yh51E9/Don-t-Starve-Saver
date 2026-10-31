# -*- coding: utf-8 -*-
import os
import struct

import pytest

from ds_saver.core import tex

GAME_TEX = r"E:\Games\SteamGames\steamapps\common\dont_starve\data\images\saveslot_portraits.tex"


def make_dxt5_4x4() -> bytes:
    """最小的 KTEX：4×4、单 mip、纯红 DXT5 块。"""
    alpha = bytes([255, 255, 0, 0, 0, 0, 0, 0])           # a0=a1=255，索引全 0
    color = struct.pack("<HH", 0xF800, 0x001F) + b"\x00\x00\x00\x00"  # 红/蓝，索引全 0
    block = alpha + color
    header = b"KTEX" + b"\x00\x00\x00\x00"
    meta = struct.pack("<HHHI", 4, 4, 16, len(block))
    return header + meta + block


def test_parse_minimal_ktx():
    info = tex.parse_tex(make_dxt5_4x4())
    assert (info.width, info.height) == (4, 4)
    assert info.fmt == "dxt5"
    assert len(info.mips) == 1
    assert info.mips[0].size == 16


def test_decode_minimal_ktx_is_red():
    data = make_dxt5_4x4()
    info = tex.parse_tex(data)
    image = tex.decode_rect(data, info, 0.0, 0.0, 1.0, 1.0, target=4)
    assert image.size == (4, 4)
    red, green, blue, alpha = image.getpixel((2, 2))
    assert red > 240 and green < 10 and blue < 10 and alpha == 255


def test_reject_non_ktx():
    with pytest.raises(tex.TexError):
        tex.parse_tex(b"PNG\x00\x00\x00\x00")


@pytest.mark.skipif(not os.path.isfile(GAME_TEX), reason="本机没有饥荒安装")
def test_real_atlas_parses_and_crops():
    with open(GAME_TEX, "rb") as fh:
        data = fh.read()
    info = tex.parse_tex(data)
    assert info.width == 512 and info.fmt == "dxt5"
    image = tex.decode_rect(data, info, 0.001, 0.392, 0.233, 0.593, target=96)
    assert image.size == (96, 96)
    assert image.getchannel("A").getextrema()[0] == 0
