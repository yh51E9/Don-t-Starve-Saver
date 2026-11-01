# -*- coding: utf-8 -*-
"""删除存档：回收站移动、saveindex 改写、回滚、备份联动。"""
import os
import time

import pytest

from ds_saver.api.js_api import JsApi
from ds_saver.core import klei, store
from ds_saver.core import scan
from ds_saver.services.eventbus import EventBus
from ds_saver.services.jobs import JobRunner
from ds_saver.services.session import Session


@pytest.fixture
def api(isolated_paths, save_dir, monkeypatch):
    monkeypatch.setattr(scan, "locate_save_dirs", lambda: [str(save_dir)])
    # 测试与真实环境隔离：本机开着游戏时 delete_save 会因 GAME_RUNNING 拒绝
    monkeypatch.setattr(store, "is_game_running", lambda *a, **k: False)
    bus = EventBus()
    session = Session(bus)
    runner = JobRunner(bus, session)
    runner.start()
    api = JsApi(session, runner, bus, host=None)
    yield api
    runner.stop()


def _wait_job(api, job_id, timeout=8.0):
    deadline = time.time() + timeout
    events = []
    while time.time() < deadline:
        events = api.poll_events(0)["data"]["events"]
        for event in events:
            if (event["type"] in ("job.done", "job.failed")
                    and event["payload"].get("job_id") == job_id):
                return events, event
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} 没有在 {timeout}s 内结束，事件：{events}")


def _saveindex_data(save_dir: str) -> dict:
    return klei.parse_lua_table(klei.decode_klei_file(os.path.join(save_dir, "saveindex")))


def _world(save_dir: str, slot_id: str) -> dict:
    return next(s for s in klei.load_slots(save_dir) if s["index"] == slot_id)


# ---------------- store 层：回收站 ----------------

def test_trash_slot_files_moves_and_keeps_saveindex(save_dir, backup_root):
    world = _world(str(save_dir), "1")
    info = store.trash_slot_files(str(save_dir), world, str(backup_root))

    for name in info["moved"]:
        assert not os.path.exists(os.path.join(save_dir, name))
        assert os.path.isfile(os.path.join(info["dir"], name))
    # saveindex 不动（由写回流程负责）
    assert os.path.isfile(os.path.join(save_dir, "saveindex"))
    # 回收站不在 slot_* 命名空间里，stats 不统计
    assert store.stats(str(backup_root))["total_bytes"] == 0


def test_trash_rolls_back_on_move_failure(save_dir, backup_root, monkeypatch):
    world = _world(str(save_dir), "1")
    real_move = __import__("shutil").move
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:  # 只在第二个文件失败；回滚阶段的 move 要能成功
            raise OSError("disk full")
        return real_move(src, dst)

    monkeypatch.setattr(store.shutil, "move", flaky)
    try:
        store.trash_slot_files(str(save_dir), world, str(backup_root))
        raised = False
    except Exception:
        raised = True
    assert raised
    # 已移走的第一个文件必须被移回来
    for name in world["files"]:
        assert os.path.exists(os.path.join(save_dir, name))


def test_purge_trash_only_removes_old(tmp_path, backup_root):
    world = {"index": "1", "files": ["survival_1"]}
    (tmp_path / "survival_1").write_bytes(b"x" * 256)
    store.trash_slot_files(str(tmp_path), world, str(backup_root))
    assert store.purge_trash(str(backup_root), keep_days=7)["removed"] == 0
    # 把时间戳目录的 mtime 拨回 8 天前
    import os
    import time
    trash = os.path.join(str(backup_root), "_trash")
    stamp_dir = os.listdir(trash)[0]
    old = time.time() - 9 * 86400
    os.utime(os.path.join(trash, stamp_dir), (old, old))
    result = store.purge_trash(str(backup_root), keep_days=7)
    assert result["removed"] == 1


# ---------------- 任务层：完整删除流程 ----------------

def test_delete_save_job_empties_slot_and_keeps_pre(api, save_dir, backup_root):
    # 先造一份备份，验证 delete_backups=False 时它保留
    job = api.backup("1")["data"]["job_id"]
    _events, done = _wait_job(api, job)
    assert done["type"] == "job.done"

    result = api.delete_save("2", delete_backups=False)
    assert result["ok"] is True
    _events, done = _wait_job(api, result["data"]["job_id"])
    assert done["type"] == "job.done"
    assert done["payload"]["kind"] == "delete_world"
    assert done["payload"]["removed_backups"] == 0

    # saveindex 里槽位 2 被清空但还在（不位移），槽位 1 无损
    data = _saveindex_data(str(save_dir))
    slots = data["slots"]
    array = slots.get("__array__") if isinstance(slots, dict) else slots
    assert array[1].get("character") is None
    assert array[0].get("character") == "wilson"

    # 文件进了回收站
    moved = done["payload"]["moved"]
    assert moved
    for name in moved:
        assert not os.path.exists(os.path.join(str(save_dir), name))

    # 自动拍了 _pre 快照
    assert done["payload"]["pre_backup"]["tag"] == "pre"

    # 世界列表里不再有槽位 2
    worlds = api.list_worlds()["data"]["worlds"]
    assert all(w["id"] != "2" for w in worlds)
    # 槽位 1 的备份还在
    assert len(api.list_backups("1")["data"]["backups"]) >= 1


