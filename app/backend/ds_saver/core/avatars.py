# -*- coding: utf-8 -*-
r"""角色头像四层来源体系（v5.4，图集运行时解码已移除）。

每层是一个"带框成品 PNG"，键为角色 id（<char>.png）：
  1. upload    data/images/uploads/<char>.png     用户上传，可删可换
  2. official  exe assets/avatars/<char>.png      官方预生成（人工准备，随程序分发，不可删）
  3. mod       data/images/modchars/<char>.png    mod 目录 avatar_*.tex 解码落盘（懒扫描 + mtime 记账）
  4. unknown   fallback 链（官方 unknown.png → 网络）

显示优先级 auto：upload > official > mod > unknown；
per-character override 记在 data/images/overrides.json（"设为使用"某层），恢复自动即清除。
"""
from __future__ import annotations

import base64
import glob
import json
import logging
import os
import re
import shutil
import threading
import time

from . import paths, scan, tex

log = logging.getLogger(__name__)

TARGET = 128
_SAFE_CHAR = re.compile(r"^[a-z0-9_]{1,40}$")
_ALIASES = {"wmaxwell": "waxwell"}
# 来源顺序（auto 优先级，从高到低）
SOURCES = ("upload", "official", "mod")
_OVERRIDE_KEY = "source"


_lock = threading.RLock()
_state: dict = {
    "loaded": False,
    "game_dir": None,
    "mod_chars": {},   # char → mod 名（最近一次扫描的结果）
    "overrides": {},   # char → source（per 角色切换，空 = auto）
}


def _norm_char(value: str) -> str:
    name = (value or "").strip().lower()
    if name.endswith(".png"):
        name = name[:-4]
    if name.endswith(".tex"):
        name = name[:-4]
    if name.startswith("avatar_"):
        name = name[7:]
    name = _ALIASES.get(name, name)
    return name if _SAFE_CHAR.match(name) else ""


# ---------- 四个来源目录 ----------

def uploads_dir() -> str:
    """用户上传层：data/images/uploads/。"""
    return paths.data_dir("images", "uploads")


ASSET_PREFIX = "up_"


def is_asset(key: str) -> bool:
    return str(key).startswith(ASSET_PREFIX)


def asset_path(key: str) -> str:
    safe = _norm_char(key)
    return os.path.join(uploads_dir(), f"{safe}.png") if safe else ""


def upload_asset(source_path: str, name: str = "") -> dict:
    """把一张 PNG 丢进"上传版"素材库，不绑定任何角色；显示名可后续重命名。"""
    import uuid

    from PIL import Image

    source = str(source_path or "")
    if not source or not os.path.isfile(source):
        return {"uploaded": False}
    try:
        with Image.open(source) as image:
            image.verify()
        with open(source, "rb") as fh:
            raw = fh.read()
    except Exception:  # noqa: BLE001
        return {"uploaded": False}
    os.makedirs(uploads_dir(), exist_ok=True)
    key = f"{ASSET_PREFIX}{uuid.uuid4().hex[:10]}"
    out = os.path.join(uploads_dir(), f"{key}.png")
    tmp = out + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(raw)
    os.replace(tmp, out)
    display = (str(name).strip() or os.path.splitext(os.path.basename(source))[0]).strip()[:40] or key
    names = _read_names()
    names[key] = display
    _write_json(names_file(), names)
    return {"uploaded": True, "key": key, "name": display}


def rename_asset(key: str, name: str) -> dict:
    safe = _norm_char(key)
    display = str(name).strip()[:40]
    if not safe or not display:
        return {"renamed": False}
    names = _read_names()
    names[safe] = display
    _write_json(names_file(), names)
    return {"renamed": True, "key": safe, "name": display}


def delete_asset(key: str) -> dict:
    safe = _norm_char(key)
    path = asset_path(safe)
    removed = False
    if path and os.path.isfile(path):
        try:
            os.remove(path)
            removed = True
        except OSError:
            return {"deleted": False}
    names = _read_names()
    if safe in names:
        names.pop(safe, None)
        _write_json(names_file(), names)
    return {"deleted": removed}


def official_dir() -> str:
    """官方版：exe assets/avatars/（打包进程序，不可写）。"""
    meipass = getattr(__import__("sys"), "_MEIPASS", None)
    if meipass:
        return os.path.join(meipass, "ds_saver", "assets", "avatars")
    here = os.path.dirname(os.path.abspath(__file__))
    # core/ -> ds_saver/assets/avatars（与 PyInstaller spec 的 ASSETS 打包路径一致）
    return os.path.normpath(os.path.join(here, "..", "assets", "avatars"))


def modchars_dir() -> str:
    """mod 解码层：data/images/modchars/。"""
    return paths.data_dir("images", "modchars")


