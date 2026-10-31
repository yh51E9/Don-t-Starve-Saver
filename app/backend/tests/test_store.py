# -*- coding: utf-8 -*-
import os
import time

import pytest

from ds_saver.core import klei, models, store
from ds_saver.core.errors import DsError, ErrorCode
from tests.conftest import slot_lua, write_save_dir


def _worlds(save_dir):
    return klei.load_slots(str(save_dir))


def _world(save_dir, slot_id: str) -> dict:
    return next(slot for slot in klei.load_slots(str(save_dir)) if slot["index"] == slot_id)


def _slot_day(save_dir, slot_id: str):
    data = klei.parse_lua_table(klei.decode_klei_file(os.path.join(str(save_dir), "saveindex")))
    entry = klei.slot_entry(data, slot_id)
    modes = entry.get("modes", {}) if isinstance(entry, dict) else {}
    days = [m.get("day") for m in modes.values() if isinstance(m, dict)]
    return next((d for d in days if isinstance(d, int)), None)


def test_backup_copies_saveindex_and_all_world_files(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    entry = store.backup_slot(str(save_dir), world, str(backup_root))
    folder = os.path.join(str(backup_root), "slot_1", entry["dir_name"])
    assert os.path.isfile(os.path.join(folder, "saveindex"))
    assert os.path.isfile(os.path.join(folder, "survival_1"))
    assert os.path.isfile(os.path.join(folder, "cave_1_1_1"))
    assert entry["tag"] == "manual"
    assert entry["file_count"] == 3


def test_backup_suffix_per_tag(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    auto = store.backup_slot(str(save_dir), world, str(backup_root), tag="auto")
    pre = store.backup_slot(str(save_dir), world, str(backup_root), tag="pre")
    assert auto["dir_name"].endswith("_auto")
    assert pre["dir_name"].endswith("_pre")
    assert store.list_backups(str(backup_root), "1")[0]["tag"] == "pre"


def test_same_second_collision_gets_suffix(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    first = store.backup_slot(str(save_dir), world, str(backup_root))
    second = store.backup_slot(str(save_dir), world, str(backup_root))
    assert first["dir_name"] != second["dir_name"]
    assert second["dir_name"].endswith("_2")


def test_list_backups_sorts_same_stamp_stably(backup_root):
    base = os.path.join(str(backup_root), "slot_1")
    for name in ("20261027_101010", "20261027_101010_auto", "20261027_101010_auto_2"):
        os.makedirs(os.path.join(base, name))
    names = [item["dir_name"] for item in store.list_backups(str(backup_root), "1")]
    assert names == ["20261027_101010_auto_2", "20261027_101010_auto", "20261027_101010"]


def test_unknown_dir_name_is_shown_not_hidden(backup_root):
    os.makedirs(os.path.join(str(backup_root), "slot_1", "随手备份-打龙蝇前"))
    items = store.list_backups(str(backup_root), "1")
    assert items[0]["dir_name"] == "随手备份-打龙蝇前"
    assert items[0]["tag"] == "manual"


def test_enforce_keep_counts_manual_and_auto_separately(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    for _ in range(3):
        store.backup_slot(str(save_dir), world, str(backup_root))
        time.sleep(0.001)
    for _ in range(2):
        store.backup_slot(str(save_dir), world, str(backup_root), tag="auto")

    removed, _freed = store.enforce_keep(str(backup_root), "1", keep_manual=1, keep_auto=1)
    remaining = store.list_backups(str(backup_root), "1")
    assert removed == 3
    assert sum(1 for item in remaining if item["tag"] == "auto") == 1
    assert sum(1 for item in remaining if item["tag"] != "auto") == 1


def test_enforce_keep_zero_clears_group(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    store.backup_slot(str(save_dir), world, str(backup_root))
    store.backup_slot(str(save_dir), world, str(backup_root), tag="auto")
    removed, _freed = store.enforce_keep(str(backup_root), "1", keep_manual=5, keep_auto=0)
    assert removed == 1
    assert [item["tag"] for item in store.list_backups(str(backup_root), "1")] == ["manual"]


def test_delete_backup_blocks_path_escape(backup_root):
    with pytest.raises(DsError) as exc:
        store.delete_backup(str(backup_root), r"1:..\..\Windows")
    assert exc.value.code == ErrorCode.PATH_ESCAPE


def test_delete_backup_requires_valid_id(backup_root):
    with pytest.raises(DsError) as exc:
        store.delete_backup(str(backup_root), "garbage")
    assert exc.value.code == ErrorCode.BAD_ARGS


def test_restore_validates_before_touching_save_dir(save_dir, backup_root, tmp_path):
    bad = tmp_path / "broken_backup"
    bad.mkdir()
    (bad / "survival_1").write_bytes(b"whatever")

    before = (save_dir / "saveindex").read_bytes()
    with pytest.raises(DsError) as exc:
        store.restore_slot(str(save_dir), str(bad))
    assert exc.value.code == ErrorCode.BACKUP_NOT_FOUND
    assert (save_dir / "saveindex").read_bytes() == before


def test_restore_writes_files_back(save_dir, backup_root, tmp_path):
    world = _worlds(save_dir)[0]
    entry = store.backup_slot(str(save_dir), world, str(backup_root))

    target = write_save_dir(tmp_path / "clone",
                            [slot_lua(1, "wilson", "survival", 1, ["survival_1"])])
    (target / "survival_1").write_bytes(b"corrupted")
    restored = store.restore_slot(str(target), entry["path"])
    assert "saveindex" in restored
    assert (target / "survival_1").read_bytes() == b"x" * 1024


def test_preview_restore_reports_delta_and_missing(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    entry = store.backup_slot(str(save_dir), world, str(backup_root))
    newer = {**world, "day": world["day"] + 3, "files": world["files"] + ["cave_1_1_1"]}
    preview = store.preview_restore(newer, entry["path"])
    assert preview["current_day"] == 45
    assert preview["backup_day"] == 42
    assert preview["delta_days"] == -3
    assert preview["files"] == 3
    assert preview["warnings"] == []


def test_cleanup_handles_orphan_slot(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    orphan_world = {**world, "index": "9"}
    for _ in range(3):
        store.backup_slot(str(save_dir), orphan_world, str(backup_root))
        time.sleep(0.001)

    result = store.cleanup(str(backup_root), keep_manual=1, keep_auto=1, known_slot_ids=["1"])
    assert result["removed"] == 2
    assert [item["slot_id"] for item in result["orphans"]] == ["9"]


def test_stats_and_size_format(backup_root, save_dir):
    world = _worlds(save_dir)[0]
    store.backup_slot(str(save_dir), world, str(backup_root))
    info = store.stats(str(backup_root))
    assert info["count"] == 1
    assert info["total_bytes"] > 0
    assert store.fmt_size(0) == "0 B"
    assert store.fmt_size(2048) == "2 KB"


def test_models_strip_paths_and_translate(save_dir, backup_root):
    world = _worlds(save_dir)[0]
    view = models.world_view(world)
    assert view["id"] == "1"
    assert view["character_label"] == "威尔逊"
    assert view["mode_label"] == "巨人国"
    assert "raw" not in view

    entry = store.backup_slot(str(save_dir), world, str(backup_root))
    backup = models.backup_view(entry)
    assert "path" not in backup
    assert backup["tag_label"] == "手动"
# ---------------- 恢复的外科手术语义（v5.2） ----------------

def test_restore_only_touches_target_slot(save_dir, backup_root):
    """恢复槽位 1 不得把槽位 2 的账面拉回旧时刻——saveindex 是共用账本。"""
    # T1：备份槽位 1（此时槽位 2 是 7 天）
    entry = store.backup_slot(str(save_dir), _world(save_dir, "1"), str(backup_root), tag="manual")

    # 槽位 2 玩了一阵：账本推到 99 天，世界文件也更新
    data = klei.parse_lua_table(klei.decode_klei_file(os.path.join(str(save_dir), "saveindex")))
    klei.slot_entry(data, "2")["modes"]["shipwrecked"]["day"] = 99
    (save_dir / "saveindex").write_bytes(klei.encode_klei_text(klei.serialize_lua_table(data)))
    (save_dir / "shipwrecked_2").write_bytes(b"newer" * 100)

    # 恢复槽位 1
    store.restore_slot(str(save_dir), entry["path"], slot_id="1")

    assert _slot_day(save_dir, "1") == 42      # 槽位 1 回到备份时刻
    assert _slot_day(save_dir, "2") == 99      # 槽位 2 的账面不被拉回 7 天
    assert (save_dir / "shipwrecked_2").read_bytes() == b"newer" * 100  # 世界文件没被动


def test_restore_backup_of_empty_slot_makes_it_empty(save_dir, backup_root):
    """备份里该槽还是空的 → 恢复「它自己」的备份后回到空占位，且不吃掉别的槽位。"""
    # 槽位 2 删空后拍快照（备份里槽位 2 是空占位）
    data = klei.parse_lua_table(klei.decode_klei_file(os.path.join(str(save_dir), "saveindex")))
    (save_dir / "saveindex").write_bytes(
        klei.encode_klei_text(klei.serialize_lua_table(klei.drop_slot(data, "2"))))
    entry = store.backup_slot(str(save_dir), _world(save_dir, "1"), str(backup_root), tag="manual")
    # 槽位 2 又被玩出档（账本 + 世界文件都更新）
    data = klei.parse_lua_table(klei.decode_klei_file(os.path.join(str(save_dir), "saveindex")))
    data = klei.splice_slot(data, "2", {"character": "wx78",
                                        "modes": {"shipwrecked": {"day": 30, "files": ["shipwrecked_2"]}}})
    (save_dir / "saveindex").write_bytes(klei.encode_klei_text(klei.serialize_lua_table(data)))
    (save_dir / "shipwrecked_2").write_bytes(b"played" * 40)

    # 恢复槽位 2 自己的备份 → 该槽回到空占位；槽位 1 不受影响
    store.restore_slot(str(save_dir), entry["path"], slot_id="2")

    assert _slot_day(save_dir, "2") is None
    assert _slot_day(save_dir, "1") == 42


def test_restore_falls_back_to_wholesale_when_live_index_corrupt(save_dir, backup_root):
    entry = store.backup_slot(str(save_dir), _world(save_dir, "1"), str(backup_root), tag="manual")
    (save_dir / "saveindex").write_bytes(b"KLEI     1D" + b"not-valid-base64!!!")
    restored = store.restore_slot(str(save_dir), entry["path"], slot_id="1")
    assert "saveindex" in restored
    assert _slot_day(save_dir, "1") == 42      # 兜底：整体覆盖保住槽位本身


# ---------------- P1-5：按天数保留（交集语义） ----------------


def _make_backup(backup_root, slot_id, stamp_name, payload=b"x" * 32):
    import os
    base = os.path.join(str(backup_root), f"slot_{slot_id}", stamp_name)
    os.makedirs(base, exist_ok=True)
    with open(os.path.join(base, "survival_1"), "wb") as fh:
        fh.write(payload)
    return base


def _stamp_days_ago(days, suffix=""):
    return time.strftime(f"%Y%m%d_%H%M%S{suffix}", time.localtime(time.time() - days * 86400))


def test_keep_days_deletes_only_overage_and_beyond_count(backup_root):
    # 手动组 2 份：40 天前 + 5 天前；份数上限 1 → 只有 40 天前超出份数
    _make_backup(backup_root, "1", _stamp_days_ago(40))
    _make_backup(backup_root, "1", _stamp_days_ago(5))
    removed, freed = store.enforce_keep_days(str(backup_root), "1",
                                             keep_manual=1, keep_auto=5,
                                             days_manual=30, days_auto=30)
    assert removed == 1 and freed > 0
    remaining = [b["stamp"] for b in store.list_backups(str(backup_root), "1")]
    assert len(remaining) == 1


def test_keep_days_never_deletes_within_count(backup_root):
    """超龄但没超份数 → 一份都不删（交集语义：天数不放宽份数）。"""
    _make_backup(backup_root, "1", _stamp_days_ago(400))
    _make_backup(backup_root, "1", _stamp_days_ago(300))
    removed, _ = store.enforce_keep_days(str(backup_root), "1",
                                         keep_manual=2, keep_auto=5,
                                         days_manual=30, days_auto=30)
    assert removed == 0


def test_keep_days_exempt_pre_backups(backup_root):
    """_pre 是后悔药，永远不参与天数淘汰。"""
    _make_backup(backup_root, "1", _stamp_days_ago(400, "_pre"))
    removed, _ = store.enforce_keep_days(str(backup_root), "1",
                                         keep_manual=0, keep_auto=5,
                                         days_manual=30, days_auto=30)
    assert removed == 0  # 唯一一份是 _pre，超龄超份数也不删
    assert len(store.list_backups(str(backup_root), "1")) == 1


def test_keep_days_zero_means_count_only(backup_root):
    """days<=0 退化为纯份数模式。"""
    for days in (60, 50, 40):
        _make_backup(backup_root, "1", _stamp_days_ago(days))
    removed, _ = store.enforce_keep_days(str(backup_root), "1",
                                         keep_manual=1, keep_auto=5,
                                         days_manual=0, days_auto=0)
    assert removed == 2


def test_enforce_from_config_dispatches_by_keep_mode(backup_root, tmp_path):
    """同一布局：count 模式删掉超份数的；days 模式因为没超龄而保留。"""
    cfg_count = {"keep": 1, "keep_auto": 5, "keep_mode": "count"}
    cfg_days = {"keep": 1, "keep_auto": 5, "keep_mode": "days",
                "keep_days_manual": 30, "keep_days_auto": 30}
    root_b = str(tmp_path / "backup_b")
    for root in (str(backup_root), root_b):
        _make_backup(root, "1", _stamp_days_ago(5))
        _make_backup(root, "1", _stamp_days_ago(3))

    removed_count, _ = store.enforce_from_config(str(backup_root), "1", cfg_count)
    assert removed_count == 1  # count：5 天前那份超份数上限 → 删（不看年龄）

    removed_days, _ = store.enforce_from_config(root_b, "1", cfg_days)
    assert removed_days == 0  # days：超份数但没超龄 → 留（交集才删）
