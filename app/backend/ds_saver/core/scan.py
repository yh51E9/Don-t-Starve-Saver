# -*- coding: utf-8 -*-
"""找存档目录：Steam 注册表 → libraryfolders.vdf → 文档目录兜底。

原样搬自 v4.1 locate_save_dirs，行为不变（包括大小写不敏感去重）。
find_save_candidates 是宽松版：不要求 saveindex 存在，给前端单选确认用。
"""
import os
import re

from . import klei


def _steam_paths_from_registry() -> list[str]:
    paths = []
    try:
        import winreg

        for hive, key in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam"),
        ):
            try:
                with winreg.OpenKey(hive, key) as handle:
                    value, _ = winreg.QueryValueEx(handle, "SteamPath")
                    paths.append(value)
            except OSError:
                pass
    except Exception:
        pass
    return paths


def _steam_libraries(steam_root: str) -> list[str]:
    """Steam 可能把游戏装在别的盘，库列表在 libraryfolders.vdf 里。"""
    libraries = [steam_root]
    vdf = os.path.join(steam_root, "steamapps", "libraryfolders.vdf")
    try:
        with open(vdf, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        libraries += re.findall(r'"path"\s+"([^"]+)"', text)
    except OSError:
        pass
    return [lib.replace("\\\\", "\\") for lib in libraries]


def steam_libraries() -> list[str]:
    """所有 Steam 库根目录（含主库），大小写不敏感去重。"""
    roots = _steam_paths_from_registry()
    if not roots:
        for path in (r"C://Program Files (x86)//Steam", r"D://Steam", r"E://Steam"):
            if os.path.isdir(path):
                roots.append(path)

    libraries: list[str] = []
    seen = set()
    for root in roots:
        for library in _steam_libraries(root):
            key = os.path.normcase(os.path.normpath(library))
            if key not in seen and os.path.isdir(library):
                seen.add(key)
                libraries.append(library)
    return libraries


def locate_save_dirs() -> list[str]:
    """扫描所有可能的饥荒单机存档目录，返回去重后的绝对路径。"""
    found: list[str] = []
    docs = os.path.join(os.path.expanduser("~"), "Documents")

    steam_roots = _steam_paths_from_registry()
    if not steam_roots:
        for path in (r"C:\Program Files (x86)\Steam", r"D:\Steam", r"E:\Steam"):
            if os.path.isdir(path):
                steam_roots.append(path)

    for root in steam_roots:
        for library in _steam_libraries(root):
            userdata = os.path.join(library, "userdata")
            if not os.path.isdir(userdata):
                continue
            try:
                uids = os.listdir(userdata)
            except OSError:
                continue
            for uid in uids:
                candidate = os.path.join(userdata, uid, "219740", "remote")
                if os.path.isfile(os.path.join(candidate, "saveindex")):
                    found.append(candidate)

    for candidate in (
        os.path.join(docs, "Klei", "DoNotStarve", "save"),
        os.path.join(docs, "Klei", "DoNotStarve"),
    ):
        if os.path.isfile(os.path.join(candidate, "saveindex")):
            found.append(candidate)

    result: list[str] = []
    seen = set()
    for path in found:
        norm = os.path.normpath(path)
        key = norm.lower()
        if key not in seen:
            seen.add(key)
            result.append(norm)
    return result


# ---------------- 候选扫描（P1-4） ----------------

_STEAM_APP_ID = "219740"
_PERSONA_RE = re.compile(r'"PersonaName"\s+"([^"]*)"')


def _steam_account_names(steam_root: str) -> dict[str, str]:
    """userdata/<uid>/config/localconfig.vdf 里的 PersonaName，失败降级为 uid。"""
    names: dict[str, str] = {}
    userdata = os.path.join(steam_root, "userdata")
    if not os.path.isdir(userdata):
        return names
    for uid in os.listdir(userdata):
        config = os.path.join(userdata, uid, "config", "localconfig.vdf")
        try:
            with open(config, encoding="utf-8", errors="replace") as fh:
                match = _PERSONA_RE.search(fh.read())
        except OSError:
            continue
        names[uid] = match.group(1) if match else uid
    return names


def _dir_mtime(path: str, depth: int = 2) -> float:
    """目录粗略最后修改时间：顶层文件 + 两层内目录的 mtime 最大值。"""
    latest = 0.0
    try:
        entries = list(os.scandir(path))
    except OSError:
        return 0.0
    for entry in entries:
        try:
            latest = max(latest, entry.stat().st_mtime)
            if depth > 0 and entry.is_dir():
                latest = max(latest, _dir_mtime(entry.path, depth - 1))
        except OSError:
            continue
    return latest


def _world_count(path: str) -> int | None:
    """saveindex 能解析出几个非空槽位；解析失败返回 None。"""
    try:
        slots = klei.load_slots(path) or []
    except Exception:
        return None
    return sum(1 for slot in slots if slot.get("files"))


def find_save_candidates(excluded: list[str] | None = None) -> list[dict]:
    """所有可能的单机存档目录，不要求 saveindex 存在。

    返回 [{path, source, account, has_saveindex, world_count, last_modified}]，
    Steam 候选在前、文档目录在后，同一目录只出现一次。
    excluded：用户持久排除的目录（弹窗里"不再显示"），路径大小写不敏感。
    """
    excluded_keys = {
        os.path.normcase(os.path.normpath(p)) for p in (excluded or []) if p
    }
    candidates: list[dict] = []
    seen: set[str] = set()

    def add(path: str, source: str, account: str) -> None:
        norm = os.path.normpath(path)
        key = os.path.normcase(norm)
        if key in seen or key in excluded_keys:
            return
        seen.add(key)
        has_saveindex = os.path.isfile(os.path.join(norm, "saveindex"))
        candidates.append({
            "path": norm,
            "source": source,
            "account": account,
            "has_saveindex": has_saveindex,
            "world_count": _world_count(norm) if has_saveindex else None,
            "last_modified": int(_dir_mtime(norm)) or None,
        })

    for root in _steam_paths_from_registry():
        if not os.path.isdir(root):
            continue
        names = _steam_account_names(root)
        userdata = os.path.join(root, "userdata")
        if not os.path.isdir(userdata):
            continue
        for uid in os.listdir(userdata):
            candidate = os.path.join(userdata, uid, _STEAM_APP_ID, "remote")
            if os.path.isdir(candidate):
                add(candidate, "steam", names.get(uid, uid))

    docs = os.path.join(os.path.expanduser("~"), "Documents")
    for candidate, account in (
        (os.path.join(docs, "Klei", "DoNotStarve", "save"), "本机文档目录"),
        (os.path.join(docs, "Klei", "DoNotStarve"), "本机文档目录"),
    ):
        if os.path.isdir(candidate):
            add(candidate, "documents", account)

    return candidates