def test_delete_save_with_backups_removes_them(api, save_dir):
    job = api.backup("2")["data"]["job_id"]
    _wait_job(api, job)

    result = api.delete_save("2", delete_backups=True)
    _events, done = _wait_job(api, result["data"]["job_id"])
    assert done["payload"]["removed_backups"] >= 1
    assert api.list_backups("2")["data"]["backups"] == []


def test_delete_save_blocked_while_game_running(api, monkeypatch):
    from ds_saver.core import store
    monkeypatch.setattr(store, "is_game_running", lambda: True)
    result = api.delete_save("1", delete_backups=False)
    assert result["ok"] is False
    assert result["error"]["code"] == "E_GAME_RUNNING"


def test_delete_save_rolls_back_when_index_write_fails(api, save_dir, monkeypatch):
    import ds_saver.core.klei as klei_mod

    original = (save_dir / "saveindex").read_bytes()

    def broken_write(save_dir_arg, data, original_bytes=None):
        raise OSError("simulated disk full")

    monkeypatch.setattr(klei_mod, "write_saveindex_atomic", broken_write)
    result = api.delete_save("1", delete_backups=False)
    _events, done = _wait_job(api, result["data"]["job_id"])
    assert done["type"] == "job.failed"

    # 文件回到存档目录、saveindex 原样
    assert (save_dir / "survival_1").exists()
    assert (save_dir / "saveindex").read_bytes() == original
    worlds = api.list_worlds()["data"]["worlds"]
    assert any(w["id"] == "1" for w in worlds)


def test_game_running_flag(api):
    result = api.game_running()
    assert result["ok"] is True
    assert result["data"]["running"] in (True, False)


# ---------------- is_game_running 检测加固 ----------------


class _FakeResult:
    def __init__(self, stdout):
        self.stdout = stdout


def _patch_tasklist(monkeypatch, stdout, calls, native=None):
    def fake_run(*args, **kwargs):
        calls.append(args)
        return _FakeResult(stdout)

    monkeypatch.setattr(store.subprocess, "run", fake_run)
    monkeypatch.setattr(store, "_running_cache", {"checked_at": 0.0, "value": False})
    if native is not None:
        # None = 模拟原生枚举不可用，逼 is_game_running 走 tasklist 兜底
        monkeypatch.setattr(store, "_native_game_running", native)


def test_game_running_matches_steam_variant(monkeypatch):
    """dontstarve_steam.exe 等变体镜像名也必须命中（旧版只认 dontstarve.exe）。"""
    calls = []
    stdout = (
        '"explorer.exe","567","Console","1","50,000 K"\n'
        '"dontstarve_steam.exe","1234","Console","1","100,000 K"\n'
    )
    _patch_tasklist(monkeypatch, stdout, calls, native=lambda: None)
    assert store.is_game_running() is True


def test_game_running_ignores_other_processes(monkeypatch):
    calls = []
    stdout = '"explorer.exe","567","Console","1","50,000 K"\n'
    _patch_tasklist(monkeypatch, stdout, calls, native=lambda: None)
    assert store.is_game_running() is False


def test_game_running_force_bypasses_cache(monkeypatch):
    """缓存刚查过且说没在跑，force=True 也要重新查——破坏性动作前的复检。"""
    calls = []
    stdout = '"dontstarve.exe","1","Console","1","1 K"\n'
    monkeypatch.setattr(store, "_running_cache", {"checked_at": time.time(), "value": False})
    _patch_tasklist(monkeypatch, stdout, calls, native=lambda: None)
    assert store.is_game_running(force=True) is True
    assert calls, "force=True 必须真的发起查询"


def test_game_running_uses_cache_when_fresh(monkeypatch):
    calls = []
    _patch_tasklist(monkeypatch, "", calls)
    monkeypatch.setattr(store, "_running_cache", {"checked_at": time.time(), "value": True})
    assert store.is_game_running() is True
    assert calls == [], "缓存新鲜时不应起子进程"


def test_game_running_native_takes_priority(monkeypatch):
    """原生枚举可用时直接采信，不起 tasklist 子进程。"""
    calls = []
    _patch_tasklist(monkeypatch, '"dontstarve.exe","1","Console","1","1 K"\n', calls,
                    native=lambda: False)
    assert store.is_game_running() is False
    assert calls == [], "原生路径命中时不应走兜底"
