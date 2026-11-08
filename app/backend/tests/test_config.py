# -*- coding: utf-8 -*-
import json
import os

import pytest

from ds_saver.core import config, paths
from ds_saver.core.errors import DsError, ErrorCode


def test_defaults_are_complete(isolated_paths):
    cfg = config.normalize(None)
    assert cfg["theme_preset"] == "nightfall"
    assert cfg["theme_mode"] == "auto"
    assert cfg["font_size"] == 17
    assert cfg["keep"] == 10 and cfg["keep_auto"] == 5
    assert cfg["close_action"] == "ask"
    # 项目内目录存相对形式（v5.3 便携布局）
    assert cfg["backup_root"] == "data/backups"
    assert os.path.normcase(paths.resolve_portable(cfg["backup_root"])) == \
        os.path.normcase(os.path.join(str(isolated_paths), "data", "backups"))


def test_accent_migrates_to_preset(isolated_paths):
    assert config.normalize({"accent": "ember"})["theme_preset"] == "ledger"
    assert config.normalize({"accent": "moss"})["theme_preset"] == "brass"
    assert config.normalize({"accent": "plum"})["theme_preset"] == "nightfall"
    # 已有 theme_preset 时不被旧 accent 覆盖
    assert config.normalize({"accent": "ember", "theme_preset": "brass"})["theme_preset"] == "brass"


def test_keep_zero_is_clamped_so_upgrade_cannot_wipe(isolated_paths):
    assert config.normalize({"keep": 0})["keep"] == 1
    assert config.normalize({"keep": -5})["keep"] == 1
    assert config.normalize({"keep": 99999})["keep"] == 999


def test_invalid_enum_falls_back(isolated_paths):
    cfg = config.normalize({"theme_mode": "neon", "font_size": 99, "close_action": "explode"})
    assert cfg["theme_mode"] == "auto"
    assert cfg["font_size"] == 17
    assert cfg["close_action"] == "ask"


def test_font_size_keeps_custom_range(isolated_paths):
    # 14-22 全是合法自定义字号：14 不再被旧迁移表夹成 15（曾导致选 14 保存后回 15）
    assert config.normalize({"font_size": 14})["font_size"] == 14
    assert config.normalize({"font_size": 22})["font_size"] == 22
    # 14-22 任意档位都合法：16/18 不能再被旧迁移映射掉
    assert config.normalize({"font_size": 16})["font_size"] == 16
    assert config.normalize({"font_size": 18})["font_size"] == 18
    assert config.normalize({"font_size": 17})["font_size"] == 17
    assert config.normalize({"font_size": 99})["font_size"] == 17


def test_save_load_roundtrip(isolated_paths):
    saved = config.save({"keep": 3, "theme_preset": "ledger"})
    assert saved["keep"] == 3
    loaded, warnings = config.load()
    assert loaded["theme_preset"] == "ledger"
    assert warnings == []
    assert os.path.isfile(paths.config_file())


def test_corrupt_config_is_backed_up_not_silently_lost(isolated_paths):
    config_dir = os.path.dirname(paths.config_file())
    os.makedirs(config_dir, exist_ok=True)
    path = paths.config_file()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('{"keep": 3, oops')
    cfg, warnings = config.load()
    assert warnings == [ErrorCode.CONFIG]
    assert cfg["keep"] == 10  # 回到默认值，而不是"空配置"
    backups = [name for name in os.listdir(config_dir) if ".bak-" in name]
    assert len(backups) == 1


def test_legacy_config_migrates_into_data_dir(isolated_paths):
    """v5.2 前配置在程序根：存在旧文件且 data\ 无新文件时应自动迁移。"""
    import json

    legacy = paths.legacy_config_file()
    with open(legacy, "w", encoding="utf-8") as fh:
        json.dump({"theme_preset": "brass"}, fh)
    cfg, warnings = config.load()
    assert warnings == []
    assert cfg["theme_preset"] == "brass"
    assert os.path.isfile(paths.config_file())
    assert not os.path.isfile(legacy)  # 迁移是移动而不是复制


def test_old_config_filename_migrates_in_data_dir(isolated_paths):
    """旧文件名 dst_saver_config.json 在 data\：迁移为新名 ds_saver_config.json。"""
    import json

    old = os.path.join(paths.data_dir(), "dst_saver_config.json")
    os.makedirs(paths.data_dir(), exist_ok=True)
    with open(old, "w", encoding="utf-8") as fh:
        json.dump({"theme_preset": "brass"}, fh)
    cfg, warnings = config.load()
    assert warnings == []
    assert cfg["theme_preset"] == "brass"
    assert os.path.isfile(paths.config_file())  # 新名落盘
    assert not os.path.isfile(old)  # 旧名被移动而非复制


