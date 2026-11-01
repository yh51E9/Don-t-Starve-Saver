# -*- coding: utf-8 -*-
"""撤销体系：删除备份进回收站可回滚、删除存档可撤销、孤儿快照识别。"""
import base64
import os
import time
import zlib

import pytest

from ds_saver.api.js_api import JsApi
from ds_saver.core import klei, store
from ds_saver.core import scan
from ds_saver.services.eventbus import EventBus
from ds_saver.services.jobs import JobRunner
from ds_saver.services.session import Session


def _encode(lua_text: str) -> bytes:
    return b"KLEI     1D" + base64.b64encode(zlib.compress(lua_text.encode("utf-8")))


@pytest.fixture
def api(isolated_paths, save_dir, monkeypatch):
    monkeypatch.setattr(scan, "locate_save_dirs", lambda: [str(save_dir)])
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
    while time.time() < deadline:
        for event in api.poll_events(0)["data"]["events"]:
            if (event["type"] in ("job.done", "job.failed")
                    and event["payload"].get("job_id") == job_id):
                return event
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} 没有在 {timeout}s 内结束")


def test_delete_backup_goes_to_trash_and_undo_restores(api):
    job = api.backup("1")["data"]["job_id"]
    assert _wait_job(api, job)["type"] == "job.done"
    backups = api.list_backups("1")["data"]["backups"]
    assert len(backups) == 1
    bid = backups[0]["id"]

    result = api.delete_backup(bid)
    assert result["ok"] is True
    assert result["data"]["backups"] == []

    undo_result = api.undo_last()
    assert undo_result["ok"] is True
    backups = api.list_backups("1")["data"]["backups"]
    assert len(backups) == 1 and backups[0]["id"] == bid


def test_undo_delete_world_restores_slot(api, save_dir):
    result = api.delete_save("2", delete_backups=False)
    assert result["ok"] is True
    done = _wait_job(api, result["data"]["job_id"])
    assert done["type"] == "job.done"
    worlds = api.list_worlds()["data"]["worlds"]
    assert all(w["id"] != "2" for w in worlds)

    undo_result = api.undo_last()
    assert undo_result["ok"] is True
    worlds = api.list_worlds()["data"]["worlds"]
    assert any(w["id"] == "2" for w in worlds)
    assert os.path.isfile(os.path.join(save_dir, "shipwrecked_2"))


def test_undo_without_history_returns_error(api):
    result = api.undo_last()
    assert result["ok"] is False


def test_orphan_backups_detects_deleted_world(save_dir, backup_root):
    lua = ('return { slots = { { character="wilson", save_id="world-old", '
           'current_mode="survival", modes={ survival={ day=5, files={ "survival_1" } } } } } }')
    (save_dir / "saveindex").write_bytes(_encode(lua))
    world = klei.load_slots(str(save_dir))[0]
    pre = store.backup_slot(str(save_dir), world, str(backup_root), tag="pre")

    # 当前世界换了 save_id：旧快照成了「已删除世界」的孤儿
    items = store.orphan_backups(str(backup_root), ["world-new"])
    assert len(items) == 1
    assert items[0]["stamp"] == pre["stamp"]
    # save_id 仍属于当前世界：不算孤儿
    assert store.orphan_backups(str(backup_root), ["world-old"]) == []