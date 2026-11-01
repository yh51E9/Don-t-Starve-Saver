# -*- coding: utf-8 -*-
"""备份目录的全部读写。

布局（与 v4.1 完全兼容，老备份必须能直接读出来）：
    backups/slot_<id>/<YYYYmmdd_HHMMSS>[_auto|_pre][_2]/

与旧版的差别只有三类，全部是修 bug：
  1. 所有对外函数收 id 而不是路径，并用 realpath 白名单挡住 `..\\..`
  2. 恢复改成"先校验后复制"，不会再出现存档被覆盖一半才发现备份是坏的
  3. 清理时 limit<=0 表示"清空该组"，而不是旧版的"跳过该组"
"""
import os
import re
import shutil
import subprocess
import threading
import time

from . import klei, paths
from .errors import DsError, ErrorCode

STAMP_RE = re.compile(r"^(\d{8}_\d{6})(?:_([a-z]+))?(?:_(\d+))?$")
# tag 只用纯字母（目录名经 STAMP_RE 解析，[a-z]+ 不认下划线）
VALID_TAGS = {"manual", "auto", "pre", "autosave", "autoexit", "tick", "import"}
_SUFFIX = {"manual": "", "auto": "_auto", "pre": "_pre",
           "autosave": "_autosave", "autoexit": "_autoexit", "tick": "_tick", "import": "_import"}
# 自动保留池：旧 auto + 三种自动触发（游戏保存/游戏关闭/定时）；其余进手动池
AUTO_TAGS = {"auto", "autosave", "autoexit", "tick"}

_running_lock = threading.Lock()
_running_cache = {"checked_at": 0.0, "value": False}


# ---------------- 路径与 id ----------------

def slot_dir(backup_root: str, slot_id: str) -> str:
    _safe_component(slot_id)
    return os.path.join(backup_root, f"slot_{slot_id}")


def make_backup_id(slot_id: str, dir_name: str) -> str:
    return f"{slot_id}:{dir_name}"


def _safe_component(name: str) -> str:
    if not isinstance(name, str) or not name or name in (".", ".."):
        raise DsError(ErrorCode.PATH_ESCAPE, "非法的路径片段", {"value": str(name)})
    if any(ch in name for ch in '\\/:*?"<>|') or name.strip() != name:
        raise DsError(ErrorCode.PATH_ESCAPE, "非法的路径片段", {"value": name})
    return name


def _ensure_under(root: str, path: str) -> str:
    """realpath 白名单：目标必须真的在备份根目录里。"""
    root_real = os.path.realpath(root)
    path_real = os.path.realpath(path)
    try:
        common = os.path.commonpath([root_real, path_real])
    except ValueError:
        common = ""
    if os.path.normcase(common) != os.path.normcase(root_real):
        raise DsError(ErrorCode.PATH_ESCAPE, "备份路径不在备份目录内", {"path": path})
    return path_real


def resolve_backup_id(backup_root: str, backup_id: str) -> tuple[str, str]:
    """"slot:dir" → (slot_id, 绝对路径)，越界直接抛 E_PATH_ESCAPE。"""
    if not isinstance(backup_id, str) or ":" not in backup_id:
        raise DsError(ErrorCode.BAD_ARGS, "备份 id 格式不对", {"id": str(backup_id)})
    slot_id, _, dir_name = backup_id.partition(":")
    _safe_component(slot_id)
    _safe_component(dir_name)
    path = os.path.join(backup_root, f"slot_{slot_id}", dir_name)
    return slot_id, _ensure_under(backup_root, path)


def backup_files(backup_root: str, backup_id: str) -> dict:
    """备份目录的文件清单（详情弹窗用）。只读，不碰备份本体。"""
    _slot, path = resolve_backup_id(backup_root, backup_id)
    files: list[dict] = []
    try:
        for name in sorted(os.listdir(path)):
            full = os.path.join(path, name)
            if os.path.isfile(full):
                try:
                    files.append({"name": name, "size_bytes": os.path.getsize(full)})
                except OSError:
                    continue
    except OSError:
        pass
    return {"files": files, "total_bytes": sum(item["size_bytes"] for item in files)}


# ---------------- 元数据 ----------------

def _read_meta(backup_path: str, slot_id: str) -> dict:
    """解析备份内的 saveindex，拿"当时"的角色/模式/天数/周目身份。

    旧版在这里加了永久缓存，其实一份只要 1.6ms；去掉缓存换来没有竞态、没有内存增长。
    """
    try:
        from . import models

        for slot in klei.load_slots(backup_path) or []:
            if str(slot["index"]) == str(slot_id):
                extras = klei.slot_extras(slot.get("raw") or {})
                raw = slot.get("raw") or {}
                compat = models.compatibility_of(
                    raw.get("modes") or {}, list(slot.get("files") or []), extras["dlc"]
                )
                current_world = models.current_world_label(raw)
                return {
                    "character": klei.CHARACTER_CN.get(slot["character"], slot["character"]),
                    "character_id": slot["character"],
                    "mode": klei.MODE_NAME_CN.get(slot["mode"], slot["mode"] or "未知"),
                    "day": slot["day"],
                    "save_id": extras["save_id"],
                    "mods_count": len(extras["mod_ids"]),
                    "dlc": extras["dlc"],
                    "mode_days": extras["mode_days"],
                    "compatibility": compat,
                    "current_world": current_world,
                }
    except Exception:
        pass
    return {}


def _dir_size(path: str) -> int:
    total = 0
    try:
        for name in os.listdir(path):
            full = os.path.join(path, name)
            if os.path.isfile(full):
                total += os.path.getsize(full)
    except OSError:
        pass
    return total


