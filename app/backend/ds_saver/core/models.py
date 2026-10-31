# -*- coding: utf-8 -*-
"""把 core 的内部结构洗成前端直接能用的形状。

只做视图转换，不碰磁盘。前端拿到的所有 id 都是不透明字符串，
绝不出现路径——路径由后端用 id 反解并做白名单校验。
"""
import os
import re
import time

from . import klei, mods, paths

TAG_LABELS = {
    "manual": "手动", "auto": "自动", "pre": "恢复前",
    "autosave": "游戏保存", "autoexit": "游戏关闭", "tick": "定时", "import": "导入",
}
# 悬停解释：每种来源是什么时候触发的
TAG_HINTS = {
    "manual": "你点击「备份」按钮时手动创建",
    "auto": "自动备份创建（旧版本未细分触发方式）",
    "autosave": "游戏运行中写盘完成后自动创建",
    "autoexit": "游戏退出时的存档写盘被捕捉到后自动创建（退出时会自动存一次盘）",
    "tick": "软件按固定间隔定时创建",
    "pre": "恢复或删除存档前自动拍的保护快照，出问题可以拿它反悔",
    "import": "从文件或压缩包导入的备份",
}


def world_view(slot: dict) -> dict:
    mode_raw = slot.get("mode") or ""
    character_raw = slot.get("character") or "?"
    extras = klei.slot_extras(slot.get("raw") or {})
    # 槽位分三类：普通数字槽 / 尖啸者（Klei 官方总转换 mod，占 index 但不占数字槽）/ 其他非数字槽
    index = str(slot["index"])
    if index.lower().startswith("screecher"):
        kind = "screecher"
    elif index.isdigit():
        kind = "slot"
    else:
        kind = "other"
    return {
        "id": index,
        "kind": kind,
        "mods_count": len(extras["mod_ids"]),
        "dlc": extras["dlc"],
        "character": character_raw,
        "character_label": klei.CHARACTER_CN.get(character_raw, character_raw),
        "mode": mode_raw,
        "mode_label": klei.MODE_NAME_CN.get(mode_raw, mode_raw or "未知"),
        "day": int(slot.get("day") or 0),
        "files": list(slot.get("files") or []),
        "file_count": len(slot.get("files") or []),
        "display": klei.describe_slot(slot),
        "save_id": extras["save_id"],
        "created_at": klei.save_id_created_at(extras["save_id"]),
    }


def backup_view(item: dict) -> dict:
    return {
        "id": item["id"],
        "slot_id": item["slot_id"],
        "dir_name": item["dir_name"],
        "stamp": item["stamp"],
        "tag": item["tag"],
        "tag_label": TAG_LABELS.get(item["tag"], item["tag"]),
        "tag_hint": TAG_HINTS.get(item["tag"], ""),
        "time": item["time"],
        "full_time": item["full_time"],
        "file_count": item["file_count"],
        "size_bytes": item["size_bytes"],
        "total_mb": item["total_mb"],
        "character": item.get("character") or "",
    "character_id": item.get("character_id") or "",
    "character_label": klei.CHARACTER_CN.get(item.get("character") or "", item.get("character") or ""),
        "mode": item.get("mode") or "",
        "day": item.get("day"),
        "save_id": item.get("save_id") or "",
        "mods_count": item.get("mods_count") or 0,
        "dlc": list(item.get("dlc") or []),
        "mode_days": dict(item.get("mode_days") or {}),
        "compatibility": item.get("compatibility") or {},
        "current_world": item.get("current_world") or "",
        "note": item.get("note") or "",
    }


