# -*- coding: utf-8 -*-
"""会话：进程里唯一可变状态。

只在这里持有「当前存档目录 / 世界列表 / 选中项 / 配置」，
所有读写都过一把 RLock——pywebview 的 js_api 每个调用可能在不同线程里。
"""
import os
import threading
import time

from .. import __version__
from ..core import config as config_mod
from ..core import klei, models, paths, scan, store
from ..core.errors import DsError, ErrorCode


class Session:
    def __init__(self, bus):
        self._bus = bus
        self._lock = threading.RLock()
        self.cfg, self.warnings = config_mod.load()
        self.save_dirs: list[str] = []
        self.save_dir: str = ""
        self.worlds: list[dict] = []
        self.selected_id: str | None = None
        self.auto_on: bool = bool(self.cfg.get("auto_backup", True))
        self.watcher_state = {"state": "idle", "last_tick_at": 0.0}
        self._boot()

    # ---------- 启动 ----------

    def _boot(self) -> None:
        try:
            self.save_dirs = scan.locate_save_dirs()
        except Exception:
            self.save_dirs = []
        candidate = self.cfg.get("save_dir") or ""
        if not candidate or not os.path.isfile(os.path.join(candidate, "saveindex")):
            candidate = self.save_dirs[0] if self.save_dirs else ""
        if candidate:
            try:
                self._load_dir(candidate, persist=False)
            except DsError:
                self.save_dir, self.worlds, self.selected_id = "", [], None
            else:
                if not self.cfg.get("save_dir"):
                    # 自动探测到的目录落盘一次，下次启动不靠重新扫描
                    self.cfg["save_dir"] = candidate
                    try:
                        self.cfg = config_mod.save(self.cfg)
                    except OSError:
                        pass

    # ---------- 存档目录 ----------

    def _load_dir(self, path: str, persist: bool = True) -> None:
        path = config_mod.require_save_dir(path)
        worlds = store_worlds(path)
        with self._lock:
            self.save_dir = path
            self.worlds = worlds
            ids = [str(world["index"]) for world in worlds]
            if self.selected_id not in ids:
                self.selected_id = ids[0] if ids else None
            if persist:
                self.cfg["save_dir"] = path
        if persist:
            try:
                self.cfg = config_mod.save(self.cfg)
            except OSError:
                pass
        self._bus.emit("data.worlds_changed")

    def set_save_dir(self, path: str) -> dict:
        self._load_dir(path, persist=True)
        return self.snapshot_lite()

    def refresh_worlds(self) -> None:
        with self._lock:
            path = self.save_dir
        if not path:
            return
        worlds = store_worlds(path)
        with self._lock:
            self.worlds = worlds
            ids = [str(world["index"]) for world in worlds]
            if self.selected_id not in ids:
                self.selected_id = ids[0] if ids else None
        self._bus.emit("data.worlds_changed")

    # ---------- 世界 ----------

    def select(self, slot_id: str) -> dict:
        world = self.world(slot_id)
        with self._lock:
            self.selected_id = str(slot_id)
        return world

    def world(self, slot_id: str) -> dict:
        with self._lock:
            for world in self.worlds:
                if str(world["index"]) == str(slot_id):
                    return world
        raise DsError(ErrorCode.UNKNOWN_SLOT, "这个世界已经不在存档里了", {"slot": str(slot_id)})

    def selected_world(self) -> dict | None:
        with self._lock:
            slot_id = self.selected_id
        if not slot_id:
            return None
        try:
            return self.world(slot_id)
        except DsError:
            return None

    def worlds_copy(self) -> list[dict]:
        with self._lock:
            return list(self.worlds)

    def worlds_payload(self) -> list[dict]:
        with self._lock:
            worlds = list(self.worlds)
            root = self.backup_root_locked()
        stats = store.stats(root)
        result = []
        for world in worlds:
            view = models.world_view(world)
            per = stats["per_slot"].get(view["id"], {"count": 0, "bytes": 0})
            view["backup_count"] = per["count"]
            view["backup_bytes"] = per["bytes"]
            view["last_backup_at"] = store.latest_backup_iso(root, view["id"])
            result.append(view)
        return result

    # ---------- 备份 ----------

    def backup_root(self) -> str:
        with self._lock:
            return self.backup_root_locked()

    def backup_root_locked(self) -> str:
        root = self.cfg.get("backup_root") or ""
        if not root:
            return store.default_root()
        return paths.resolve_portable(root)

    def backups(self, slot_id: str | None = None) -> list[dict]:
        slot_id = slot_id or self.selected_id
        if not slot_id:
            return []
        return [models.backup_view(item) for item in store.list_backups(self.backup_root(), str(slot_id))]

    # ---------- 配置 ----------

    def update_config(self, patch: dict) -> dict:
        with self._lock:
            old_root = self.backup_root_locked()
            old_save_dir = self.save_dir
            merged = dict(self.cfg)
            merged.update(patch or {})
            self.cfg = config_mod.save(merged)
            self.auto_on = bool(self.cfg.get("auto_backup", True))
            new_root = self.backup_root_locked()
            new_save_dir = self.cfg.get("save_dir") or old_save_dir
        if new_root != old_root:
            self._bus.emit("data.backups_changed", slot_id="")
        if new_save_dir and new_save_dir != old_save_dir:
            try:
                self._load_dir(new_save_dir, persist=False)
            except DsError:
                pass
        return self.cfg

    def set_auto(self, on: bool) -> dict:
        on = bool(on)
        with self._lock:
            self.auto_on = on
            merged = dict(self.cfg)
            merged["auto_backup"] = on
            try:
                self.cfg = config_mod.save(merged)
            except OSError:
                pass
            # 状态灯：开=starting（黄，等第一拍巡检成功转绿）；关=paused（灰）
            self.watcher_state = {"state": "starting" if on else "paused",
                                  "last_tick_at": self.watcher_state.get("last_tick_at", 0.0),
                                  "error": None}
        self._bus.emit("watcher.state", state=self.watcher_state["state"],
                       last_tick_at=self.watcher_state["last_tick_at"], auto_on=on)
        return {"auto_on": on}

    # ---------- 快照 ----------

    def snapshot_lite(self) -> dict:
        with self._lock:
            return {
                "save_dir": self.save_dir,
                "save_dirs": list(self.save_dirs),
                "worlds": self.worlds_payload(),
                "selected_slot": self.selected_id,
                "backups": self.backups(self.selected_id) if self.selected_id else [],
            }

    def bootstrap(self) -> dict:
        with self._lock:
            cfg = dict(self.cfg)
            save_dir = self.save_dir
            save_dirs = list(self.save_dirs)
            selected = self.selected_id
            auto_on = self.auto_on
            watcher_state = dict(self.watcher_state)
        payload = {
            "version": __version__,
            "event_seq": self._bus.seq,  # 新窗口从这里起读事件，绝不重放历史
            "config": cfg,
            "defaults": dict(config_mod.DEFAULTS),
            "options": config_mod.OPTIONS,
            "save_dir": save_dir,
            "save_dirs": save_dirs,
            "worlds": self.worlds_payload(),
            "selected_slot": selected,
            "backups": self.backups(selected) if selected else [],
            "stats": store.stats(self.backup_root()),
            "auto_on": auto_on,
            "watcher": watcher_state,
            "warnings": list(self.warnings),
            "platform": {"app_dir": paths.app_dir(), "backup_root": self.backup_root()},
        }
        return payload


def store_worlds(save_dir: str) -> list[dict]:
    """读取非空槽位。空槽位没有文件，不值得显示。"""
    slots = []
    for slot in klei.load_slots(save_dir) or []:
        if not slot.get("files"):
            continue
        slots.append(slot)
    return slots
