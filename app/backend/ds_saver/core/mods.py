# -*- coding: utf-8 -*-
r"""从游戏目录解析 mod 的 modinfo.lua，拿名称/作者/版本。

设计约束：全部 best-effort。modinfo 可能缺字段、用 --[[ ]] 注释、
用 [[长字符串]]，解析失败就降级显示 id，绝不让详情页挂掉。
结果带 modinfo mtime 缓存在项目目录 data/modinfo.json，
mod 没更新时详情页刷新零开销。

只认 DS（dont_starve）单机版——联机版 DST 的 mod 不相通，
DST 目录只当头像素材库（avatars.py 的事），不参与 mod 解析。
"""
import base64
import json
import os
import re

from . import paths

# name = "Wilson 的冒险" 或 name = [[Wilson 的冒险]]
_ASSIGN_RE = re.compile(
    r'^\s*(name|author|version|description|icon|icon_atlas)\s*=\s*(.+?)[,\s]*$', re.M)

# 字段名可以出现在任意位置（有的作者把整个 modinfo 压成一行，值还是条件表达式）
_FIELD_RE = re.compile(r'(?<![A-Za-z0-9_])(name|author|version|description|icon|icon_atlas)\s*=\s*', re.I)
_LUA_STRING_RE = re.compile(r'"((?:\\.|[^"\\])*)"|\'((?:\\.|[^\'\\])*)\'|\[\[(.*?)\]\]', re.S)


def deleted_icons_file() -> str:
    """被用户删掉的 Mod 图标名单：重扫时不再生成，只有「扫描图标」才整批恢复。"""
    from . import paths

    return paths.data_dir("images", "deleted_modicons.json")


def _read_deleted_icons() -> set[str]:
    import json as _json

    try:
        with open(deleted_icons_file(), encoding="utf-8") as fh:
            data = _json.load(fh)
        return {str(x) for x in data} if isinstance(data, list) else set()
    except (OSError, ValueError):
        return set()


def _write_deleted_icons(ids: set[str]) -> None:
    import json as _json

    path = deleted_icons_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        _json.dump(sorted(ids), fh, ensure_ascii=False)
    os.replace(tmp, path)


def clear_icon(mod_id: str) -> bool:
    """删掉一份 Mod 图标：清缓存里的 icon 并记入名单，避免下次解析又生成。"""
    cache = read_cache()
    entry = cache.get(mod_id)
    if not isinstance(entry, dict) or not entry.get("icon"):
        return False
    entry["icon"] = ""
    _write_cache(cache)
    deleted = _read_deleted_icons()
    deleted.add(mod_id)
    _write_deleted_icons(deleted)
    return True


CACHE_VERSION = 4


def cache_path() -> str:
    return os.path.join(paths.data_dir("modinfo.json"))


def ds_roots() -> list[str]:
    """DS 单机版安装根目录候选（自动扫描，不依赖用户手填 game_dir）。"""
    from .avatars import locate_roots

    roots = []
    seen = set()
    for root in locate_roots():
        key = os.path.normcase(root)
        if key in seen:
            continue
        seen.add(key)
        if os.path.basename(os.path.normpath(root)).lower() == "dont_starve":
            roots.append(root)
    return roots


def _mods_roots(game_dir: str) -> list[str]:
    """mod 目录候选：显式配置的 DS 目录优先，自动扫描兜底。"""
    roots: list[str] = []
    if game_dir:
        base = os.path.basename(os.path.normpath(game_dir)).lower()
        if base == "dont_starve" and os.path.isdir(os.path.join(game_dir, "mods")):
            roots.append(game_dir)
    for root in ds_roots():
        if root not in roots:
            roots.append(root)
    return roots


def mod_dir(mod_id: str, game_dir: str) -> str:
    """某个 mod 的安装目录；找不到返回空串。"""
    for root in _mods_roots(game_dir):
        candidate = os.path.join(root, "mods", str(mod_id))
        if os.path.isdir(candidate):
            return candidate
    return ""


def _strip_comments(text: str) -> str:
    """剥掉 Lua 注释。先处理块注释（非贪婪），再处理行注释。"""
    text = re.sub(r'--\[\[(?:.|\n)*?\]\]', ' ', text)
    text = re.sub(r'--[^\n]*', ' ', text)
    return text