def world_details(slot: dict, save_dir: str, game_dir: str) -> dict:
    """详情页数据：身份/时间/大小/mods/文件，一次给全。

    文件统计走真实磁盘（mtime 最大值 = 最后游玩时间）；
    mods 解析 best-effort，游戏目录无效时全部降级为 id。
    """
    view = world_view(slot)
    extras = klei.slot_extras(slot.get("raw") or {})

    last_played_at = None
    total_bytes = 0
    file_stats = []
    for name in sorted(set(slot.get("files") or [])):
        full = os.path.join(save_dir, name)
        try:
            stat = os.stat(full)
        except OSError:
            continue
        total_bytes += stat.st_size
        mtime = int(stat.st_mtime)
        file_stats.append({"name": name, "size_bytes": stat.st_size, "mtime": mtime})
        if last_played_at is None or mtime > last_played_at:
            last_played_at = mtime

    enabled_ids = extras["mod_ids"]
    # 全部已安装（含未启用）：启用项在前，其余按安装顺序；每项带 enabled 标记
    seen_enabled = set(enabled_ids)
    all_ids = list(enabled_ids) + [i for i in mods.installed_ids(game_dir) if i not in seen_enabled]
    resolved = mods.resolve_mods(all_ids, game_dir)
    for item in resolved:
        item["enabled"] = item["id"] in seen_enabled
    enabled_mods = [item for item in resolved if item["enabled"]]
    # icon 存的是相对路径（images/modicons/<id>.png），这里转 dataURL 给前端
    # （http_server 模式下前端加载不了本地文件路径，统一 dataURL 最稳）
    import base64
    for item in resolved:
        rel = item.get("icon") or ""
        if rel.startswith("data:"):
            continue  # resolve_mods 已返回 dataURL，别当相对路径二次处理
        if rel:
            try:
                with open(paths.data_dir(*rel.split("/")), "rb") as fh:
                    item["icon"] = "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")
            except OSError:
                item["icon"] = ""

    view.update({
        "last_played_at": last_played_at,
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / 1048576, 2),
        "dlc": extras["dlc"],
        "mod_ids": extras["mod_ids"],
        "mods": enabled_mods,
        "installed_mods": resolved,
        "mods_count": len(extras["mod_ids"]),
        "mode_days": extras["mode_days"],
        "files": file_stats,
        "current_world": current_world_label(slot.get("raw") or {}),
        **classify_worlds(file_stats, slot.get("raw") or {}),
    })
    return view


def epoch_date(epoch: int | None, fallback_full_time: str = "") -> str:
    """周目标题里的日期：save_id 能解出 epoch 用 epoch，否则用备份时间。"""
    if epoch:
        return time.strftime("%Y-%m-%d", time.localtime(epoch))
    if fallback_full_time:
        return fallback_full_time[:10]
    return ""


def group_playthroughs(backups: list[dict]) -> list[dict]:
    """把备份列表（新→旧）按 save_id 分成周目组，第 1 周目最老。

    save_id 为空的备份归入"未知周目"组，保持时间顺序。
    返回 [{index, save_id, created_date, backups}]，按周目序（旧→新）排列。
    """
    groups: list[dict] = []
    by_save_id: dict[str, dict] = {}
    for item in backups:  # 新 → 旧
        save_id = str(item.get("save_id") or "")
        key = save_id or "__unknown__"
        group = by_save_id.get(key)
        if group is None:
            group = {"save_id": save_id, "backups": [], "oldest_full_time": item.get("full_time", "")}
            by_save_id[key] = group
            groups.append(group)
        group["backups"].append(item)
        # 新→旧遍历，先到的更新；oldest_full_time 最终停在组里最旧那份上
        group["oldest_full_time"] = item.get("full_time", "")

    # 组的建图时间：save_id epoch 优先，退化到组里最旧备份的日期
    def group_date(group: dict) -> str:
        epoch = klei.save_id_created_at(group["save_id"])
        return epoch_date(epoch, group["oldest_full_time"])

    unknown = [g for g in groups if not g["save_id"]]
    known = [g for g in groups if g["save_id"]]
    known.sort(key=lambda g: min(b["stamp"] for b in g["backups"]))

    result = []
    for position, group in enumerate(known, start=1):
        result.append({
            "index": position,
            "save_id": group["save_id"],
            "created_date": group_date(group),
            "backups": group["backups"],
        })
    if unknown:
        for group in unknown:
            result.append({
                "index": 0,
                "save_id": "",
                "created_date": group_date(group),
                "backups": group["backups"],
            })
    return result


# ---------------- 世界分类（备份详情 / 存档详情共用） ----------------

_SURVIVAL_RE = re.compile(r"^survival_(\d+)$")
_SHIP_RE = re.compile(r"^shipwrecked_(\d+)$")
_VOLCANO_RE = re.compile(r"^volcano_(\d+)$")
_PORK_RE = re.compile(r"^porkland_(\d+)$")
_ADVENTURE_RE = re.compile(r"^adventure_(\d+)$")
_CAVE_RE = re.compile(r"^cave_(\d+)_(\d+)_(\d+)$")


def compatibility_of(modes: dict, files: list[str], dlc: list[str]) -> dict:
    """版本归属：原版 < 巨人国 < 海难 < 哈姆雷特，后者依赖前者。"""
    has_ship = bool(modes.get("shipwrecked")) or any(f.startswith("shipwrecked_") for f in files)
    has_pork = bool(modes.get("porkland")) or any(f.startswith("porkland_") for f in files)
    opts = (modes.get("survival") or {}).get("options") or {}
    has_rog = bool(opts.get("ROGEnabled")) or "巨人国" in dlc
    if has_pork:
        return {"primary": "哈姆雷特", "requires": ["巨人国", "海难"], "chain": ["巨人国", "海难", "哈姆雷特"]}
    if has_ship:
        return {"primary": "海难", "requires": ["巨人国"], "chain": ["巨人国", "海难"]}
    if has_rog:
        return {"primary": "巨人国", "requires": [], "chain": ["巨人国"]}
    return {"primary": "原版", "requires": ["无 DLC"], "chain": ["原版"]}