def test_old_config_filename_kept_when_new_exists(isolated_paths):
    """新旧并存：新文件优先，旧文件保留当备份，绝不覆盖新设置。"""
    import json

    new = paths.config_file()
    old = os.path.join(paths.data_dir(), "dst_saver_config.json")
    os.makedirs(paths.data_dir(), exist_ok=True)
    with open(new, "w", encoding="utf-8") as fh:
        json.dump({"theme_preset": "brass"}, fh)
    with open(old, "w", encoding="utf-8") as fh:
        json.dump({"theme_preset": "marble"}, fh)
    cfg, _ = config.load()
    assert cfg["theme_preset"] == "brass"  # 新文件优先
    assert os.path.isfile(old)  # 旧文件保留当备份，不删不覆盖


def test_backup_root_stored_portable(isolated_paths, monkeypatch):
    """项目内的备份目录在 config 里存相对形式，随目录改名/搬家自动跟随。"""
    inside = os.path.join(str(isolated_paths), "data", "backups")
    cfg = config.normalize({"backup_root": inside})
    assert cfg["backup_root"] == "data/backups"
    assert os.path.normcase(paths.resolve_portable(cfg["backup_root"])) == os.path.normcase(inside)
    # 项目外的目录保持绝对
    outside = os.path.join(str(isolated_paths), "..", "elsewhere", "bk")
    cfg2 = config.normalize({"backup_root": outside})
    assert os.path.isabs(cfg2["backup_root"])


def test_to_portable_and_resolve_roundtrip(isolated_paths):
    inside = os.path.join(str(isolated_paths), "data", "avatars")
    rel = paths.to_portable(inside)
    assert rel == "data/avatars"
    assert os.path.normcase(paths.resolve_portable(rel)) == os.path.normcase(inside)
    # 项目外原样返回（换分隔符规范化）
    outside = os.path.join(str(isolated_paths), "..", "x")
    assert os.path.isabs(paths.to_portable(outside))


def test_legacy_backup_root_migrates_into_data(tmp_path, monkeypatch):
    """v5.3 布局迁移：旧 app_dir\backups 整目录搬进 data\backups。"""
    legacy = tmp_path / "backups"
    (legacy / "slot_1").mkdir(parents=True)
    (legacy / "slot_1" / "keepme.txt").write_text("真实备份", encoding="utf-8")
    paths.migrate_legacy_layout(base=str(tmp_path))
    assert (tmp_path / "data" / "backups" / "slot_1" / "keepme.txt").is_file()
    assert not legacy.exists()


def test_legacy_log_dir_migrates_up(tmp_path, monkeypatch):
    """v5.3 布局迁移：data\logs 提升为与 data 同级的 logs\。"""
    old_logs = tmp_path / "data" / "logs"
    old_logs.mkdir(parents=True)
    (old_logs / "app.log").write_text("log", encoding="utf-8")
    paths.migrate_legacy_layout(base=str(tmp_path))
    assert (tmp_path / "logs" / "app.log").is_file()
    assert not old_logs.exists()


def test_stale_backup_root_resets_to_default(tmp_path, monkeypatch):
    """配置指向已消失的旧安装位置 → 自动改回当前默认。"""
    import json

    cfg_dir = tmp_path / "data"
    cfg_dir.mkdir(parents=True)
    cfg_path = cfg_dir / "ds_saver_config.json"
    cfg_path.write_text(json.dumps({"backup_root": "D:\\Tools\\gone\\backups"}), encoding="utf-8")
    paths.migrate_legacy_layout(base=str(tmp_path), config_path=str(cfg_path))
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    # 失效的绝对路径改回当前默认（相对形式）
    assert cfg["backup_root"] == "data/backups"


def test_require_save_dir_rejects_dir_without_saveindex(tmp_path):
    with pytest.raises(DsError) as exc:
        config.require_save_dir(str(tmp_path))
    assert exc.value.code == ErrorCode.SAVE_DIR_INVALID


def test_require_save_dir_rejects_empty():
    with pytest.raises(DsError) as exc:
        config.require_save_dir("")
    assert exc.value.code == ErrorCode.BAD_ARGS


def test_excluded_candidates_normalized(isolated_paths):
    """脏输入（None/字符串/混合列表）洗成 []；合法列表透传去空。"""
    assert config.normalize(None)["excluded_candidates"] == []
    assert config.normalize({"excluded_candidates": "oops"})["excluded_candidates"] == []
    assert config.normalize({"excluded_candidates": [1, None, ""]})["excluded_candidates"] == []
    dirty = ["C://a", "  C://b  ", "", None]
    assert config.normalize({"excluded_candidates": dirty})["excluded_candidates"] == ["C://a", "C://b"]
