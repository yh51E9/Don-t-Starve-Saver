# -*- coding: utf-8 -*-
"""撤销日志：记录可撤销的危险操作，支持 Ctrl+Z 式回退。

数据落 data/undo_log.json（随程序目录便携），最多保留 50 条。
每条记录带上"反转操作"所需的全部信息（如删除前保护快照的 backup_id、
回收站路径），undo_last 据此把操作倒回去。
"""
from __future__ import annotations

import json
import os
import time

from . import paths

MAX_ENTRIES = 50


def _log_path() -> str:
    return os.path.join(paths.data_dir(), "undo_log.json")


def _load() -> list[dict]:
    try:
        with open(_log_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(entries: list[dict]) -> None:
    os.makedirs(os.path.dirname(_log_path()), exist_ok=True)
    with open(_log_path(), "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False)


def record(kind: str, label: str, slot_id: str, payload: dict) -> dict:
    """记录一条可撤销操作（危险操作成功后调用）。"""
    entry = {
        "id": f"{int(time.time() * 1000)}-{kind}",
        "kind": kind,
        "label": label,
        "slot_id": str(slot_id),
        "at": time.time(),
        "payload": payload or {},
    }
    entries = _load()
    entries.append(entry)
    if len(entries) > MAX_ENTRIES:
        entries = entries[-MAX_ENTRIES:]
    _save(entries)
    return entry


def entries() -> list[dict]:
    """按时间正序返回全部记录。"""
    return _load()


def last() -> dict | None:
    entries = _load()
    return entries[-1] if entries else None


def remove(entry_id: str) -> None:
    """撤销成功后把这条记录销掉（撤销本身可再撤销由新记录体现）。"""
    entries = [e for e in _load() if e.get("id") != entry_id]
    _save(entries)