def classify_worlds(files: list[dict], raw: dict) -> dict:
    """把文件名分类成世界列表（含未生成）、其他文件、兼容性。

    files: [{"name": str, "size_bytes": int}]；raw: saveindex 里的槽位原始数据。
    """
    modes = (raw or {}).get("modes") or {}
    dlc = klei.slot_extras(raw or {})["dlc"]
    sizes = {item["name"]: int(item.get("size_bytes") or 0) for item in files}
    names = sorted(sizes)
    worlds: list[dict] = []
    other: list[dict] = []

    def push(kind: str, label: str, index: int, day, name: str, level: int = 0) -> None:
        worlds.append({
            "type": kind, "label": label, "index": index, "level": level,
            "day": day if isinstance(day, int) else None,
            "file": name, "size_bytes": sizes.get(name, 0),
        })

    cave_files = list((modes.get("cave") or {}).get("files") or [])
    for name in names:
        for kind, regex, label in (
            ("survival", _SURVIVAL_RE, "地面世界"),
            ("shipwrecked", _SHIP_RE, "海难"),
            ("volcano", _VOLCANO_RE, "火山"),
            ("porkland", _PORK_RE, "猪镇"),
            ("adventure", _ADVENTURE_RE, "冒险模式"),
        ):
            m = regex.match(name)
            if not m:
                continue
            push(kind, label, int(m.group(1)), (modes.get(kind) or {}).get("day"), name)
            break
        else:
            if name.startswith("survival_screecher"):
                push("screecher", "尖啸者世界", 1, (modes.get("survival") or {}).get("day"), name)
            elif _CAVE_RE.match(name):
                pass  # 按 modes.cave.files 顺序补，避免编号错乱
            else:
                other.append({"name": name, "size_bytes": sizes.get(name, 0)})

    for level, name in enumerate(cave_files, start=1):
        if name not in sizes:
            continue
        m = _CAVE_RE.match(name)
        push("cave", f"洞穴第 {level} 层", int(m.group(1)) if m else 1,
             (modes.get("cave") or {}).get("day"), name, level)

    compat = compatibility_of(modes, names, dlc)
    generated = {w["type"] for w in worlds}
    expected: list[tuple[str, str]] = [("survival", "地面世界"), ("cave", "洞穴")]
    if "海难" in compat["chain"]:
        expected += [("shipwrecked", "海难"), ("volcano", "火山")]
    if "哈姆雷特" in compat["chain"]:
        expected.append(("porkland", "猪镇"))
    ungenerated = [label for kind, label in expected if kind not in generated]

    order = {"survival": 0, "cave": 1, "shipwrecked": 2, "volcano": 3,
             "porkland": 4, "adventure": 5, "screecher": 6}
    worlds.sort(key=lambda w: (order.get(w["type"], 9), w["level"] or w["index"]))

    return {
        "worlds": worlds,
        "ungenerated": ungenerated,
        "other_files": other,
        "compatibility": compat,
    }


def current_world_label(raw: dict) -> str:
    """角色当时所在的具体世界：原版生存/巨人国/海滩/猪镇/xx-洞穴第 N 层/海滩-火山。"""
    raw = raw or {}
    modes = raw.get("modes") or {}
    current = raw.get("current_mode") or raw.get("mode") or ""
    has_rog = bool((modes.get("survival") or {}).get("options", {}).get("ROGEnabled"))
    has_ship = bool(modes.get("shipwrecked"))
    has_pork = bool(modes.get("porkland"))

    if current == "cave":
        cave = modes.get("cave") or {}
        levels = cave.get("current_level")
        level = levels[0] if isinstance(levels, list) and levels else cave.get("current_cave", 1)
        base = "巨人国" if has_rog else "原版"
        return f"{base}-洞穴第 {int(level)} 层"
    if current == "volcano":
        return "海滩-火山"
    if current == "shipwrecked":
        return "海滩"
    if current == "porkland":
        return "猪镇"
    if current == "survival":
        return "巨人国" if has_rog else "原版生存"
    if current:
        # mod 世界：保留原始 mode 名，前端归入「其他」桶
        return str(current)
    if has_pork:
        return "猪镇"
    if has_ship:
        return "海滩"
    if has_rog:
        return "巨人国"
    return "原版生存"
