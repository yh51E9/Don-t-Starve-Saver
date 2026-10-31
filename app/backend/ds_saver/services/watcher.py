# -*- coding: utf-8 -*-
"""自动备份巡检。

变化检测算法原样沿用 v4.1（这套是验证过的）：
  - 每 5 秒看一次世界文件的 (mtime_ns, size)
  - 连续两轮签名一致才认为"写完了"，避免拷到半截存档
  - 启动首轮只记基线，不会开机给所有世界各打一份

P1-5 加的三件事：
  - auto_mode = change | interval | both：固定间隔模式由 _last_attempt 表驱动
  - min_gap 抑制：变化备份和定时备份共用"最后提交时间"表，定时备份
    不会挤掉刚存盘的变化备份，反之亦然
  - next_due_at：下一次定时备份的到期时间，推给前端显示
"""
import logging
import os
import threading
import time

log = logging.getLogger(__name__)


class Watcher(threading.Thread):
    def __init__(self, session, runner, bus, interval: float = 5.0, cooldown: float = 60.0):
        super().__init__(name="ds-watcher", daemon=True)
        self._session = session
        self._runner = runner
        self._bus = bus
        self._interval = interval
        self._cooldown = cooldown
        self._stop = threading.Event()
        self._seen: dict[str, tuple] = {}
        self._candidate: dict[str, tuple] = {}
        self._last_attempt: dict[str, float] = {}  # 每槽位：上次自动备份提交时间
        self._primed_for = ""
        self._primed_at = 0.0

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        # 状态灯语义：starting=黄（启动中）→ watching=绿（巡检正常）/ error=红（巡检异常）
        self._publish("starting")
        while not self._stop.wait(self._interval):
            try:
                self._tick()
            except Exception as exc:
                log.exception("watcher tick failed")
                # 红灯亮起；下一拍成功会自动转回 watching（绿）
                self._publish("error", error=str(exc).strip() or exc.__class__.__name__)

    def _tick(self) -> None:
        session = self._session
        if not session.auto_on:
            self._publish("paused")
            return

        save_dir = session.save_dir
        worlds = session.worlds_copy()
        if not save_dir or not worlds:
            self._publish("idle")
            return

        if save_dir != self._primed_for:
            self._seen.clear()
            self._candidate.clear()
            self._last_attempt.clear()
            self._primed_for = save_dir
            self._primed_at = time.time()

        cfg = session.cfg
        mode = cfg.get("auto_mode", "change")
        min_gap = max(int(cfg.get("auto_min_gap_min", 5)), 1) * 60
        interval_sec = max(int(cfg.get("auto_interval_min", 30)), 1) * 60

        alive = set()
        now = time.time()
        changed_slots: list[str] = []
        for world in worlds:
            sid = str(world["index"])
            changed = False
            for fname in world.get("files") or []:
                path = os.path.join(save_dir, fname)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                alive.add(fname)
                signature = (stat.st_mtime_ns, stat.st_size)
                previous = self._seen.get(fname)
                if previous is None:
                    self._seen[fname] = signature
                    continue
                if signature != previous:
                    if self._candidate.get(fname) == signature:
                        self._seen[fname] = signature
                        self._candidate.pop(fname, None)
                        changed = True
                    else:
                        self._candidate[fname] = signature
            if changed:
                changed_slots.append(sid)

        # 变化时备份：写完 + 冷却 + min_gap（定时备份刚打过的不再立刻打）
        if mode in ("change", "both"):
            for sid in changed_slots:
                if now - self._last_attempt.get(sid, 0.0) >= max(self._cooldown, min_gap):
                    # 提交时刻游戏还活着 = 游戏内写盘（游戏保存）；已退出 = 退出存盘（游戏关闭）
                    kind = "autosave" if self._game_running() else "autoexit"
                    self._submit(sid, now, tag=kind)

        # 固定间隔备份：两种模式下都检查；only_when_running 只在游戏开着时打。
        # 从没提交过 → 以基线时间（启动/切目录）为起点，开机不乱打。
        if mode in ("interval", "both"):
            game_needed = bool(cfg.get("auto_only_when_running", False))
            game_running: bool | None = None
            for world in worlds:
                sid = str(world["index"])
                baseline = self._last_attempt.get(sid, self._primed_at)
                if now - baseline < interval_sec:
                    continue
                if game_needed:
                    if game_running is None:  # 惰性查询，带 3 秒缓存
                        game_running = self._game_running()
                    if not game_running:
                        continue
                self._submit(sid, now, tag="tick")

        # 文件被删了就把记忆一起删掉，否则长时间运行会慢慢涨
        for name in list(self._seen):
            if name not in alive:
                self._seen.pop(name, None)
                self._candidate.pop(name, None)

        self._publish("watching")

    def _submit(self, slot_id: str, now: float, tag: str = "auto") -> None:
        self._last_attempt[slot_id] = now
        self._bus.emit("auto.triggered", slot_id=slot_id)
        self._runner.submit("backup", slot_id=slot_id, tag=tag)

    def _game_running(self) -> bool:
        from ..core import store

        try:
            return store.is_game_running()
        except Exception:
            return False

    def _next_due_at(self) -> float | None:
        """下一次定时备份到期时间（全部槽位里最早的）。变化模式没有"到期"。"""
        cfg = self._session.cfg
        if cfg.get("auto_mode", "change") not in ("interval", "both"):
            return None
        interval_sec = max(int(cfg.get("auto_interval_min", 30)), 1) * 60
        if not self._last_attempt:
            return None
        return min(t + interval_sec for t in self._last_attempt.values())

    def _publish(self, state: str, error: str | None = None) -> None:
        session = self._session
        session.watcher_state = {"state": state, "last_tick_at": time.time(), "error": error}
        self._bus.emit("watcher.state", state=state, last_tick_at=session.watcher_state["last_tick_at"],
                       auto_on=session.auto_on, next_due_at=self._next_due_at(), error=error)