# ---------------- 备份 ----------------

def _collision_free(base: str, stem: str) -> str:
    dest = os.path.join(base, stem)
    index = 1
    while os.path.exists(dest):
        index += 1
        dest = os.path.join(base, f"{stem}_{index}")
    return dest


def _emit(cb, phase, done, total, bytes_done, bytes_total):
    if cb is None:
        return
    try:
        cb(phase, done, total, bytes_done, bytes_total)
    except Exception:
        pass  # 进度回调绝不能让备份失败


def backup_slot(save_dir: str, slot: dict, backup_root: str, tag: str = "manual",
                on_progress=None) -> dict:
    """给一个槽位拍快照：saveindex + 该槽位全部世界文件（含洞穴/火山）。"""
    if tag not in VALID_TAGS:
        tag = "manual"
    slot_id = str(slot["index"])
    files = sorted(set(slot.get("files") or []) | {"saveindex"})

    plan = []
    total_bytes = 0
    for name in files:
        src = os.path.join(save_dir, name)
        if os.path.isfile(src):
            size = os.path.getsize(src)
            plan.append((name, src, size))
            total_bytes += size
    if not plan:
        raise DsError(ErrorCode.IO, "没有复制到任何文件，备份已取消", {"slot": slot_id})

    stamp = time.strftime("%Y%m%d_%H%M%S")
    stem = f"{stamp}{_SUFFIX.get(tag, '')}"
    base = slot_dir(backup_root, slot_id)
    os.makedirs(base, exist_ok=True)
    dest = _collision_free(base, stem)

    done_bytes = 0
    copied = 0
    try:
        os.makedirs(dest)
        for index, (name, src, size) in enumerate(plan, start=1):
            shutil.copy2(src, os.path.join(dest, name))
            copied += 1
            done_bytes += size
            _emit(on_progress, "copy", index, len(plan), done_bytes, total_bytes)
    except OSError as exc:
        shutil.rmtree(dest, ignore_errors=True)
        raise DsError(ErrorCode.IO, f"备份失败：{exc}", {"slot": slot_id}) from exc

    if not copied:
        shutil.rmtree(dest, ignore_errors=True)
        raise DsError(ErrorCode.IO, "没有复制到任何文件，备份已取消", {"slot": slot_id})

    dir_name = os.path.basename(dest)
    meta = _read_meta(dest, slot_id)
    size = _dir_size(dest)
    return {
        "id": make_backup_id(slot_id, dir_name),
        "slot_id": slot_id,
        "dir_name": dir_name,
        "path": dest,
        "stamp": dir_name[:15],
        "tag": tag,
        "time": time.strftime("%m-%d %H:%M", time.strptime(dir_name[:15], "%Y%m%d_%H%M%S")),
        "full_time": time.strftime("%Y-%m-%d %H:%M:%S", time.strptime(dir_name[:15], "%Y%m%d_%H%M%S")),
        "files": sorted(os.listdir(dest)),
        "file_count": copied,
        "size_bytes": size,
        "total_mb": round(size / 1048576, 2),
        "character": meta.get("character", ""),
        "character_id": meta.get("character_id", ""),
        "mode": meta.get("mode", ""),
        "day": meta.get("day"),
        "save_id": meta.get("save_id", ""),
        "mods_count": meta.get("mods_count", 0),
        "dlc": meta.get("dlc", []),
        "mode_days": meta.get("mode_days", {}),
    }


def list_backups(backup_root: str, slot_id: str) -> list[dict]:
    """该槽位所有备份，最新在前。未识别的目录名原样显示，不隐藏。"""
    folder = slot_dir(backup_root, slot_id)
    if not os.path.isdir(folder):
        return []

    items = []
    notes = _read_notes()
    for name in os.listdir(folder):
        path = os.path.join(folder, name)
        if not os.path.isdir(path):
            continue
        match = STAMP_RE.match(name)
        if match:
            stamp = match.group(1)
            tag = match.group(2) or "manual"
            if tag not in VALID_TAGS:
                tag = "manual"
            try:
                display_time = time.strftime("%m-%d %H:%M", time.strptime(stamp, "%Y%m%d_%H%M%S"))
                full_time = time.strftime("%Y-%m-%d %H:%M:%S", time.strptime(stamp, "%Y%m%d_%H%M%S"))
            except ValueError:
                display_time = full_time = name
        else:
            stamp, tag, display_time, full_time = name, "manual", name, name

        size = _dir_size(path)
        meta = _read_meta(path, str(slot_id))
        try:
            entries = sorted(os.listdir(path))
        except OSError:
            entries = []
        items.append({
            "id": make_backup_id(str(slot_id), name),
            "slot_id": str(slot_id),
            "dir_name": name,
            "path": path,
            "stamp": stamp,
            "tag": tag,
            "time": display_time,
            "full_time": full_time,
            "files": entries,
            "file_count": sum(1 for entry in entries if os.path.isfile(os.path.join(path, entry))),
            "size_bytes": size,
            "total_mb": round(size / 1048576, 2),
            "character": meta.get("character", ""),
            "character_id": meta.get("character_id", ""),
            "mode": meta.get("mode", ""),
            "day": meta.get("day"),
            "save_id": meta.get("save_id", ""),
            "mods_count": meta.get("mods_count", 0),
            "dlc": meta.get("dlc", []),
            "mode_days": meta.get("mode_days", {}),
            "compatibility": meta.get("compatibility", {}),
            "current_world": meta.get("current_world", ""),
            "note": notes.get(make_backup_id(str(slot_id), name), ""),
        })

    # 同秒多份时旧版顺序不稳定；加上目录名做次级键，`_2` 排在 `_auto` 前面
    items.sort(key=lambda item: (item["stamp"], item["dir_name"]), reverse=True)
    return items


