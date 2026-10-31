# -*- coding: utf-8 -*-
"""P1-5：自动备份策略（变化/间隔/两者、min_gap、only_when_running）。"""
import threading
import time

import pytest

from ds_saver.services.eventbus import EventBus
from ds_saver.services.watcher import Watcher


class FakeRunner:
    def __init__(self):
        self.submitted = []

    def submit(self, kind, **params):
        self.submitted.append((kind, params))
        return f"job-{len(self.submitted)}"


class FakeSession:
    def __init__(self, save_dir, worlds, cfg):
        self.auto_on = True
        self.save_dir = save_dir
        self.worlds = worlds
        self.cfg = cfg
        self.watcher_state = {"state": "idle", "last_tick_at": 0.0}

    def worlds_copy(self):
        return list(self.worlds)


@pytest.fixture
def world_dir(tmp_path):
    save_dir = tmp_path / "remote"
    save_dir.mkdir()
    (save_dir / "survival_1").write_bytes(b"x" * 64)
    (save_dir / "saveindex").write_bytes(b"x" * 16)
    return save_dir


def make_watcher(world_dir, cfg):
    worlds = [{"index": 1, "files": ["survival_1", "saveindex"]}]
    session = FakeSession(str(world_dir), worlds, cfg)
    bus = EventBus()
    runner = FakeRunner()
    watcher = Watcher(session, runner, bus, interval=0.01)
    return watcher, runner, session, bus


def touch(path, extra=0):
    path.write_bytes(b"x" * (64 + extra))


def test_change_mode_unchanged_behavior(world_dir):
    """变化模式：两轮稳定才提交，行为与 v4.1 一致。"""
    watcher, runner, _, _ = make_watcher(world_dir, {"auto_mode": "change"})
    watcher._tick()
    assert runner.submitted == []  # 首轮只建基线

    touch(world_dir / "survival_1", 10)
    watcher._tick()
    assert runner.submitted == []  # 第一轮变化只记候选

    watcher._tick()
    assert len(runner.submitted) == 1  # 第二轮稳定 → 提交
    kind, params = runner.submitted[0]
    assert kind == "backup" and params["slot_id"] == "1"
    # 变化备份按提交时刻游戏状态分类（游戏保存 / 游戏关闭）
    assert params["tag"] in ("autosave", "autoexit")


def test_change_tag_follows_game_running(world_dir):
    """变化备份的来源分类：游戏活着=游戏保存，已退出=游戏关闭。"""
    watcher, runner, _, _ = make_watcher(world_dir, {"auto_mode": "change"})
    watcher._game_running = lambda: True
    watcher._tick()
    touch(world_dir / "survival_1", 10)
    watcher._tick()
    watcher._tick()
    assert runner.submitted[0][1]["tag"] == "autosave"

    watcher2, runner2, _, _ = make_watcher(world_dir, {"auto_mode": "change"})
    watcher2._game_running = lambda: False
    watcher2._tick()
    touch(world_dir / "survival_1", 20)
    watcher2._tick()
    watcher2._tick()
    assert runner2.submitted[0][1]["tag"] == "autoexit"


def test_interval_tag_is_tick(world_dir):
    """固定间隔的定时备份 tag=tick。"""
    watcher, runner, _, _ = make_watcher(
        world_dir, {"auto_mode": "interval", "auto_interval_min": 30, "auto_min_gap_min": 5})
    watcher._tick()
    watcher._last_attempt["1"] = time.time() - 31 * 60
    watcher._tick()
    assert runner.submitted[0][1]["tag"] == "tick"


def test_interval_mode_fires_when_due(world_dir):
    watcher, runner, _, _ = make_watcher(
        world_dir, {"auto_mode": "interval", "auto_interval_min": 30, "auto_min_gap_min": 5})
    watcher._tick()
    assert runner.submitted == []  # 没到间隔

    # 把上次提交时间拨回 31 分钟前
    watcher._last_attempt["1"] = time.time() - 31 * 60
    watcher._tick()
    assert len(runner.submitted) == 1

    watcher._tick()
    assert len(runner.submitted) == 1  # 刚打过，间隔未到，不重复


def test_min_gap_suppresses_after_change_backup(world_dir):
    """both 模式：定时备份刚提交过，min_gap 内的变化备份不再立刻打。"""
    watcher, runner, _, _ = make_watcher(
        world_dir, {"auto_mode": "both", "auto_interval_min": 30, "auto_min_gap_min": 5})
    watcher._tick()  # 建基线

    # 假设定时备份刚刚提交过
    watcher._last_attempt["1"] = time.time()
    touch(world_dir / "survival_1", 10)
    watcher._tick()
    watcher._tick()  # 两轮稳定
    assert runner.submitted == []  # min_gap 抑制

    # 把提交时间拨回 6 分钟前 → 新一轮变化备份放行
    watcher._last_attempt["1"] = time.time() - 6 * 60
    touch(world_dir / "survival_1", 20)
    watcher._tick()
    watcher._tick()
    assert len(runner.submitted) == 1


def test_only_when_running_gates_interval(world_dir, monkeypatch):
    from ds_saver.core import store

    watcher, runner, _, _ = make_watcher(
        world_dir, {"auto_mode": "interval", "auto_interval_min": 30,
                    "auto_min_gap_min": 5, "auto_only_when_running": True})
    watcher._tick()
    watcher._last_attempt["1"] = time.time() - 31 * 60

    monkeypatch.setattr(store, "is_game_running", lambda *a, **k: False)
    watcher._tick()
    assert runner.submitted == []  # 游戏没开，定时备份不打

    monkeypatch.setattr(store, "is_game_running", lambda *a, **k: True)
    watcher._tick()
    assert len(runner.submitted) == 1


def test_paused_and_idle_states(world_dir):
    watcher, runner, session, _ = make_watcher(world_dir, {"auto_mode": "change"})
    session.auto_on = False
    watcher._tick()
    assert session.watcher_state["state"] == "paused"

    session.auto_on = True
    session.save_dir = ""
    watcher._tick()
    assert session.watcher_state["state"] == "idle"


def test_next_due_at_only_in_interval_modes(world_dir):
    watcher, _, session, _ = make_watcher(
        world_dir, {"auto_mode": "interval", "auto_interval_min": 30})
    assert watcher._next_due_at() is None  # 从没提交过
    watcher._last_attempt["1"] = time.time()
    due = watcher._next_due_at()
    assert due is not None and due > time.time()

    session.cfg["auto_mode"] = "change"
    assert watcher._next_due_at() is None
