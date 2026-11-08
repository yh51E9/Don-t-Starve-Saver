# -*- coding: utf-8 -*-
"""接口层契约：信封形状、任务队列、事件轮询、错误码。"""
import os
import time

import pytest

from ds_saver.api.js_api import JsApi
from ds_saver.core import scan
from ds_saver.services.eventbus import EventBus
from ds_saver.services.jobs import JobRunner
from ds_saver.services.session import Session


@pytest.fixture
def api(isolated_paths, save_dir, monkeypatch):
    monkeypatch.setattr(scan, "locate_save_dirs", lambda: [str(save_dir)])
    bus = EventBus()
    session = Session(bus)
    runner = JobRunner(bus, session)
    runner.start()
    api = JsApi(session, runner, bus, host=None)
    yield api
    runner.stop()


def _wait_job(api, job_id, timeout=8.0):
    """等指定任务收敛，不能只看"有没有 job.done"——上一个任务的事件还在缓冲里。"""
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


def test_bootstrap_shape(api):
    result = api.bootstrap()
    assert result["ok"] is True
    data = result["data"]
    for key in ("version", "config", "options", "worlds", "backups", "stats",
                "save_dir", "selected_slot", "auto_on", "watcher", "platform"):
        assert key in data
    assert len(data["worlds"]) == 2
    assert data["worlds"][0]["id"] == "1"
    assert "backup_count" in data["worlds"][0]
    assert data["config"]["theme_preset"] == "nightfall"


def test_select_unknown_world_returns_error_envelope(api):
    result = api.select_world("nope")
    assert result["ok"] is False
    assert result["error"]["code"] == "E_UNKNOWN_SLOT"
    assert result["data"] is None


def test_pick_folder_without_host_is_graceful(api):
    result = api.pick_folder("save_dir")
    assert result["ok"] is False
    assert result["error"]["code"] == "E_NOT_SUPPORTED"


def test_backup_job_emits_done_and_refreshes(api):
    result = api.backup("1")
    assert result["ok"] is True
    job_id = result["data"]["job_id"]
    assert job_id

    events, done = _wait_job(api, job_id)
    types = [event["type"] for event in events]
    assert "job.started" in types
    assert done["type"] == "job.done"
    assert done["payload"]["kind"] == "backup"
    assert done["payload"]["backup"]["file_count"] == 3
    assert "path" not in done["payload"]["backup"]

    backups = api.list_backups("1")["data"]["backups"]
    assert len(backups) == 1
    assert backups[0]["tag"] == "manual"
    assert api.bootstrap()["data"]["worlds"][0]["backup_count"] == 1


def test_cleanup_job_reports_removed(api):
    job_id = api.backup("1")["data"]["job_id"]
    _wait_job(api, job_id)

    result = api.cleanup("all")
    assert result["ok"] is True
    _events, done = _wait_job(api, result["data"]["job_id"])
    assert done["type"] == "job.done"
    assert done["payload"]["kind"] == "cleanup"
    assert "removed" in done["payload"]


def test_path_escape_is_rejected_at_api_boundary(api):
    result = api.delete_backup(r"1:..\..\Windows")
    assert result["ok"] is False
    assert result["error"]["code"] == "E_PATH_ESCAPE"


def test_preview_restore_includes_game_flag(api):
    job_id = api.backup("1")["data"]["job_id"]
    _wait_job(api, job_id)
    backup = api.list_backups("1")["data"]["backups"][0]
    preview = api.preview_restore(backup["id"])
    assert preview["ok"] is True
    assert preview["data"]["backup_day"] == 42
    assert "game_running" in preview["data"]


def test_restore_blocked_while_game_running_without_confirm(api, monkeypatch):
    """游戏在跑且用户没勾「没在玩这个存档」→ 拦住。"""
    from ds_saver.core import store

    job_id = api.backup("1")["data"]["job_id"]
    _wait_job(api, job_id)
    backup = api.list_backups("1")["data"]["backups"][0]
    monkeypatch.setattr(store, "is_game_running", lambda *a, **k: True)
    result = api.restore(backup["id"])
    assert result["ok"] is False
    assert result["error"]["code"] == "E_GAME_RUNNING"


def test_restore_confirmed_idle_bypasses_game_check(api, monkeypatch):
    """勾了确认 → 游戏在跑也放行（API 层与任务复检都跳过）。"""
    from ds_saver.core import store

    job_id = api.backup("1")["data"]["job_id"]
    _wait_job(api, job_id)
    backup = api.list_backups("1")["data"]["backups"][0]
    monkeypatch.setattr(store, "is_game_running", lambda *a, **k: True)
    result = api.restore(backup["id"], confirmed_idle=True)
    assert result["ok"] is True
    _events, done = _wait_job(api, result["data"]["job_id"])
    assert done["type"] == "job.done"
    assert done["payload"]["kind"] == "restore"


def test_settings_roundtrip(api):
    result = api.save_settings({"theme_preset": "brass", "font_size": 18, "keep": 3})
    assert result["ok"] is True
    assert result["data"]["config"]["theme_preset"] == "brass"
    assert api.get_settings()["data"]["config"]["font_size"] == 18  # 自定义字号 14-22：18 原样保存


def test_cancel_unknown_job(api):
    result = api.cancel_job("nope")
    assert result["ok"] is False
    assert result["error"]["code"] == "E_BAD_ARGS"


def test_candidate_exclude_restore_roundtrip(api):
    """排除幽灵路径 → 落盘；恢复 → 清空；幂等恢复不炸。"""
    ghost = os.path.normpath(r"C://Nowhere//Gone//backups")
    excluded = api.exclude_save_candidate(ghost)["data"]
    assert excluded["excluded"] == [ghost]

    # 落盘验证
    assert api.bootstrap()["data"]["config"]["excluded_candidates"] == [ghost]

    restored = api.restore_save_candidate(ghost)["data"]
    assert restored["excluded"] == []
    # 幂等：恢复不存在的路径也不炸
    again = api.restore_save_candidate(ghost)["data"]
    assert again["excluded"] == []


def test_candidate_exclude_rejects_current_dir(api):
    """当前正在使用的存档目录不允许排除。"""
    save_dir = api.bootstrap()["data"]["save_dir"]
    result = api.exclude_save_candidate(save_dir)
    assert result["error"]["code"] == "E_BAD_ARGS"


def test_candidate_exclude_survives_rescan(api):
    """排除后重新扫描，排除列表仍在（候选本来就过滤掉了）。"""
    ghost = os.path.normpath(r"C://Nowhere//Gone//backups")
    api.exclude_save_candidate(ghost)
    again = api.list_save_candidates()["data"]
    assert ghost in again["excluded"]
    assert ghost not in [c["path"] for c in again["candidates"]]