def latest_backup_iso(backup_root: str, slot_id: str) -> str | None:
    """只看目录名，不解析 saveindex——世界卡片每次刷新都要用，必须够快。"""
    folder = slot_dir(backup_root, slot_id)
    if not os.path.isdir(folder):
        return None
    stamps = []
    try:
        for name in os.listdir(folder):
            if os.path.isdir(os.path.join(folder, name)) and STAMP_RE.match(name):
                stamps.append(name[:15])
    except OSError:
        return None
    if not stamps:
        return None
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%S", time.strptime(max(stamps), "%Y%m%d_%H%M%S"))
    except ValueError:
        return None


def enforce_keep(backup_root: str, slot_id: str, keep_manual: int = 10,
                 keep_auto: int = 5) -> tuple[int, int]:
    """按份数清理，返回 (删除份数, 释放字节)。

    手动和自动分开计数；_pre 归手动组（同样是用户动作）。
    limit <= 0 表示清空该组——旧版是"跳过"，语义反直觉。
    """
    backups = list_backups(backup_root, slot_id)
    groups = (
        ([b for b in backups if b["tag"] not in AUTO_TAGS], keep_manual),
        ([b for b in backups if b["tag"] in AUTO_TAGS], keep_auto),
    )
    removed = 0
    freed = 0
    for group, limit in groups:
        victims = group if limit is not None and limit <= 0 else group[max(limit or 0, 0):]
        for item in victims:
            try:
                shutil.rmtree(item["path"])
                removed += 1
                freed += item["size_bytes"]
            except OSError:
                pass
    return removed, freed


def enforce_keep_days(backup_root: str, slot_id: str, keep_manual: int, keep_auto: int,
                      days_manual: int, days_auto: int) -> tuple[int, int]:
    """按"超龄 AND 超份数"的交集淘汰，返回 (删除份数, 释放字节)。

    天数模式是份数模式的收紧而非放宽：一份备份只有既超出份数上限、
    又比天数线更老时才删，绝不让天数策略单独把新备份冲掉。
    ``_pre`` 是恢复/删除前的后悔药，永不参与天数淘汰。
    天数 <= 0 表示该组不限龄（等价于纯份数模式）。
    """
    backups = list_backups(backup_root, slot_id)
    now = time.time()
    # 手动组计数包含 _pre（与份数模式一致），但 _pre 永不进淘汰名单
    groups = (
        ([b for b in backups if b["tag"] not in AUTO_TAGS], keep_manual, days_manual),
        ([b for b in backups if b["tag"] in AUTO_TAGS], keep_auto, days_auto),
    )
    removed = 0
    freed = 0
    for group, limit, days in groups:
        beyond_count = group if limit <= 0 else group[max(limit, 0):]
        if days <= 0:
            victims = beyond_count  # 不限龄 → 退化回纯份数
        else:
            cutoff = now - days * 86400
            victims = [b for b in beyond_count
                       if b["tag"] != "pre" and _backup_epoch(b) < cutoff]
        for item in victims:
            try:
                shutil.rmtree(item["path"])
                removed += 1
                freed += item["size_bytes"]
            except OSError:
                pass
    return removed, freed


def _backup_epoch(item: dict) -> float:
    try:
        return time.mktime(time.strptime(item["stamp"][:15], "%Y%m%d_%H%M%S"))
    except (ValueError, KeyError, TypeError):
        return time.time()  # 时间戳读不出来就当"很新"，宁可不删


def enforce_from_config(backup_root: str, slot_id: str, cfg: dict) -> tuple[int, int]:
    """按配置里的 keep_mode 分发淘汰策略。所有调用点统一走这里。"""
    if cfg.get("keep_mode") == "days":
        return enforce_keep_days(
            backup_root, slot_id,
            cfg.get("keep", 10), cfg.get("keep_auto", 5),
            cfg.get("keep_days_manual", 0), cfg.get("keep_days_auto", 0))
    return enforce_keep(backup_root, slot_id, cfg.get("keep", 10), cfg.get("keep_auto", 5))


def delete_backup(backup_root: str, backup_id: str) -> dict:
    """删除一份备份：移入回收站（可撤销），不再直接粉碎。"""
    slot_id, path = resolve_backup_id(backup_root, backup_id)
    if not os.path.isdir(path):
        raise DsError(ErrorCode.BACKUP_NOT_FOUND, "这份备份已经不在了", {"id": backup_id})
    size = _dir_size(path)
    dir_name = os.path.basename(path)
    stamp = time.strftime("%Y%m%d_%H%M%S") + f"_{os.getpid()}"
    target = os.path.join(trash_dir(backup_root, stamp), f"slot_{_safe_component(str(slot_id))}", dir_name)
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.move(path, target)
    except OSError as exc:
        raise DsError(ErrorCode.IO, f"删除失败：{exc}", {"id": backup_id}) from exc
    return {"slot_id": slot_id, "freed_bytes": size,
            "trash_path": target, "dir_name": dir_name}