def overrides_file() -> str:
    return paths.data_dir("images", "overrides.json")


def deleted_mod_file() -> str:
    """被用户删掉的 mod 头像名单：重扫时跳过，只有「重建缓存」才清空恢复。"""
    return paths.data_dir("images", "deleted_mod.json")


def _read_deleted_mod() -> set[str]:
    try:
        with open(deleted_mod_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return {str(x) for x in data} if isinstance(data, list) else set()
    except (OSError, ValueError):
        return set()


def _write_deleted_mod(chars: set[str]) -> None:
    path = deleted_mod_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(sorted(chars), fh, ensure_ascii=False)
    os.replace(tmp, path)


def names_file() -> str:
    """用户自定义显示名（上传图命名等），id → 名称。"""
    return paths.data_dir("images", "names.json")


def _read_names() -> dict:
    try:
        with open(names_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def set_display_name(char: str, name: str) -> None:
    """记录自定义显示名；空串表示清除（回落内置中文名）。"""
    safe = _norm_char(char)
    if not safe:
        return
    with _lock:
        names = _read_names()
        if name:
            names[safe] = name
        else:
            names.pop(safe, None)
        _write_json(names_file(), names)


def display_label(char: str) -> str:
    """图片库显示名：用户重命名 > 内置中文角色名 > 原始 id。"""
    from . import klei

    custom = str(_read_names().get(char) or "").strip()
    if custom:
        return custom
    return klei.CHARACTER_CN.get(char, char)


def assign_from(char: str, source_char: str) -> dict:
    """把 source_char 的当前显示头像复制为 char 的上传层（图片库选图分配）。"""
    safe = _norm_char(char)
    src = _norm_char(source_char)
    if not safe or not src:
        return {"assigned": False}
    if src.startswith(ASSET_PREFIX):
        src_path = asset_path(src)
        if not os.path.isfile(src_path):
            return {"assigned": False}
        with open(src_path, "rb") as fh:
            raw = fh.read()
        os.makedirs(uploads_dir(), exist_ok=True)
        out = os.path.join(uploads_dir(), f"{safe}.png")
        tmp = out + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(raw)
        os.replace(tmp, out)
        return {"assigned": True, "char": safe, "from": src}
    url = resolve_url(src)
    if not url.startswith("data:image/png;base64,"):
        return {"assigned": False}
    os.makedirs(uploads_dir(), exist_ok=True)
    out = os.path.join(uploads_dir(), f"{safe}.png")
    tmp = out + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(base64.b64decode(url.split(",", 1)[1]))
    os.replace(tmp, out)
    return {"assigned": True, "char": safe, "from": src}


def clear_layer(layer: str) -> int:
    """按层批量删除（图片库批量清空）：upload / mod。official 不可删。"""
    directory = uploads_dir() if layer == "upload" else modchars_dir() if layer == "mod" else None
    if directory is None:
        return 0
    removed = 0
    try:
        for name in os.listdir(directory):
            if name.endswith(".png"):
                try:
                    os.remove(os.path.join(directory, name))
                    removed += 1
                except OSError:
                    pass
    except OSError:
        pass
    if removed and layer == "upload":
        # 上传层清空后，指向 upload 的 override 一并清掉
        with _lock:
            overrides = _state["overrides"]
            changed = False
            for char, source in list(overrides.items()):
                if source == "upload":
                    overrides.pop(char, None)
                    changed = True
            if changed:
                _write_overrides(overrides)
    return removed


def _write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _source_path(char: str, source: str) -> str | None:
    if source == "upload":
        path = os.path.join(uploads_dir(), f"{char}.png")
    elif source == "official":
        path = os.path.join(official_dir(), f"{char}.png")
    elif source == "mod":
        path = os.path.join(modchars_dir(), f"{char}.png")
    else:
        return None
    return path if os.path.isfile(path) else None


# ---------- overrides（per 角色切换） ----------

def _read_overrides() -> dict:
    try:
        with open(overrides_file(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_overrides(overrides: dict) -> None:
    path = overrides_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(overrides, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def set_source(char: str, source: str) -> dict:
    """per 角色指定显示层；'auto' 表示清除 override 回默认优先级。"""
    safe = _norm_char(char)
    if not safe:
        return {"ok": False}
    with _lock:
        overrides = _state["overrides"]
        if source == "auto" or source not in SOURCES:
            overrides.pop(safe, None)
        else:
            overrides[safe] = source
        _write_overrides(overrides)
    return {"ok": True, "char": safe, "source": source if source in SOURCES else "auto"}


# ---------- mod 层：懒扫描落盘 ----------

def locate_roots(game_dir: str | None = None) -> list[str]:
    """游戏安装根：显式 game_dir 优先，再扫 Steam 库的 DS/DST 目录。"""
    roots: list[str] = []
    if game_dir and os.path.isdir(game_dir):
        roots.append(game_dir)
    for lib in scan.steam_libraries():
        for name in ("dont_starve", "Don't Starve Together"):
            candidate = os.path.join(lib, "steamapps", "common", name)
            if os.path.isdir(candidate):
                roots.append(candidate)
    seen: set[str] = set()
    unique: list[str] = []
    for root in roots:
        key = os.path.normcase(os.path.normpath(root))
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def _mod_stamp_file() -> str:
    return os.path.join(modchars_dir(), "scan.json")


def _scan_mod_avatars(game_dir: str | None = None) -> int:
    """扫描 DS mod 目录的 avatar_*.tex，解码落盘 modchars/。mtime 记账避免重复解码。"""
    roots = [r for r in locate_roots(game_dir)
             if os.path.basename(os.path.normpath(r)).lower() == "dont_starve"]
    try:
        with open(_mod_stamp_file(), encoding="utf-8") as fh:
            stamps = json.load(fh)
        stamps = stamps if isinstance(stamps, dict) else {}
    except (OSError, ValueError):
        stamps = {}
    os.makedirs(modchars_dir(), exist_ok=True)
    skipped = _read_deleted_mod()
    produced = 0
    seen: dict[str, float] = {}
    for root in roots:
        pattern = os.path.join(root, "mods", "*", "images", "avatars", "avatar_*.tex")
        for tex_path in glob.glob(pattern):
            stem = os.path.splitext(os.path.basename(tex_path))[0]
            if stem.startswith("avatar_ghost_") or stem.startswith("avatar_self_inspect_"):
                continue
            char = _norm_char(stem)
            if not char or char in skipped:
                continue
            try:
                mtime = os.path.getmtime(tex_path)
            except OSError:
                continue
            seen[char] = mtime
            if stamps.get(char) == mtime and os.path.isfile(
                    os.path.join(modchars_dir(), f"{char}.png")):
                continue  # 没变过，跳过解码
            try:
                with open(tex_path, "rb") as fh:
                    image = tex.decode_all(fh.read())
                image = image.resize((TARGET, TARGET))
                out = os.path.join(modchars_dir(), f"{char}.png")
                tmp = out + ".tmp"
                image.save(tmp, "PNG")
                os.replace(tmp, out)
                produced += 1
            except Exception as exc:  # noqa: BLE001 - 单个 mod 坏图不拖垮整体
                log.debug("mod avatar %s decode failed: %s", char, exc)
    if seen != stamps:
        tmp = _mod_stamp_file() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(seen, fh)
        os.replace(tmp, _mod_stamp_file())
    return produced


# ---------- 解析 ----------

def known_chars() -> list[str]:
    """三层的角色 id 并集（官方 + 上传 + mod），排序输出。"""
    chars: set[str] = set()
    for directory in (official_dir(), uploads_dir(), modchars_dir()):
        try:
            for name in os.listdir(directory):
                char = _norm_char(name)
                if char and not char.startswith(ASSET_PREFIX):
                    chars.add(char)
        except OSError:
            continue
    return sorted(chars)


def _resolve_with_source(char: str, game_dir: str | None = None) -> tuple[str, str | None]:
    """按 override/优先级取头像，返回 (dataURL, 生效来源)；无图返回 ('', None)。"""
    safe = _norm_char(char)
    if not safe:
        return "", None
    from . import fallback  # 延迟 import 防环

    fallback.ensure_unknown(game_dir)
    order = list(SOURCES)
    override = _state["overrides"].get(safe)
    if override in SOURCES:
        order = [override] + [s for s in order if s != override]
    for source in order:
        path = _source_path(safe, source)
        if path:
            try:
                with open(path, "rb") as fh:
                    return ("data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii"),
                            source)
            except OSError:
                continue
    # unknown 兜底（fallback 层）
    unknown = os.path.join(paths.data_dir("images", "fallback"), "unknown.png")
    try:
        with open(unknown, "rb") as fh:
            return ("data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii"), "unknown")
    except OSError:
        return "", None


def resolve_url(char: str, game_dir: str | None = None) -> str:
    """按 override/优先级取一个角色的显示头像 dataURL；没有就回落 unknown 兜底。"""
    return _resolve_with_source(char, game_dir)[0]


def get_data_urls(chars: list[str], game_dir: str | None = None) -> dict:
    """批量取头像（前端契约信封）：avatars 字典 + available/missing/elapsed_ms。

    懒触发 mod 扫描；missing = 没有专属图、只落到 unknown 兜底的角色。
    """
    started = time.time()
    with _lock:
        if not _state["loaded"] or _state["game_dir"] != (game_dir or None):
            _state["game_dir"] = game_dir or None
            try:
                _scan_mod_avatars(game_dir)
            except Exception as exc:  # noqa: BLE001
                log.warning("mod avatar scan failed: %s", exc)
            _state["overrides"] = _read_overrides()
            _state["loaded"] = True
    urls: dict[str, str] = {}
    missing: list[str] = []
    for char in chars:
        url, source = _resolve_with_source(char, game_dir)
        if url:
            urls[char] = url
        if source in (None, "unknown"):
            missing.append(char)
    return {
        "avatars": urls,
        "available": len(urls),
        "missing": missing,
        "elapsed_ms": int((time.time() - started) * 1000),
    }


def refresh(requested: list[str] | None = None, game_dir: str | None = None) -> dict:
    """清状态重拉（js_api.refresh_avatars 用）。"""
    with _lock:
        _state["loaded"] = False
        _state["game_dir"] = None
    return get_data_urls(requested or [], game_dir)


# ---------- 图片库服务 ----------

def library(game_dir: str | None = None, all_chars: list[str] | None = None) -> dict:
    """图片库统计：各层角色数、缺素材名单。纯统计，不触发扫描。"""
    counts = {"official": 0, "upload": 0, "mod": 0}
    total_bytes = 0
    for source, directory in (
        ("official", official_dir()),
        ("upload", uploads_dir()),
        ("mod", modchars_dir()),
    ):
        try:
            for name in os.listdir(directory):
                if not name.endswith(".png"):
                    continue
                counts[source] += 1
                try:
                    total_bytes += os.path.getsize(os.path.join(directory, name))
                except OSError:
                    pass
        except OSError:
            continue
    known = set(known_chars())
    missing = [c for c in (all_chars or []) if c not in known]
    return {
        "char_count": len(known),
        "official_count": counts["official"],
        "upload_count": counts["upload"],
        "mod_count": counts["mod"],
        "missing": missing,
        "cache_count": counts["upload"] + counts["mod"],
        "cache_bytes": total_bytes,
    }


def delete_cached(name: str, source: str | None = None) -> dict:
    """删除一个角色的**可删层**：给了 source 只删该层，否则删掉全部可删层。

    删的是我们缓存/上传的那份（modchars / uploads），绝不动游戏目录里的文件；
    mod 层删除会记入 deleted_mod.json，避免下次扫描又解出来。
    """
    safe = _norm_char(name)
    if not safe:
        return {"deleted": False}
    if safe.startswith(ASSET_PREFIX):
        return delete_asset(safe)
    layers = (source,) if source in ("upload", "mod") else ("upload", "mod")
    removed: list[str] = []
    deleted_mod = _read_deleted_mod()
    for layer in layers:
        path = _source_path(safe, layer)
        if not path:
            continue
        try:
            os.remove(path)
        except OSError:
            return {"deleted": False, "source": layer}
        removed.append(layer)
        if layer == "mod":
            deleted_mod.add(safe)
        with _lock:
            if _state["overrides"].get(safe) == layer:
                _state["overrides"].pop(safe, None)
                _write_overrides(_state["overrides"])
    if not removed:
        return {"deleted": False}
    if safe in deleted_mod:
        _write_deleted_mod(deleted_mod)
    return {"deleted": True, "source": removed[0], "removed": removed}

def prune_legacy_cache() -> int:
    """清理 v5.3 及之前的旧运行时缓存目录 data/avatars（新体系不再使用）。"""
    legacy = paths.data_dir("avatars")
    if not os.path.isdir(legacy):
        return 0
    removed = 0
    try:
        for name in os.listdir(legacy):
            if name.endswith(".png"):
                try:
                    os.remove(os.path.join(legacy, name))
                    removed += 1
                except OSError:
                    pass
        os.rmdir(legacy)
    except OSError:
        pass
    return removed


def rebuild(game_dir: str | None = None) -> dict:
    """重新扫描 mod 层 + 旧缓存清理（设置页「重建缓存」按钮）。"""
    started = time.time()
    with _lock:
        _state["loaded"] = False
        _state["game_dir"] = None
    # 整批重建 = 恢复全部 mod 头像（包括用户此前删掉的）
    _write_deleted_mod(set())
    produced = _scan_mod_avatars(game_dir)
    legacy_removed = prune_legacy_cache()
    get_data_urls([], game_dir)  # 触发懒加载状态刷新
    info = library(game_dir)
    return {"removed": produced + legacy_removed, "elapsed_ms": int((time.time() - started) * 1000),
            "mod_produced": produced, **info}


def diagnostics() -> dict:
    return library()
