# -*- coding: utf-8 -*-
"""P1-3：save_id 周目、槽位扩展字段、modinfo 解析、备份分组。"""
import time

from ds_saver.core import klei, models, mods, paths


# ---------------- save_id 建图时间 ----------------


def test_save_id_epoch_seconds():
    assert klei.save_id_created_at("1700000000") == 1700000000


def test_save_id_epoch_milliseconds():
    assert klei.save_id_created_at("1700000000123") == 1700000000


def test_save_id_epoch_garbage_is_none():
    assert klei.save_id_created_at("") is None
    assert klei.save_id_created_at("screecher") is None
    assert klei.save_id_created_at(None) is None
    # 纯数字但不在合理区间
    assert klei.save_id_created_at("42") is None
    assert klei.save_id_created_at("99999999999999999") is None


# ---------------- slot_extras ----------------


def test_slot_extracts_dlc_mods_mode_days():
    raw = {
        "save_id": "1700000000",
        "dlc": {"PORKLAND_DLC": True, "REIGN_OF_GIANTS": False},
        "mods": {"workshop-123": {}, "workshop-456": {}},
        "modes": {"survival": {"day": 42}, "shipwrecked": {"day": 7}},
    }
    extras = klei.slot_extras(raw)
    assert extras["save_id"] == "1700000000"
    assert extras["dlc"] == ["哈姆雷特"]
    assert sorted(extras["mod_ids"]) == ["workshop-123", "workshop-456"]
    assert extras["mode_days"] == {"survival": 42, "shipwrecked": 7}


def test_slot_extras_survives_garbage():
    assert klei.slot_extras({}) == {"save_id": "", "dlc": [], "mod_ids": [], "mode_days": {}}
    assert klei.slot_extras(None)["save_id"] == ""
    assert klei.slot_extras({"mods": ["m1", "m2"]})["mod_ids"] == ["m1", "m2"]


# ---------------- modinfo.lua 解析 ----------------


def test_parse_modinfo_basic():
    text = """
    name = " Wilson 的冒险 ",
    author = "Klei",
    version = "1.2.3",
    description = "一个测试 mod",
    """
    parsed = mods.parse_modinfo(text)
    assert parsed["name"] == "Wilson 的冒险"
    assert parsed["author"] == "Klei"
    assert parsed["version"] == "1.2.3"
    assert parsed["description"] == "一个测试 mod"


def test_parse_modinfo_strips_comments():
    text = """
    -- name = "被注释掉的假名",
    name = [[真正的名字]],
    --[[ version = "9.9.9",
    多行注释 ]]
    author = "Klei" -- 行尾注释
    """
    parsed = mods.parse_modinfo(text)
    assert parsed["name"] == "真正的名字"
    assert parsed["author"] == "Klei"
    assert "version" not in parsed


def test_resolve_mods_degrades_without_roots(monkeypatch):
    """扫描不到任何 DS 目录 → 全部降级，绝不崩。"""
    monkeypatch.setattr(mods, "ds_roots", lambda: [])
    result = mods.resolve_mods(["workshop-1", "workshop-2"], "")
    assert [item["id"] for item in result] == ["workshop-1", "workshop-2"]
    assert all(not item["resolved"] for item in result)
    assert result[0]["name"] == "workshop-1"


def test_resolve_mods_auto_scans_ds_root(tmp_path, monkeypatch):
    """game_dir 为空时自动扫描 DS 安装目录解析 mod 名。"""
    mod = tmp_path / "mods" / "workshop-777"
    mod.mkdir(parents=True)
    (mod / "modinfo.lua").write_text('name = "自动扫描"\n', encoding="utf-8")
    monkeypatch.setattr(mods, "ds_roots", lambda: [str(tmp_path)])
    result = mods.resolve_mods(["workshop-777"], "")
    assert result[0]["resolved"] is True
    assert result[0]["name"] == "自动扫描"
    assert result[0]["dir"] == str(mod)


def test_resolve_mods_reads_modinfo(tmp_path, monkeypatch):
    mod = tmp_path / "mods" / "workshop-777"
    mod.mkdir(parents=True)
    (mod / "modinfo.lua").write_text('name = "测试模组"\nauthor = "yh"\n', encoding="utf-8")
    monkeypatch.setattr(mods, "ds_roots", lambda: [str(tmp_path)])
    result = mods.resolve_mods(["workshop-777"], str(tmp_path))
    assert result[0]["resolved"] is True
    assert result[0]["name"] == "测试模组"
    assert result[0]["author"] == "yh"
    assert result[0]["dir"] == str(mod)


def test_resolve_mods_missing_modinfo_degrades(tmp_path, monkeypatch):
    monkeypatch.setattr(mods, "ds_roots", lambda: [])
    result = mods.resolve_mods(["workshop-404"], str(tmp_path))
    assert result[0]["resolved"] is False
    assert result[0]["name"] == "workshop-404"


def test_resolve_mods_modicon_png(tmp_path, monkeypatch):
    """modicon.png → 落盘 data/images/modicons/<id>.png，icon 记相对路径。"""
    from PIL import Image

    monkeypatch.setattr(paths, "data_dir", lambda *parts: str(tmp_path.joinpath("data", *parts)))
    mod = tmp_path / "mods" / "workshop-888"
    mod.mkdir(parents=True)
    (mod / "modinfo.lua").write_text('name = "有图标"\n', encoding="utf-8")
    Image.new("RGBA", (32, 32), (200, 60, 60, 255)).save(mod / "modicon.png")
    monkeypatch.setattr(mods, "ds_roots", lambda: [str(tmp_path)])
    result = mods.resolve_mods(["workshop-888"], "")
    assert result[0]["icon"] == "images/modicons/workshop-888.png"
    assert (tmp_path / "data" / "images" / "modicons" / "workshop-888.png").is_file()


# ---------------- 周目分组 ----------------


def _backup(stamp, full_time, save_id):
    return {"stamp": stamp, "full_time": full_time, "save_id": save_id}


def test_group_playthroughs_orders_oldest_first():
    # 新 → 旧（list_backups 的顺序）
    backups = [
        _backup("20260301_120000", "2026-03-01 12:00:00", "1700000000"),
        _backup("20260201_120000", "2026-02-01 12:00:00", "1700000000"),
        _backup("20260115_120000", "2026-01-15 12:00:00", "1690000000"),
    ]
    groups = models.group_playthroughs(backups)
    assert [g["index"] for g in groups] == [1, 2]
    assert groups[0]["save_id"] == "1690000000"
    assert groups[0]["backups"][0]["stamp"] == "20260115_120000"
    assert groups[1]["save_id"] == "1700000000"


def test_group_playthroughs_date_prefers_save_id():
    backups = [_backup("20260301_120000", "2026-03-01 12:00:00", "1700000000")]
    groups = models.group_playthroughs(backups)
    # save_id 解出的日期，而不是备份那天的日期
    assert groups[0]["created_date"] == time.strftime("%Y-%m-%d", time.localtime(1700000000))


def test_group_playthroughs_unknown_save_id_goes_last():
    backups = [
        _backup("20260301_120000", "2026-03-01 12:00:00", ""),
        _backup("20260201_120000", "2026-02-01 12:00:00", "1700000000"),
    ]
    groups = models.group_playthroughs(backups)
    assert groups[0]["save_id"] == "1700000000"
    assert groups[-1]["index"] == 0
    assert groups[-1]["save_id"] == ""
    # 日期退化到组内最旧备份
    assert groups[-1]["created_date"] == "2026-03-01"