def undelete_backup(backup_root: str, trash_path: str) -> dict:
    """把回收站里的一份备份移回备份库（delete_backup 的撤销）。"""
    if not os.path.isdir(trash_path):
        raise DsError(ErrorCode.BACKUP_NOT_FOUND, "回收站里已经没有这份备份了", {"path": trash_path})
    dir_name = os.path.basename(trash_path)
    # 回收站布局：_trash/<时间戳>/slot_<id>/<dir_name>
    parent = os.path.dirname(trash_path)
    slot_part = os.path.basename(parent)
    if not slot_part.startswith("slot_"):
        raise DsError(ErrorCode.PARSE, "回收站目录结构不对，无法定位原槽位", {"path": trash_path})
    slot_id = slot_part[len("slot_"):]
    dest = os.path.join(slot_dir(backup_root, slot_id), dir_name)
    if os.path.exists(dest):
        raise DsError(ErrorCode.IO, "原位置已有同名备份，无法恢复", {"path": dest})
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(trash_path, dest)
    return {"slot_id": slot_id, "dir_name": dir_name, "path": dest,
            "backup_id": make_backup_id(slot_id, dir_name)}


def orphan_backups(backup_root: str, world_save_ids: list[str]) -> list[dict]:
    """save_id 不属于任何当前世界的备份——已删除/被替换世界的残留快照。

    save_id 为空的老备份无法判定归属，不列入。
    """
    known = {str(s) for s in world_save_ids if s}
    items = []
    for entry in os.listdir(backup_root) if os.path.isdir(backup_root) else []:
        if not entry.startswith("slot_"):
            continue
        slot_id = entry[len("slot_"):]
        for item in list_backups(backup_root, slot_id):
            save_id = str(item.get("save_id") or "")
            if save_id and save_id not in known:
                items.append(item)
    items.sort(key=lambda b: b.get("stamp") or "", reverse=True)
    return items


# ---------------- 删除存档（移入回收站，可回滚） ----------------
# 回收站放 backups/_trash/<时间戳>/slot_<id>/。
# "_trash" 不匹配 slot_* 前缀，所以 stats()/cleanup() 天然不会把它算进去。

TRASH_NAME = "_trash"


def trash_dir(backup_root: str, stamp: str | None = None) -> str:
    base = os.path.join(backup_root, TRASH_NAME)
    if stamp:
        base = os.path.join(base, _safe_component(stamp))
    return base


def trash_slot_files(save_dir: str, slot: dict, backup_root: str) -> dict:
    """把一个槽位的存档文件移进回收站。半途失败时把已移走的移回去再抛错。

    saveindex 不在这里动——它由 delete 流程改写，两条路径分开才能各自回滚。
    """
    names = [name for name in slot.get("files", []) if isinstance(name, str) and name]
    if not names:
        raise DsError(ErrorCode.BAD_ARGS, "这个槽位没有可删除的存档文件")
    stamp = time.strftime("%Y%m%d_%H%M%S")
    target = os.path.join(trash_dir(backup_root, stamp), f"slot_{_safe_component(str(slot['index']))}")
    os.makedirs(target, exist_ok=True)

    moved: list[str] = []
    try:
        for name in names:
            source = os.path.join(save_dir, name)
            if not os.path.exists(source):
                continue
            _ensure_under(save_dir, source)  # 防御：源文件必须真的在存档目录里
            shutil.move(source, os.path.join(target, name))
            moved.append(name)
    except OSError as exc:
        for name in moved:  # 回滚：把已移走的移回原位
            try:
                shutil.move(os.path.join(target, name), os.path.join(save_dir, name))
            except OSError:
                pass
        raise DsError(ErrorCode.IO, "把存档移入回收站失败，已回滚", {"reason": str(exc)}) from exc
    return {"dir": target, "moved": moved, "bytes": _dir_size(target)}


def restore_from_trash(trash_path: str, save_dir: str) -> list[str]:
    """把回收站里的一批文件移回存档目录（回滚路径，尽力而为）。"""
    restored: list[str] = []
    if not os.path.isdir(trash_path):
        return restored
    for name in os.listdir(trash_path):
        source = os.path.join(trash_path, name)
        try:
            shutil.move(source, os.path.join(save_dir, name))
            restored.append(name)
        except OSError:
            continue
    return restored


def purge_trash(backup_root: str, keep_days: int = 7) -> dict:
    """清理过期的回收站（默认 7 天）。没有它 _trash 会永远堆着。"""
    root = trash_dir(backup_root)
    if not os.path.isdir(root):
        return {"removed": 0, "freed_bytes": 0}
    cutoff = time.time() - keep_days * 86400
    removed = 0
    freed = 0
    for name in os.listdir(root):
        path = os.path.join(root, name)
        if not os.path.isdir(path):
            continue
        try:
            if os.path.getmtime(path) <= cutoff:
                freed += _dir_size(path)
                shutil.rmtree(path, ignore_errors=True)
                removed += 1
        except OSError:
            continue
    return {"removed": removed, "freed_bytes": freed}


def cleanup(backup_root: str, keep_manual: int, keep_auto: int,
            known_slot_ids: list[str] | None = None, cfg: dict | None = None) -> dict:
    """对所有 slot_* 目录执行保留策略，包括游戏里已经删掉的世界。

    cfg 提供时按 keep_mode 分发（days 模式含交集淘汰），否则按份数。
    """
    known = {str(item) for item in (known_slot_ids or [])}
    removed = 0
    freed = 0
    orphans = []

    if not os.path.isdir(backup_root):
        return {"removed": 0, "freed_bytes": 0, "orphans": []}

    for name in sorted(os.listdir(backup_root)):
        path = os.path.join(backup_root, name)
        if not os.path.isdir(path) or not name.startswith("slot_"):
            continue
        slot_id = name[len("slot_"):]
        try:
            if cfg is not None:
                count, size = enforce_from_config(backup_root, slot_id, cfg)
            else:
                count, size = enforce_keep(backup_root, slot_id, keep_manual, keep_auto)
        except DsError:
            continue
        removed += count
        freed += size
        if known and slot_id not in known:
            remaining = list_backups(backup_root, slot_id)
            if remaining:
                orphans.append({"slot_id": slot_id, "count": len(remaining),
                                "bytes": sum(b["size_bytes"] for b in remaining)})
    return {"removed": removed, "freed_bytes": freed, "orphans": orphans}