def _unescape(raw: str) -> str:
    """还原 Lua 字符串转义：\\n/\\t、\\ddd 十进制、\\xNN 十六进制、\\\\ 与引号。"""
    out: list[str] = []
    i = 0
    length = len(raw)
    while i < length:
        ch = raw[i]
        if ch != "\\" or i + 1 >= length:
            out.append(ch)
            i += 1
            continue
        nxt = raw[i + 1]
        if nxt.isdigit():
            j = i + 1
            digits = ""
            while j < length and raw[j].isdigit() and len(digits) < 3:
                digits += raw[j]
                j += 1
            try:
                out.append(chr(int(digits)))
            except ValueError:
                out.append(digits)
            i = j
            continue
        if nxt == "x" and i + 3 < length:
            try:
                out.append(chr(int(raw[i + 2:i + 4], 16)))
                i += 4
                continue
            except ValueError:
                pass
        simple = {"n": "\n", "t": "\t", "r": "\r", "a": "\a", "b": "\b",
                  "f": "\f", "v": "\v", "\\": "\\", '"': '"', "'": "'", "\n": "\n"}
        if nxt in simple:
            out.append(simple[nxt])
            i += 2
            continue
        if nxt == "z":
            i += 2
            while i < length and raw[i].isspace():
                i += 1
            continue
        out.append(nxt)
        i += 2
    return "".join(out).strip()

def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _value_from_segment(segment: str) -> str:
    """从 "name = <这段>" 里取值：

    1. 直接是字符串字面量 → 用它；
    2. 是条件表达式（lan == "en" and "A" or "B"）→ 收集所有字面量，
       优先含中文的、再取最长的一个（界面是中文，宁可选中文名）。
    """
    seg = segment.strip().rstrip(",").strip()
    if not seg:
        return ""
    # 行首就是字面量（`icon = "x.tex"`）：直接取它，忽略同一行后面的其它语句
    head = _LUA_STRING_RE.match(seg)
    if head and not seg[:1].isspace() and head.start() == 0:
        raw = head.group(1) or head.group(2) or head.group(3) or ""
        return _unescape(raw)
    # 表达式（lan == "en" and "A" or "B"）：modinfo 里的表达式基本都在一行内，
    # 只看第一行，避免把后面 forumthread 之类的字段值也当成候选
    seg = seg.split("\n", 1)[0]
    literals = []
    for match in _LUA_STRING_RE.finditer(seg):
        raw = match.group(1) or match.group(2) or match.group(3) or ""
        value = _unescape(raw)
        if value:
            literals.append(value)
    if not literals:
        return ""
    cjk = [value for value in literals if _has_cjk(value)]
    pool = cjk or literals
    return max(pool, key=len)


def parse_modinfo(text: str) -> dict:
    """从 modinfo.lua 提取 name/author/version/description/icon，缺的键不出现。

    不假设"一行一个字段"：作者可能把整个文件压成一行，甚至把值写成条件表达式。
    """
    clean = _strip_comments(text)
    matches = list(_FIELD_RE.finditer(clean))
    result: dict[str, str] = {}
    for index, match in enumerate(matches):
        key = match.group(1)
        if key in result:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(clean)
        value = _value_from_segment(clean[match.end():end])
        if value:
            result[key] = value
    return result

