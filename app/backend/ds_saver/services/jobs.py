# -*- coding: utf-8 -*-
"""单 worker 任务队列。

旧版是"每个动作起一个线程 + busy 标志 + 帧循环轮询 pending"，
结果是 busy 时自动备份的队列条目被直接丢掉。现在所有写盘动作排队串行执行：
不会并发、不会丢、失败也不会互相污染。
"""
import logging
import queue
import threading
import time

import os

from ..core import klei, models, store
from ..core.errors import DsError, ErrorCode
from .progress import ProgressReporter

log = logging.getLogger(__name__)


class JobRunner:
    def __init__(self, bus, session):
        self._bus = bus
        self._session = session
        self._queue: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._seq = 0
        self._current: str | None = None
        self._thread: threading.Thread | None = None
        self._stopping = False

    # ---------- 生命周期 ----------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="ds-jobs", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stopping = True
        self._queue.put(None)

    # ---------- 提交 ----------

    def submit(self, kind: str, **params) -> str:
        with self._lock:
            if kind == "backup":
                slot_id = str(params.get("slot_id"))
                tag = params.get("tag", "manual")
                for job in self._jobs.values():
                    if (job["kind"] == "backup" and job["state"] in ("queued", "running")
                            and str(job["params"].get("slot_id")) == slot_id
                            and job["params"].get("tag") == tag):
                        return job["id"]  # 幂等：同一世界同一类型不重复排
            self._seq += 1
            job_id = f"j{self._seq}"
            job = {
                "id": job_id,
                "kind": kind,
                "params": params,
                "state": "queued",
                "created_at": time.time(),
                "progress": {"percent": 0, "done": 0, "total": 0},
            }
            self._jobs[job_id] = job
        self._queue.put(job_id)
        return job_id

    def cancel(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                raise DsError(ErrorCode.BAD_ARGS, "没有这个任务", {"job_id": job_id})
            if job["state"] == "queued":
                job["state"] = "cancelled"
                self._bus.emit("job.cancelled", job_id=job_id, kind=job["kind"])
                return {"cancelled": True}
            return {"cancelled": False}

    def is_idle(self) -> bool:
        with self._lock:
            return self._current is None

    def active_job(self) -> dict | None:
        with self._lock:
            if not self._current:
                return None
            return dict(self._jobs.get(self._current) or {})

    # ---------- 执行 ----------

    def _loop(self) -> None:
        while not self._stopping:
            job_id = self._queue.get()
            if job_id is None:
                break
            with self._lock:
                job = self._jobs.get(job_id)
                if not job or job["state"] == "cancelled":
                    continue
                job["state"] = "running"
                self._current = job_id
            self._bus.emit("job.started", job_id=job_id, kind=job["kind"], **job["params"])
            try:
                if job["kind"] == "backup":
                    self._run_backup(job)
                elif job["kind"] == "restore":
                    self._run_restore(job)
                elif job["kind"] == "cleanup":
                    self._run_cleanup(job)
                elif job["kind"] == "delete_world":
                    self._run_delete_world(job)
                else:
                    raise DsError(ErrorCode.BAD_ARGS, f"未知任务类型：{job['kind']}")
                with self._lock:
                    job["state"] = "done"
            except DsError as exc:
                with self._lock:
                    job["state"] = "failed"
                # 预期内失败也留痕：自动备份悄悄失败最难查
                log.warning("job %s failed: [%s] %s", job_id, exc.code, exc.message)
                self._bus.emit("job.failed", job_id=job_id, kind=job["kind"],
                               code=exc.code, message=exc.message, detail=exc.detail)
            except Exception as exc:  # noqa: BLE001
                log.exception("job %s failed", job_id)
                with self._lock:
                    job["state"] = "failed"
                self._bus.emit("job.failed", job_id=job_id, kind=job["kind"],
                               code=ErrorCode.INTERNAL, message="内部错误",
                               detail={"reason": str(exc)})
            finally:
                with self._lock:
                    self._current = None

    def _run_backup(self, job: dict) -> None:
        session = self._session
        slot_id = str(job["params"]["slot_id"])
        tag = job["params"].get("tag", "manual")
        world = session.world(slot_id)
        root = session.backup_root()
        save_dir = session.save_dir
        if not save_dir:
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")

        reporter = ProgressReporter(self._bus, job["id"])
        entry = store.backup_slot(save_dir, world, root, tag=tag, on_progress=reporter)
        removed, freed = store.enforce_from_config(root, slot_id, session.cfg)

        self._bus.emit("job.done", job_id=job["id"], kind="backup", slot_id=slot_id,
                       backup=models.backup_view(entry), removed=removed, freed_bytes=freed,
                       stats=store.stats(root))
        self._bus.emit("data.backups_changed", slot_id=slot_id)
        session.refresh_worlds()

    def _run_restore(self, job: dict) -> None:
        session = self._session
        root = session.backup_root()
        slot_id, backup_path = store.resolve_backup_id(root, job["params"]["backup_id"])
        world = session.world(slot_id)  # 用备份所属世界，不是"当前选中"
        save_dir = session.save_dir
        # 用户勾选过「没在玩这个存档」就跳过复检；没勾过则拦住"提交后游戏才启动"的空档
        if not job["params"].get("confirmed_idle") and store.is_game_running(force=True):
            raise DsError(ErrorCode.GAME_RUNNING, "检测到饥荒正在运行，请先退出游戏再恢复")

        reporter = ProgressReporter(self._bus, job["id"])
        store.validate_backup(backup_path)

        pre = store.backup_slot(save_dir, world, root, tag="pre")
        store.enforce_from_config(root, slot_id, session.cfg)
        restored = store.restore_slot(save_dir, backup_path, on_progress=reporter,
                                      slot_id=slot_id)

        from ..core import undo
        undo.record("restore", f"恢复备份（槽位 {slot_id}）", slot_id,
                    {"backup_id": pre.get("id", "")})
        self._bus.emit("job.done", job_id=job["id"], kind="restore", slot_id=slot_id,
                       restored=len(restored), pre_backup=models.backup_view(pre),
                       stats=store.stats(root))
        self._bus.emit("data.backups_changed", slot_id=slot_id)
        session.refresh_worlds()

    def _run_cleanup(self, job: dict) -> None:
        session = self._session
        root = session.backup_root()
        known = [str(world["index"]) for world in session.worlds_copy()]
        result = store.cleanup(root, session.cfg.get("keep", 10),
                               session.cfg.get("keep_auto", 5), known,
                               cfg=session.cfg)
        self._bus.emit("job.done", job_id=job["id"], kind="cleanup", **result,
                       stats=store.stats(root))
        self._bus.emit("data.backups_changed", slot_id="")
        session.refresh_worlds()

    def _run_delete_world(self, job: dict) -> None:
        """删除存档：快照 → 改索引 → 文件进回收站；任何一步失败都完整回滚。

        步骤顺序是刻意的：先拍 _pre（后悔药），再在内存里改 saveindex 结构，
        然后才动文件、写索引。写索引失败时把文件移回去 + 用内存里的原始字节
        把索引写回原样——两个动作各管各的，不会出现"文件没了索引还在"的状态。
        """
        session = self._session
        slot_id = str(job["params"]["slot_id"])
        delete_backups = bool(job["params"].get("delete_backups"))
        world = session.world(slot_id)
        save_dir = session.save_dir
        if not save_dir:
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")
        root = session.backup_root()
        if store.is_game_running(force=True):
            raise DsError(ErrorCode.GAME_RUNNING, "检测到饥荒正在运行，请先退出游戏再删除存档")

        index_path = os.path.join(save_dir, "saveindex")
        if not os.path.isfile(index_path):
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "saveindex 不存在，无法改写存档列表")
        original_bytes = open(index_path, "rb").read()

        # 1) 后悔药：删除前自动快照（与恢复前快照同一套机制）
        pre = store.backup_slot(save_dir, world, root, tag="pre")

        # 2) 内存里改结构（drop_slot 返回新 dict，不动原数据）
        data = klei.parse_lua_table(klei.decode_klei_file(index_path))
        dropped = klei.drop_slot(data, slot_id)

        # 3) 文件进回收站 → 4) 原子重写索引
        trash_info = store.trash_slot_files(save_dir, world, root)
        try:
            klei.write_saveindex_atomic(save_dir, dropped, original_bytes)
        except Exception:
            store.restore_from_trash(trash_info["dir"], save_dir)
            klei.restore_raw_atomic(save_dir, original_bytes)
            raise

        # 5) 可选：把这个槽位的备份一起删掉
        removed_backups = 0
        freed_backups = 0
        if delete_backups:
            for backup in store.list_backups(root, slot_id):
                try:
                    result = store.delete_backup(root, backup["id"])
                    removed_backups += 1
                    freed_backups += result.get("freed_bytes", 0)
                except DsError:
                    continue

        from ..core import undo
        undo.record("delete_world", f"删除存档（槽位 {slot_id}）", slot_id,
                    {"backup_id": pre.get("id", "")})
        self._bus.emit("job.done", job_id=job["id"], kind="delete_world", slot_id=slot_id,
                       trash_dir=trash_info["dir"], moved=trash_info["moved"],
                       removed_backups=removed_backups, freed_backups=freed_backups,
                       pre_backup=models.backup_view(pre), stats=store.stats(root))
        self._bus.emit("data.backups_changed", slot_id=slot_id)
        session.refresh_worlds()