# ---------------- 恢复 ----------------

def validate_backup(backup_path: str) -> list[str]:
    """复制之前的完整性检查。任何一条不过就拒绝恢复，存档一个字节都不动。"""
    if not os.path.isdir(backup_path):
        raise DsError(ErrorCode.BACKUP_NOT_FOUND, "备份目录不存在", {"path": backup_path})
    if not os.path.isfile(os.path.join(backup_path, "saveindex")):
        raise DsError(ErrorCode.BACKUP_NOT_FOUND, "备份中缺少 saveindex，拒绝恢复",
                       {"path": backup_path})
    try:
        slots = klei.load_slots(backup_path)
    except Exception as exc:
        raise DsError(ErrorCode.PARSE, "备份里的 saveindex 无法解析，拒绝恢复",
                       {"path": backup_path, "reason": str(exc)}) from exc
    if not slots:
        raise DsError(ErrorCode.PARSE, "备份里的 saveindex 是空的，拒绝恢复",
                       {"path": backup_path})

    names = []
    for name in os.listdir(backup_path):
        src = os.path.join(backup_path, name)
        if not os.path.isfile(src):
            continue
        try:
            with open(src, "rb") as fh:
                fh.read(1)
        except OSError as exc:
            raise DsError(ErrorCode.IO, f"备份文件读不出来：{name}", {"file": name}) from exc
        names.append(name)
    return sorted(names)


def restore_slot(save_dir: str, backup_path: str, on_progress=None,
                 slot_id: str | None = None) -> list[str]:
    """把备份覆盖回存档目录。先校验，后复制。调用方必须先确认游戏已退出。

    saveindex 不整体覆盖：它是所有槽位共用的账本，拿旧账本覆盖会把
    其他槽位的天数/状态也拉回备份时刻（最坏情况：备份时还不存在的槽位
    会从游戏里"消失"）。给了 slot_id 就做外科手术——只把这一槽的条目
    换成备份时刻的版本，其余槽位保持现状；当前账本解析不了才退回整体覆盖。
    """
    names = validate_backup(backup_path)
    if not os.path.isdir(save_dir):
        raise DsError(ErrorCode.SAVE_DIR_INVALID, "存档目录不存在", {"path": save_dir})

    total = len(names)
    total_bytes = sum(os.path.getsize(os.path.join(backup_path, n)) for n in names)
    done_bytes = 0
    restored = []
    for index, name in enumerate(names, start=1):
        if name == "saveindex" and slot_id is not None:
            continue  # 账本走下面的条目替换，不跟世界文件一起覆盖
        src = os.path.join(backup_path, name)
        try:
            shutil.copy2(src, os.path.join(save_dir, name))
        except OSError as exc:
            raise DsError(ErrorCode.IO, f"恢复到一半失败：{name}", {"file": name}) from exc
        restored.append(name)
        done_bytes += os.path.getsize(src)
        _emit(on_progress, "restore", index, total, done_bytes, total_bytes)

    if "saveindex" not in names:
        raise DsError(ErrorCode.PARSE, "备份中缺少 saveindex，拒绝恢复", {"path": backup_path})
    if slot_id is None:
        # 旧调用路径（测试/外部），保持整体覆盖语义
        shutil.copy2(os.path.join(backup_path, "saveindex"), os.path.join(save_dir, "saveindex"))
        restored.append("saveindex")
    else:
        _restore_saveindex_entry(save_dir, backup_path, slot_id)
        restored.append("saveindex")
    return restored


def _restore_saveindex_entry(save_dir: str, backup_path: str, slot_id: str) -> None:
    """把备份里该槽位的条目移植进当前 saveindex，其他槽位不动。

    失败兜底：当前账本解析失败（损坏）时退回整体覆盖——这时没有更好的选择。
    """
    index_path = os.path.join(save_dir, "saveindex")
    backup_entry = None
    try:
        backup_data = klei.parse_lua_table(klei.decode_klei_file(os.path.join(backup_path, "saveindex")))
        backup_entry = klei.slot_entry(backup_data, slot_id)
    except ValueError:
        backup_entry = None

    original_bytes = open(index_path, "rb").read() if os.path.isfile(index_path) else None
    live_ok = original_bytes is not None
    if live_ok:
        try:
            live = klei.parse_lua_table(klei.decode_klei_file(index_path))
        except ValueError:
            live_ok = False

    if live_ok:
        entry = klei.slot_entry(live, slot_id)
        if backup_entry is None:
            # 备份里这个槽位当时是空的 → 恢复成空占位，保留当前 save_id
            backup_entry = klei._empty_slot(entry if isinstance(entry, dict) else {})
        klei.write_saveindex_atomic(
            save_dir, klei.splice_slot(live, slot_id, backup_entry), original_bytes)
    else:
        # 当前账本读不出来：整体覆盖是唯一能保住槽位本身的做法
        shutil.copy2(os.path.join(backup_path, "saveindex"), index_path)


