# -*- coding: utf-8 -*-
"""头像四层来源体系测试：official（assets）/ upload / mod / unknown 兜底 + per 角色切换。"""
import base64
import io
import os
import urllib.request

import pytest
from PIL import Image

from ds_saver.core import avatars, fallback, paths

GAME = r"E:\Games\SteamGames\steamapps\common\dont_starve"


def _make_png(directory, name, color=(200, 60, 60, 255)):
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, name)
    Image.new("RGBA", (32, 32), color).save(path)
    return path


@pytest.fixture
def isolated(monkeypatch, tmp_path):
    """三层目录全部指到 tmp，全局状态复位。"""
    monkeypatch.setattr(paths, "data_dir", lambda *parts: str(tmp_path.joinpath("data", *parts)))
    monkeypatch.setattr(avatars, "official_dir", lambda: str(tmp_path / "official"))
    avatars._state.update({"loaded": False, "game_dir": None, "overrides": {}, "mod_chars": {}})
    return tmp_path


def test_norm_char_handles_alias_and_traversal():
    assert avatars._norm_char("Wilson") == "wilson"
    assert avatars._norm_char("avatar_wx78.tex") == "wx78"
    assert avatars._norm_char("wmaxwell") == "waxwell"
    assert avatars._norm_char("../evil") == ""
    assert avatars._norm_char("wanda.png") == "wanda"


def test_resolve_prefers_upload_over_official(isolated):
    """默认优先级：upload > official > mod > unknown。"""
    _make_png(isolated / "official", "wilson.png")
    _make_png(isolated / "data" / "images" / "uploads", "wilson.png", (10, 200, 10, 255))
    result = avatars.get_data_urls(["wilson"])
    url = result["avatars"]["wilson"]
    assert url.startswith("data:image/png;base64,")
    # upload 是绿色、official 是红色——取到了 upload 层
    raw = base64.b64decode(url.split(",", 1)[1])
    assert Image.open(io.BytesIO(raw)).getpixel((0, 0))[:3] == (10, 200, 10)


def test_resolve_falls_back_to_unknown(isolated):
    """三层都没有 → unknown 兜底，且兜底层落盘复用。"""
    _make_png(isolated / "official", "unknown.png")
    result = avatars.get_data_urls(["nobody_here"])
    assert result["avatars"]["nobody_here"].startswith("data:image/png;base64,")
    assert (isolated / "data" / "images" / "fallback" / "unknown.png").is_file()


def test_per_character_override_and_reset(isolated):
    """override 指向 official 后，upload 存在也不显示；恢复 auto 回默认优先级。"""
    _make_png(isolated / "official", "wilson.png")
    _make_png(isolated / "data" / "images" / "uploads", "wilson.png", (10, 200, 10, 255))
    avatars.get_data_urls(["wilson"])

    avatars.set_source("wilson", "official")
    raw = base64.b64decode(avatars.resolve_url("wilson").split(",", 1)[1])
    assert Image.open(io.BytesIO(raw)).getpixel((0, 0))[:3] == (200, 60, 60)

    avatars.set_source("wilson", "auto")
    raw = base64.b64decode(avatars.resolve_url("wilson").split(",", 1)[1])
    assert Image.open(io.BytesIO(raw)).getpixel((0, 0))[:3] == (10, 200, 10)


def test_delete_cached_hits_upload_first(isolated):
    """删除打 upload 层；official 永不被删。"""
    _make_png(isolated / "official", "wilson.png")
    upload = _make_png(isolated / "data" / "images" / "uploads", "wilson.png")
    assert avatars.delete_cached("wilson")["source"] == "upload"
    assert not os.path.isfile(upload)
    assert os.path.isfile(os.path.join(isolated / "official", "wilson.png"))
    # 只剩 official → 不可删
    assert avatars.delete_cached("wilson")["deleted"] is False
    assert os.path.isfile(os.path.join(isolated / "official", "wilson.png"))


def test_prune_legacy_cache(isolated):
    """v5.3 旧运行时缓存 data/avatars 被清理。"""
    legacy = isolated / "data" / "avatars"
    _make_png(legacy, "wilson.png")
    removed = avatars.prune_legacy_cache()
    assert removed == 1 and not legacy.exists()


def test_library_counts_layers(isolated):
    """图片库统计：三层计数与缺素材名单。"""
    _make_png(isolated / "official", "wilson.png")
    _make_png(isolated / "data" / "images" / "uploads", "wilson.png")
    _make_png(isolated / "data" / "images" / "modchars", "wiltonmod.png")
    info = avatars.library(all_chars=["wilson", "wanda"])
    assert info["official_count"] == 1 and info["upload_count"] == 1 and info["mod_count"] == 1
    assert info["char_count"] == 2
    assert info["missing"] == ["wanda"]


def test_fallback_no_sources_offline(isolated, monkeypatch):
    """无本地文件、无官方 unknown、网络全挂 → ok=False。"""
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("offline")))
    result = fallback.ensure_unknown(None)
    assert result["ok"] is False


def test_fallback_file_beats_official(isolated):
    """本地 fallback 文件优先于官方 unknown。"""
    fb = isolated / "data" / "images" / "fallback"
    fb.mkdir(parents=True)
    (fb / "unknown.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    result = fallback.ensure_unknown(None)
    assert result["ok"] is True and result["source"] == "file"


@pytest.mark.skipif(not os.path.isfile(
    os.path.join(GAME, "data", "images", "saveslot_portraits.tex")),
    reason="本机没有饥荒安装")
def test_mod_avatar_scan_produces_png(isolated):
    """mod 目录 avatar_*.tex 解码落盘 modchars/（只认 dont_starve 根）。"""
    mod = isolated / "dont_starve" / "mods" / "mymod" / "images" / "avatars"
    mod.mkdir(parents=True)
    # 用游戏本体图集充当 mod 头像源（同格式 tex）
    with open(os.path.join(GAME, "data", "images", "saveslot_portraits.tex"), "rb") as fh:
        data = fh.read()
    (mod / "avatar_wilson.tex").write_bytes(data)
    produced = avatars._scan_mod_avatars(str(isolated / "dont_starve"))
    assert produced >= 1
    assert (isolated / "data" / "images" / "modchars" / "wilson.png").is_file()