def read_cache() -> dict:
    """mods 解析缓存（mod_id → name/icon 等），供图片库读取。"""
    try:
        with open(cache_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_cache(cache: dict) -> None:
    try:
        os.makedirs(os.path.dirname(cache_path()), exist_ok=True)
        with open(cache_path(), "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False)
    except OSError:
        pass


def modicons_dir() -> str:
    """mod 图标统一落盘：data/images/modicons/<id>.png（图片库管理）。"""
    return paths.data_dir("images", "modicons")


def _load_icon_image(mod_path: str, icon_file: str = "", atlas: str = ""):
    """找到并解码 mod 图标（tex/png），返回 PIL.Image；失败返回 None。"""
    try:
        from PIL import Image

        from . import tex

        names = []
        icon_name = str(icon_file).replace("\\", "/") if icon_file else ""
        dirs = []
        atlas_name = str(atlas).replace("\\", "/") if atlas else ""
        if "/" in atlas_name:
            dirs.append(atlas_name.rsplit("/", 1)[0])
        if icon_name:
            names.append(icon_name)
            if "/" not in icon_name:
                names += [f"{d}/{icon_name}" for d in dirs]
        base = ["modicon.tex", "modicon.png", "icon.tex", "icon.png", "preview.png"]
        names += base
        for d in dirs:
            names += [f"{d}/{name}" for name in base]

        image = None
        for name in names:
            if not str(name).lower().endswith((".tex", ".png")):
                continue
            path = os.path.normpath(os.path.join(mod_path, name))
            if not path.startswith(os.path.normpath(mod_path)) or not os.path.isfile(path):
                continue
            if path.lower().endswith(".tex"):
                with open(path, "rb") as fh:
                    image = tex.decode_all(fh.read())
            else:
                image = Image.open(path).convert("RGBA")
            break
        return image.convert("RGBA") if image is not None else None
    except Exception:
        return None


def _square_icon(image):
    """裁掉透明边 + 方形补 6% 留白：不同 mod 的画布大小不同，统一后视觉重量才一致。"""
    from PIL import Image

    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    side = max(image.size)
    pad = max(2, int(side * 0.06))
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
    canvas.paste(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2), image)
    return canvas


def _modicon_file(mod_path: str, mod_id: str, icon_file: str = "", atlas: str = "") -> str:
    """解出 mod 图标 → 落盘 64px PNG，返回相对路径（列表/缓存用）。"""
    try:
        from PIL import Image

        image = _load_icon_image(mod_path, icon_file, atlas)
        if image is None:
            return ""
        image = _square_icon(image).resize((64, 64), Image.LANCZOS)
        out_dir = modicons_dir()
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{mod_id}.png")
        image.save(out_path, "PNG")
        return f"images/modicons/{mod_id}.png"
    except Exception:
        return ""


# 预览阈值：原图至少这么大才有"看大图"的意义；编码后超过这个体积就不传（防卡顿）
PREVIEW_MIN_SIDE = 128
PREVIEW_MAX_SIDE = 256
PREVIEW_MAX_BYTES = 2 * 1024 * 1024


def icon_preview(mod_id: str, game_dir: str | None = None) -> str:
    """悬停预览用：按需解出最大 256px 的 dataURL（不落盘，不污染列表缓存）。

    原图小于 128px 直接返回空——放大只会更糊，不如就用列表那张。
    """
    import base64
    import io

    from PIL import Image

    safe = str(mod_id)
    mod_path = ""
    for root in _mods_roots(game_dir or ""):
        candidate = os.path.join(root, "mods", safe)
        if os.path.isdir(candidate):
            mod_path = candidate
            break
    if not mod_path:
        return ""
    info_path = os.path.join(mod_path, "modinfo.lua")
    icon_file = ""
    atlas = ""
    if os.path.isfile(info_path):
        try:
            with open(info_path, encoding="utf-8", errors="replace") as fh:
                info = parse_modinfo(fh.read())
            icon_file = str(info.get("icon") or "")
            atlas = str(info.get("icon_atlas") or "")
        except OSError:
            pass
    image = _load_icon_image(mod_path, icon_file, atlas)
    if image is None:
        return ""
    image = _square_icon(image)
    native = image.width
    if native < PREVIEW_MIN_SIDE:
        return ""
    side = min(native, PREVIEW_MAX_SIDE)
    image = image.resize((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, "PNG")
    raw = buf.getvalue()
    if len(raw) > PREVIEW_MAX_BYTES:
        return ""
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")

def resolve_mods(mod_ids: list[str], game_dir: str) -> list[dict]:
    """把 mod id 列表解析成 [{id, name, author, version, description, icon, dir, resolved}]。

    顺序保持传入顺序；找不到 modinfo 或解析失败时 resolved=False、name=id。
    game_dir 无效时自动扫描 DS 安装目录。绝不动 DST 目录。
    """
    entries = []
    if not mod_ids:
        return entries

    cache = read_cache()
    dirty = False

    for mod_id in mod_ids:
        entry = {"id": mod_id, "name": mod_id, "author": "", "version": "",
                 "description": "", "icon": "", "dir": "", "resolved": False}
        mod_path = ""
        for root in _mods_roots(game_dir):
            candidate = os.path.join(root, "mods", str(mod_id))
            if os.path.isdir(candidate):
                mod_path = candidate
                break
        info_path = os.path.join(mod_path, "modinfo.lua") if mod_path else ""
        cached = cache.get(mod_id)
        cached_icon_file = str(cached.get("icon_file") or "") if isinstance(cached, dict) else ""
        cached_atlas = str(cached.get("icon_atlas") or "") if isinstance(cached, dict) else ""
        try:
            mtime = os.path.getmtime(info_path) if info_path else 0.0
        except OSError:
            mtime = 0.0

        icon = ""
        parsed = {}
        if (cached and isinstance(cached, dict) and cached.get("mtime") == mtime
                and mtime and cached.get("pv") == CACHE_VERSION):
            parsed = {k: cached.get(k, "") for k in ("name", "author", "version", "description")}
            icon = cached.get("icon", "")
            # 毒化缓存自愈：旧版本解码失败会把空 icon 写进缓存，这里重试生成
            if not icon and mod_id not in _read_deleted_icons():
                icon_file = cached_icon_file
                if icon_file and not icon_file.lower().endswith((".tex", ".png")):
                    icon_file = ""  # 旧版解析曾把 forumthread 链接记成图标
                # 旧缓存没记 icon_file（比如 screechericon.tex 这种非常规名）：重读 modinfo 补上
                if not icon_file and info_path and os.path.isfile(info_path):
                    try:
                        with open(info_path, encoding="utf-8", errors="replace") as fh:
                            info_again = parse_modinfo(fh.read())
                        icon_file = str(info_again.get("icon") or "")
                        if not cached_atlas:
                            cached_atlas = str(info_again.get("icon_atlas") or "")
                    except OSError:
                        icon_file = ""
                icon = _modicon_file(mod_path, mod_id, icon_file, cached_atlas)
                if icon:
                    cache[mod_id] = dict(parsed, icon=icon, icon_file=icon_file,
                                         icon_atlas=cached_atlas, mtime=mtime, pv=CACHE_VERSION)
                    dirty = True
        elif mtime and info_path:
            try:
                with open(info_path, encoding="utf-8", errors="replace") as fh:
                    parsed = parse_modinfo(fh.read())
            except OSError:
                parsed = {}
            if parsed.get("name") and mod_id not in _read_deleted_icons():
                icon_file = str(parsed.get("icon") or "")
                atlas = str(parsed.get("icon_atlas") or "")
                icon = _modicon_file(mod_path, mod_id, icon_file, atlas)
                cache[mod_id] = dict(parsed, icon=icon, icon_file=icon_file,
                                     icon_atlas=atlas, mtime=mtime, pv=CACHE_VERSION)
                dirty = True

        if parsed.get("name"):
            # icon 是相对路径（images/modicons/<id>.png）；dataURL 由 API 层转换
            entry.update(parsed, icon=icon, dir=mod_path, resolved=True)
        if mod_path:
            entry["dir"] = mod_path
        entries.append(entry)

    if dirty:
        _write_cache(cache)
    return entries


def installed_ids(game_dir: str) -> list[str]:
    """本机**磁盘上真实存在**的 mod id：只扫 mods 目录，并要求有 modinfo.lua。

    - 缓存只用于补充名称/图标，绝不参与"是否安装"的判定（否则历史缓存会冒出幽灵 mod）
    - 没有 modinfo.lua 的目录视为残留/垃圾，跳过
    - 只有完全找不到游戏目录时，才退回缓存键当兜底列表
    """
    ids: list[str] = []
    seen: set[str] = set()
    roots_found = False
    for root in _mods_roots(game_dir):
        mods_root = os.path.join(root, "mods")
        if not os.path.isdir(mods_root):
            continue
        roots_found = True
        try:
            names = sorted(os.listdir(mods_root))
        except OSError:
            continue
        for name in names:
            if name.startswith(".") or name in seen:
                continue
            mod_path = os.path.join(mods_root, name)
            if not os.path.isdir(mod_path):
                continue
            if not os.path.isfile(os.path.join(mod_path, "modinfo.lua")):
                continue  # 空壳/残留目录不算安装
            seen.add(name)
            ids.append(name)
    if not roots_found:
        try:
            cached = read_cache()
        except Exception:  # noqa: BLE001
            cached = {}
        for mod_id in cached:
            if mod_id not in seen:
                seen.add(mod_id)
                ids.append(mod_id)
    return ids

def rescan_icons(game_dir: str) -> dict:
    """强制重解 Mod 图标：清掉缓存中的 icon 后按已安装列表重新解析。"""
    _write_deleted_icons(set())
    cache = read_cache()
    for entry in cache.values():
        if isinstance(entry, dict):
            entry["icon"] = ""
    _write_cache(cache)
    ids = installed_ids(game_dir)
    resolved = resolve_mods(ids, game_dir)
    icons = sum(1 for item in resolved if item.get("icon"))
    return {"mods": len(resolved), "icons": icons}