def preview_restore(current_world: dict, backup_path: str) -> dict:
    """恢复确认框要的差值信息：会退回几天、覆盖几个文件、缺了什么。"""
    meta = _read_meta(backup_path, str(current_world["index"])) if os.path.isdir(backup_path) else {}
    backup_day = meta.get("day")
    current_day = int(current_world.get("day") or 0)
    try:
        backup_files = sorted(
            name for name in os.listdir(backup_path)
            if os.path.isfile(os.path.join(backup_path, name))
        )
    except OSError:
        backup_files = []

    expected = set(current_world.get("files") or []) | {"saveindex"}
    missing = sorted(expected - set(backup_files))
    warnings = []
    for name in missing:
        if name == "saveindex":
            warnings.append("备份缺少 saveindex，无法恢复")
        else:
            warnings.append(f"备份缺少 {name}，恢复后这部分进度可能不一致")

    total_bytes = 0
    for name in backup_files:
        try:
            total_bytes += os.path.getsize(os.path.join(backup_path, name))
        except OSError:
            pass

    return {
        "current_day": current_day,
        "backup_day": backup_day,
        "delta_days": (backup_day - current_day) if isinstance(backup_day, int) else None,
        "files": len(backup_files),
        "bytes": total_bytes,
        "warnings": warnings,
    }


# ---------------- 统计与工具 ----------------

def stats(backup_root: str) -> dict:
    total = 0
    count = 0
    per_slot = {}
    if not os.path.isdir(backup_root):
        return {"total_bytes": 0, "count": 0, "per_slot": {}}

    for name in os.listdir(backup_root):
        path = os.path.join(backup_root, name)
        if not os.path.isdir(path) or not name.startswith("slot_"):
            continue
        slot_id = name[len("slot_"):]
        size = 0
        number = 0
        try:
            entries = os.listdir(path)
        except OSError:
            entries = []
        for entry in entries:
            sub = os.path.join(path, entry)
            if os.path.isdir(sub):
                size += _dir_size(sub)
                number += 1
        per_slot[slot_id] = {"bytes": size, "count": number}
        total += size
        count += number
    return {"total_bytes": total, "count": count, "per_slot": per_slot}


def fmt_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    if num_bytes < 1048576:
        return f"{num_bytes / 1024:.0f} KB"
    if num_bytes < 1073741824:
        return f"{num_bytes / 1048576:.1f} MB"
    return f"{num_bytes / 1073741824:.2f} GB"


_GAME_IMAGE_PREFIX = "dontstarve"


def is_game_running(timeout: float = 3.0, force: bool = False) -> bool:
    """恢复/删除存档前必须确认游戏没在跑。

    优先走 Win32 原生进程快照（毫秒级、无子进程）；拿不到再退回
    tasklist 子进程。都不用 tasklist 的 /FI 过滤，而是拉全表后做
    ``dontstarve*`` 前缀匹配——单机版镜像名有 dontstarve.exe、
    dontstarve_steam.exe 等变体，按精确名过滤会漏。
    带 3 秒缓存避免巡检/点击反复查询；破坏性动作真正执行前传
    ``force=True`` 绕过缓存，把"点击后才开游戏"的竞态窗口压到最小。
    """
    now = time.time()
    if not force:
        with _running_lock:
            if now - _running_cache["checked_at"] < 3.0:
                return bool(_running_cache["value"])

    value = _native_game_running()
    if value is None:  # 原生枚举不可用，降级 tasklist
        value = _tasklist_game_running(timeout)

    with _running_lock:
        _running_cache["checked_at"] = now
        _running_cache["value"] = value
    return value


def _native_game_running() -> bool | None:
    """Win32 工具快照匹配。不可用时返回 None（表示"不知道"）。"""
    try:
        from ..platform import win32

        if not hasattr(win32, "any_image_starts_with"):
            return None
        return win32.any_image_starts_with(_GAME_IMAGE_PREFIX)
    except Exception:
        return None


def _tasklist_game_running(timeout: float) -> bool:
    """tasklist 子进程兜底，仅在原生枚举失败时使用。"""
    try:
        result = subprocess.run(
            ["tasklist", "/NH", "/FO", "CSV"],
            capture_output=True, text=True, timeout=timeout,
            encoding="gbk", errors="replace",
        )
        for line in (result.stdout or "").splitlines():
            line = line.strip()
            if not line.startswith('"'):
                continue
            image = line.split('","', 1)[0].strip('"').lower()
            if image.startswith(_GAME_IMAGE_PREFIX):
                return True
    except Exception:
        pass
    return False


def default_root() -> str:
    return paths.default_backup_root()


# ---------------- 世界概览（备份详情） ----------------

def backup_overview(backup_root: str, backup_id: str) -> dict:
    """备份详情：世界列表（含未生成）、兼容性、其他文件。"""
    from . import models

    slot_id, path = resolve_backup_id(backup_root, backup_id)
    raw: dict = {}
    for slot in klei.load_slots(path) or []:
        if str(slot["index"]) == slot_id:
            raw = slot.get("raw") or {}
            break

    files: list[dict] = []
    for name in sorted(os.listdir(path)):
        full = os.path.join(path, name)
        if os.path.isfile(full):
            try:
                files.append({"name": name, "size_bytes": os.path.getsize(full)})
            except OSError:
                files.append({"name": name, "size_bytes": 0})

    result = models.classify_worlds(files, raw)
    return {
        **result,
        "total_bytes": sum(item["size_bytes"] for item in files),
        "file_count": len(files),
    }


# ---------------- 备份备注（存在程序数据目录，不碰备份本体） ----------------

def _notes_file() -> str:
    return paths.data_dir("backup_notes.json")


def _read_notes() -> dict:
    import json

    try:
        with open(_notes_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_notes(notes: dict) -> None:
    import json

    path = _notes_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(notes, fh, ensure_ascii=False)
    os.replace(tmp, path)


def set_backup_note(backup_id: str, note: str) -> dict:
    key = str(backup_id)
    text = str(note or "").strip()[:200]
    notes = _read_notes()
    if text:
        notes[key] = text
    else:
        notes.pop(key, None)
    _write_notes(notes)
    return {"ok": True, "id": key, "note": text}



# ---------------- 导出 / 导入 ----------------

_SLOT_MODES = ("survival", "shipwrecked", "porkland", "cave", "volcano")


def _slot_of_file(name: str):
    """世界文件名 -> 槽位号（survival_1 / cave_1_1_1 -> 1）。saveindex/未知 -> None。"""
    if name == "saveindex":
        return None
    import re as _re
    m = _re.match(r"^(?:" + "|".join(_SLOT_MODES) + r")_(\d+)", name)
    return m.group(1) if m else None


def _is_slot_file(name: str) -> bool:
    return name == "saveindex" or _slot_of_file(name) is not None


def _archive_list(path: str) -> list:
    """列来源内容 [(完整相对路径, 字节)]。目录/zip/7z/rar；其他格式抛 E_NOT_SUPPORTED。"""
    if os.path.isdir(path):
        out = []
        for root, _dirs, files in os.walk(path):
            for fn in files:
                full = os.path.join(root, fn)
                out.append((os.path.relpath(full, path).replace("\\", "/"), os.path.getsize(full)))
        return out
    low = path.lower()
    if low.endswith(".zip"):
        import zipfile
        with zipfile.ZipFile(path) as zf:
            return [(i.filename, i.file_size) for i in zf.infolist() if not i.is_dir()]
    if low.endswith(".7z"):
        try:
            import py7zr
        except ImportError as exc:
            raise DsError(ErrorCode.NOT_SUPPORTED, "读取 7z 需要 py7zr（未安装）", {}) from exc
        with py7zr.SevenZipFile(path, "r") as zf:
            return [(name, 0) for name in zf.getnames() if not name.endswith("/")]
    if low.endswith(".rar"):
        try:
            import rarfile
        except ImportError as exc:
            raise DsError(ErrorCode.NOT_SUPPORTED, "读取 rar 需要 rarfile（未安装）", {}) from exc
        try:
            with rarfile.RarFile(path) as rf:
                return [(i.filename, i.file_size) for i in rf.infolist() if not i.is_dir()]
        except Exception as exc:
            raise DsError(ErrorCode.NOT_SUPPORTED, "rar 解压不可用（缺少 unrar 引擎）", {"reason": str(exc)}) from exc
    raise DsError(ErrorCode.NOT_SUPPORTED, "不支持的文件类型（可导入 zip / 7z / rar 或存档目录）", {"path": path})


def import_scan(path: str) -> dict:
    """识别导入源：按容器目录分组为若干条目（自家导出 zip 一份一条；扁平快照按槽位分）。"""
    entries_raw = _archive_list(path)
    if not entries_raw:
        raise DsError(ErrorCode.IO, "来源里没有文件", {"path": path})
    has_manifest = any(os.path.basename(n) == "manifest.json" for n, _ in entries_raw)

    groups: dict = {}
    unknown = []
    for name, size in entries_raw:
        base = os.path.basename(name)
        if not base or base == "manifest.json" or base.startswith(".") or base.startswith("__"):
            continue
        prefix = name[: -len(base)] if "/" in name else ""
        key = prefix if has_manifest else ""
        if not _is_slot_file(base):
            unknown.append(base)
            continue
        grp = groups.setdefault(key, {"files": set(), "bytes": 0, "has_saveindex": False, "slot_id": None})
        grp["files"].add(base)
        grp["bytes"] += size
        if base == "saveindex":
            grp["has_saveindex"] = True
        else:
            grp["slot_id"] = grp["slot_id"] or _slot_of_file(base)

    entries = []
    for key, grp in groups.items():
        if not grp["files"] - {"saveindex"}:
            continue
        slot_id = grp["slot_id"]
        if slot_id is None and key.startswith("slot_"):
            slot_id = key.split("/")[0][len("slot_"):]
        entries.append({
            "key": key,
            "label": key.strip("/") or "导入内容",
            "slot_id": str(slot_id) if slot_id is not None else None,
            "files": sorted(grp["files"]),
            "file_count": len(grp["files"]),
            "bytes": grp["bytes"],
            "has_saveindex": grp["has_saveindex"],
        })
    entries.sort(key=lambda e: e["label"])
    return {
        "kind": "dir" if os.path.isdir(path) else os.path.splitext(path)[1].lstrip(".").lower(),
        "recognized": bool(entries),
        "has_manifest": has_manifest,
        "entries": entries,
        "unknown": sorted(set(unknown))[:20],
    }


def _extract_group(path: str, key: str, names: set, dest_dir: str) -> None:
    """把来源中某分组的文件（按基名）解出到 dest_dir（扁平）。"""
    os.makedirs(dest_dir, exist_ok=True)
    if os.path.isdir(path):
        for root, _dirs, files in os.walk(path):
            rel = os.path.relpath(root, path).replace("\\", "/")
            if rel == ".":
                rel = ""
            if rel != key.strip("/"):
                continue
            for fn in files:
                if fn in names:
                    shutil.copy2(os.path.join(root, fn), os.path.join(dest_dir, fn))
        return
    low = path.lower()
    if low.endswith(".zip"):
        import zipfile
        with zipfile.ZipFile(path) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                base = os.path.basename(info.filename)
                prefix = info.filename[: -len(base)]
                if base in names and prefix == key:
                    with zf.open(info) as src, open(os.path.join(dest_dir, base), "wb") as out:
                        shutil.copyfileobj(src, out)
        return
    raw = os.path.join(dest_dir, "__raw__")
    os.makedirs(raw, exist_ok=True)
    try:
        if low.endswith(".7z"):
            import py7zr
            with py7zr.SevenZipFile(path, "r") as zf:
                zf.extract(path=raw)
        else:
            import rarfile
            with rarfile.RarFile(path) as rf:
                rf.extractall(raw)
        for root, _dirs, files in os.walk(raw):
            rel = os.path.relpath(root, raw).replace("\\", "/")
            if rel == ".":
                rel = ""
            if rel != key.strip("/"):
                continue
            for fn in files:
                if fn in names:
                    shutil.move(os.path.join(root, fn), os.path.join(dest_dir, fn))
    finally:
        shutil.rmtree(raw, ignore_errors=True)


def export_backups(backup_root: str, backup_ids: list, dest_path: str) -> dict:
    """把若干份备份打包成 zip（manifest + 每份一个 slot_N/dir_name 目录）。"""
    import json
    import zipfile

    entries = []
    for bid in backup_ids:
        slot_id, path = resolve_backup_id(backup_root, bid)
        if not os.path.isdir(path):
            raise DsError(ErrorCode.BACKUP_NOT_FOUND, "这份备份已经不在了", {"id": bid})
        entries.append((slot_id, path))
    if not entries:
        raise DsError(ErrorCode.BAD_ARGS, "没有选中任何备份", {})

    with zipfile.ZipFile(dest_path, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = [{"slot_id": s, "dir_name": os.path.basename(p)} for s, p in entries]
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        for slot_id, path in entries:
            arc_base = "slot_" + str(slot_id) + "/" + os.path.basename(path)
            for name in sorted(os.listdir(path)):
                src = os.path.join(path, name)
                if os.path.isfile(src):
                    zf.write(src, arc_base + "/" + name)
    return {"path": dest_path, "count": len(entries), "bytes": os.path.getsize(dest_path)}


def import_as_backup(backup_root: str, source: str, scan_entry: dict,
                     borrow_index_from=None) -> dict:
    """把一条导入内容收进备份库（tag=import）。缺 saveindex 时可借用当前存档账本。"""
    slot_id = str(scan_entry.get("slot_id") or "")
    _safe_component(slot_id)
    names = set(scan_entry["files"])
    base = slot_dir(backup_root, slot_id)
    os.makedirs(base, exist_ok=True)
    dest = _collision_free(base, time.strftime("%Y%m%d_%H%M%S") + "_import")

    os.makedirs(dest)
    try:
        _extract_group(source, scan_entry.get("key") or "", names, dest)
        if not os.path.isfile(os.path.join(dest, "saveindex")):
            if borrow_index_from and os.path.isfile(os.path.join(borrow_index_from, "saveindex")):
                shutil.copy2(os.path.join(borrow_index_from, "saveindex"), os.path.join(dest, "saveindex"))
            else:
                raise DsError(ErrorCode.PARSE,
                              "导入内容缺少 saveindex（存档账本），无法成为可恢复的备份",
                              {"entry": scan_entry.get("label")})
    except Exception:
        shutil.rmtree(dest, ignore_errors=True)
        raise

    dir_name = os.path.basename(dest)
    meta = _read_meta(dest, slot_id)
    size = _dir_size(dest)
    stamp = dir_name[:15]
    return {
        "id": make_backup_id(slot_id, dir_name),
        "slot_id": slot_id,
        "dir_name": dir_name,
        "path": dest,
        "stamp": stamp,
        "tag": "import",
        "time": time.strftime("%m-%d %H:%M", time.strptime(stamp, "%Y%m%d_%H%M%S")),
        "full_time": time.strftime("%Y-%m-%d %H:%M:%S", time.strptime(stamp, "%Y%m%d_%H%M%S")),
        "files": sorted(os.listdir(dest)),
        "file_count": len(os.listdir(dest)),
        "size_bytes": size,
        "total_mb": round(size / 1048576, 2),
        "character": meta.get("character", ""),
        "character_id": meta.get("character_id", ""),
        "mode": meta.get("mode", ""),
        "day": meta.get("day"),
        "save_id": meta.get("save_id", ""),
        "mods_count": meta.get("mods_count", 0),
    }


def import_as_save(save_dir: str, source: str, scan_entry: dict,
                   slot_id: str, on_progress=None) -> list:
    """把一条导入内容写进游戏存档目录（成为当前存档）。

    有 saveindex 走 restore_slot 的槽位外科手术；没有则只铺世界文件、不动账本。
    调用方必须先确认游戏已退出并拍好 pre 保护快照。
    """
    import tempfile

    names = set(scan_entry["files"])
    with tempfile.TemporaryDirectory(prefix="ds_import_") as tmp:
        _extract_group(source, scan_entry.get("key") or "", names, tmp)
        present = set(os.listdir(tmp))
        if not present:
            raise DsError(ErrorCode.IO, "没有解出任何文件", {"entry": scan_entry.get("label")})
        if "saveindex" in present:
            return restore_slot(save_dir, tmp, on_progress=on_progress, slot_id=str(slot_id))
        restored = []
        for name in sorted(present):
            shutil.copy2(os.path.join(tmp, name), os.path.join(save_dir, name))
            restored.append(name)
        return restored