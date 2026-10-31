# -*- coding: utf-8 -*-
"""Klei 饥荒单机版存档格式解析。

saveindex 结构（实测）:
  "KLEI     1D"  (11 字节头) + base64 文本 + zlib 流，解压后是 Lua 表文本。

原样搬自 v4.1 的 klei_format.py，只补了解析器的越界保护——
旧版在存档被截断时会抛 IndexError 而不是 ValueError，调用方分不清"格式不认"和"代码有 bug"。
"""
import base64
import os
import re
import struct
import tempfile
import zlib

MODE_NAME_CN = {
    "survival": "巨人国",
    "shipwrecked": "海难",
    "porkland": "哈姆雷特",
    "adventure": "冒险模式",
    "cave": "洞穴",
    "volcano": "火山",
    "screecher": "惊魂夜",
}

CHARACTER_CN = {
    "wilson": "威尔逊", "willow": "薇洛", "wolfgang": "沃尔夫冈", "wendy": "温蒂",
    "wx78": "机器人WX-78", "wickerbottom": "薇克巴顿", "woodie": "伍迪", "wes": "韦斯",
    "waxwell": "麦斯威尔", "wmaxwell": "麦斯威尔", "wathgrithr": "薇格弗德", "webber": "韦伯", "walani": "瓦拉尼",
    "wilton": "威尔顿", "winnie": "温妮", "wilbur": "威尔伯",
    "warly": "沃利", "woodlegs": "伍德莱格", "wilba": "薇尔芭", "wormwood": "沃姆伍德",
    "wheeler": "薇勒尔", "wortox": "沃拓克斯",
    "warbucks": "沃巴克斯", "wagstaff": "瓦格斯塔夫",
    # 官方头像组覆盖 DST 专属形象，译名一并收录（官方简中）
    "wanda": "旺达", "walter": "沃尔特", "winona": "薇诺娜",
    "wonkey": "芜猴", "wurt": "沃特",
    # Klei 官方万圣节总转换 mod 的怪物形象（不是可玩角色，但头像库需要）
    "screecher": "尖啸者",
}


def decode_klei_file(path: str) -> str:
    """解码 KLEI 格式文件，返回 Lua 表文本。失败抛 ValueError。"""
    with open(path, "rb") as fh:
        raw = fh.read()
    for start in (10, 11, 12):
        body = re.sub(rb"[^A-Za-z0-9+/=]", b"", raw[start:])
        for cut in range(0, 3):
            for pad in range(0, 4):
                try:
                    dec = base64.b64decode(body[cut:] + b"=" * pad)
                except Exception:
                    continue
                for off in range(0, 40):
                    try:
                        return zlib.decompress(dec[off:]).decode("utf-8")
                    except Exception:
                        continue
    raise ValueError(f"无法解码存档文件: {path}")


def parse_lua_table(text: str):
    """极简 Lua 表解析器，支持字符串/数字/布尔/嵌套表/数组。"""
    pos = 0
    n = len(text)

    def skip_ws():
        nonlocal pos
        while pos < n and text[pos] in " \t\r\n":
            pos += 1

    def need(index: int):
        if index >= n:
            raise ValueError(f"解析失败 @ {index}: 文件意外结束")

    def parse_value():
        nonlocal pos
        skip_ws()
        need(pos)
        c = text[pos]
        if c == "{":
            return parse_table()
        if c == '"':
            return parse_string()
        m = re.match(r"[-0-9.eE+]+", text[pos:])
        if m:
            num = m.group(0)
            pos += len(num)
            return float(num) if ("." in num or "e" in num.lower()) else int(num)
        m = re.match(r"\w+", text[pos:])
        if m:
            word = m.group(0)
            pos += len(word)
            if word == "true":
                return True
            if word == "false":
                return False
            if word == "nil":
                return None
            if word == "return":
                return parse_value()
            return word
        raise ValueError(f"解析失败 @ {pos}: {text[pos:pos + 30]!r}")

    def parse_string():
        nonlocal pos
        out = []
        pos += 1  # 跳过 "
        while pos < n:
            c = text[pos]
            if c == "\\":
                need(pos + 1)
                nxt = text[pos + 1]
                esc = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
                out.append(esc.get(nxt, nxt))
                pos += 2
                continue
            if c == '"':
                pos += 1
                return "".join(out)
            out.append(c)
            pos += 1
        raise ValueError("字符串未闭合")

    def parse_table():
        nonlocal pos
        result = {}
        array_items = []
        pos += 1  # {
        while True:
            skip_ws()
            need(pos)
            if text[pos] == "}":
                pos += 1
                break
            is_pair = False
            key = None
            value = None
            if text[pos] == "[" and pos + 1 < n and text[pos + 1] == '"':
                pos += 1  # 跳过 [；" 留给 parse_string，多跳会吃掉键名首字符
                key = parse_string()
                skip_ws()
                if pos < n and text[pos] == "]":
                    pos += 1
                    skip_ws()
                    if pos < n and text[pos] == "=":
                        pos += 1
                        value = parse_value()
                        is_pair = True
            elif text[pos] == '"':
                save = pos
                key = parse_string()
                skip_ws()
                if pos < n and text[pos] == "=":
                    pos += 1
                    value = parse_value()
                    is_pair = True
                else:
                    pos = save
            else:
                m = re.match(r"[\w.]+", text[pos:])
                if m:
                    save = pos
                    key = m.group(0)
                    pos += len(key)
                    skip_ws()
                    if pos < n and text[pos] == "=":
                        pos += 1
                        value = parse_value()
                        is_pair = True
                    else:
                        pos = save
            if is_pair:
                result[key] = value
            else:
                array_items.append(parse_value())
            skip_ws()
            if pos < n and text[pos] in ",;":
                pos += 1
        if array_items:
            if result:
                result["__array__"] = array_items
            else:
                return array_items
        return result

    return parse_value()


# ---------------- 序列化与写回 ----------------
# 实测 saveindex 容器：11 字节 "KLEI     1D" + base64( 16 字节前缀 + zlib(text) )
# 前缀 = u32 version=1, u32 header_len=16, u32 解压长度, u32 压缩长度；zlib level 9。

_MAGIC = b"KLEI     1D"
_HEADER_LEN = 16
_SIMPLE_KEY = re.compile(r"^[A-Za-z_]\w*$")


def _escape(value: str) -> str:
    out = value.replace("\\", "\\\\").replace('"', '\\"')
    return out.replace("\n", "\\n").replace("\t", "\\t").replace("\r", "\\r")


def _number(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        text = repr(value)
        return text if ("." in text or "e" in text or "inf" in text or "nan" in text) else text + ".0"
    raise TypeError(f"无法序列化的数值: {value!r}")


def _serialize(value, indent: int = 0) -> str:
    if value is None:
        return "nil"
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return f'"{_escape(value)}"'
    if isinstance(value, list):
        return _serialize({"__array__": value}, indent)
    if not isinstance(value, dict):
        raise TypeError(f"无法序列化的类型: {type(value)!r}")

    items = list(value.get("__array__", []) or [])
    pairs = [(k, v) for k, v in value.items() if k != "__array__"]
    if not items and not pairs:
        return "{  }"
    pieces = [_serialize(item, indent) for item in items]
    for key, item in pairs:
        if _SIMPLE_KEY.match(str(key)):
            pieces.append(f"{key}={_serialize(item, indent)}")
        else:
            pieces.append(f'["{_escape(str(key))}"]={_serialize(item, indent)}')
    return "{ " + ", ".join(pieces) + " }"


def serialize_lua_table(data) -> str:
    """把解析出的 dict/list 写回 Lua 表文本。数组部分（__array__）排在命名键之前。"""
    return "return " + _serialize(data)


def encode_klei_text(text: str, prefix8: bytes | None = None) -> bytes:
    """Lua 文本 -> saveindex 字节。prefix8 是原文件前 8 字节（版本+头长），默认全按实测值。"""
    raw = text.encode("utf-8")
    compressed = zlib.compress(raw, 9)
    version, header_len = (1, _HEADER_LEN)
    if prefix8 is not None and len(prefix8) == 8:
        version, header_len = struct.unpack("<II", prefix8)
    prefix = struct.pack("<IIII", version, header_len, len(raw), len(compressed))
    return _MAGIC + base64.b64encode(prefix + compressed)


def drop_slot(data: dict, slot_id: str) -> dict:
    """从 saveindex 结构里清空一个槽位，返回新 dict（不改原数据）。

    数组槽位照游戏自己的"已删"形态替换成空占位（保留该槽的 save_id），
    绝不删除数组元素——否则后面所有槽位序号前移，备份目录 slot_<n> 全部错位。
    命名槽位（如 screecher）直接移除。
    """
    import copy

    result = copy.deepcopy(data)
    slots_raw = result.get("slots")
    if isinstance(slots_raw, list):
        index = int(slot_id) - 1
        if not 0 <= index < len(slots_raw):
            raise ValueError(f"槽位不存在: {slot_id}")
        slots_raw[index] = _empty_slot(slots_raw[index])
        return result
    if isinstance(slots_raw, dict):
        array = slots_raw.get("__array__")
        if isinstance(array, list) and str(slot_id).isdigit():
            index = int(slot_id) - 1
            if not 0 <= index < len(array):
                raise ValueError(f"槽位不存在: {slot_id}")
            array[index] = _empty_slot(array[index])
            return result
        if str(slot_id) in slots_raw:
            del slots_raw[str(slot_id)]
            return result
    raise ValueError(f"saveindex 里找不到槽位: {slot_id}")


def splice_slot(data: dict, slot_id: str, entry) -> dict:
    """把一个槽位条目替换/写进 saveindex 结构，其他槽位原样保留（返回新 dict）。

    恢复备份时用它，而不是拿备份里的整份 saveindex 覆盖——
    saveindex 是所有槽位共用的账本，整体覆盖会把别的槽位也拉回旧时刻。
    寻址规则与 drop_slot 相同：数字 id 走数组位置，非数字走命名键。
    """
    import copy

    result = copy.deepcopy(data)
    slots_raw = result.get("slots")
    if isinstance(slots_raw, list):
        index = int(slot_id) - 1
        while len(slots_raw) <= index:
            slots_raw.append(_empty_slot({}))
        slots_raw[index] = copy.deepcopy(entry)
        return result
    if isinstance(slots_raw, dict):
        if str(slot_id).isdigit():
            array = slots_raw.setdefault("__array__", [])
            index = int(slot_id) - 1
            while len(array) <= index:
                array.append(_empty_slot({}))
            array[index] = copy.deepcopy(entry)
            return result
        slots_raw[str(slot_id)] = copy.deepcopy(entry)
        return result
    raise ValueError("saveindex 结构里找不到 slots 表")


def slot_entry(data: dict, slot_id: str):
    """取出一个槽位条目（不拷贝）。取不到返回 None。"""
    slots_raw = data.get("slots") if isinstance(data, dict) else None
    if isinstance(slots_raw, list):
        index = int(slot_id) - 1
        return slots_raw[index] if 0 <= index < len(slots_raw) else None
    if isinstance(slots_raw, dict):
        if str(slot_id).isdigit():
            array = slots_raw.get("__array__") or []
            index = int(slot_id) - 1
            return array[index] if 0 <= index < len(array) else None
        return slots_raw.get(str(slot_id))
    return None


def _empty_slot(original) -> dict:
    previous = original.get("save_id") if isinstance(original, dict) else None
    slot = {"dlc": {}, "modes": {"survival": {}}, "mods": {}, "resurrectors": {}}
    if previous:
        slot["save_id"] = previous
    return slot


def write_raw_atomic(save_dir: str, payload: bytes) -> None:
    """把字节原子写进 saveindex：tmp + fsync + os.replace，失败不留半截文件。"""
    index_path = os.path.join(save_dir, "saveindex")
    handle, tmp_path = tempfile.mkstemp(dir=save_dir, prefix=".saveindex-", suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_path, index_path)
    except OSError:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def restore_raw_atomic(save_dir: str, original_bytes: bytes) -> None:
    """回滚路径：把改写前的原始字节原样写回去。"""
    write_raw_atomic(save_dir, original_bytes)


def write_saveindex_atomic(save_dir: str, data: dict, original_bytes: bytes | None = None) -> bytes:
    """序列化 + 原子落盘 + 回读校验。失败时抛异常，不留下半截文件。

    original_bytes 是改写前的 saveindex 原始字节，只用于调用方做回滚，
    本函数不往 save 目录写任何备份文件（remote/ 受 Steam Cloud 管理）。
    """
    prefix8 = _original_prefix8(original_bytes)
    payload = encode_klei_text(serialize_lua_table(data), prefix8)
    write_raw_atomic(save_dir, payload)

    # 回读：必须能解、且槽位集合与写入的一致
    verify = parse_lua_table(decode_klei_file(os.path.join(save_dir, "saveindex")))
    written = verify.get("slots") if isinstance(verify, dict) else None
    expected = data.get("slots")
    if not _slots_signature(written) == _slots_signature(expected):
        raise ValueError("saveindex 回读校验失败：槽位签名与写入内容不一致")
    return payload


def _original_prefix8(original_bytes: bytes | None) -> bytes | None:
    """从原 saveindex 取 16 字节前缀的前 8 字节（版本 + 头长）。取不到就用默认值。"""
    if not original_bytes or not original_bytes.startswith(_MAGIC):
        return None
    try:
        body = base64.b64decode(re.sub(rb"[^A-Za-z0-9+/=]", b"", original_bytes[11:]))
    except Exception:
        return None
    return body[:8] if len(body) >= 8 else None


def _slots_signature(value) -> tuple:
    """槽位集合签名：序号 + 每槽 save_id（没有就空串）。空占位与原槽不算同一个。"""
    if isinstance(value, list):
        return tuple(
            (str(i + 1), item.get("save_id", "") if isinstance(item, dict) else "")
            for i, item in enumerate(value)
        )
    if isinstance(value, dict):
        array = value.get("__array__") or []
        named = tuple(sorted(k for k in value if k != "__array__"))
        if not named:
            # 序列化后"只有数组的表"会还原成纯 list，签名按同一形态比较
            return _slots_signature(array)
        return (
            tuple(
                (str(i + 1), item.get("save_id", "") if isinstance(item, dict) else "")
                for i, item in enumerate(array)
            ),
            named,
        )
    return ()


def load_slots(save_dir: str):
    """读取 saveindex，返回槽位列表；没有 saveindex 时返回 None。"""
    idx_path = os.path.join(save_dir, "saveindex")
    if not os.path.isfile(idx_path):
        return None
    data = parse_lua_table(decode_klei_file(idx_path))
    slots_raw = data.get("slots") if isinstance(data, dict) else None

    items = []  # (槽位标识, dict)
    if isinstance(slots_raw, list):
        items = [(str(i + 1), s) for i, s in enumerate(slots_raw) if isinstance(s, dict)]
    elif isinstance(slots_raw, dict):
        for i, s in enumerate(slots_raw.get("__array__", []) or []):
            if isinstance(s, dict):
                items.append((str(i + 1), s))
        for name, s in slots_raw.items():
            if name != "__array__" and isinstance(s, dict):
                items.append((name, s))

    slots = []
    for sid, raw_slot in items:
        mode = raw_slot.get("current_mode", "")
        files = []
        day = 0
        modes = raw_slot.get("modes", {})
        if isinstance(modes, dict):
            for _mname, mval in modes.items():
                if not isinstance(mval, dict):
                    continue
                d = mval.get("day")
                if isinstance(d, int) and d > day:
                    day = d
                fl = mval.get("files", [])
                if isinstance(fl, list):
                    files.extend(f for f in fl if isinstance(f, str))
                if isinstance(mval.get("file"), str):
                    files.append(mval["file"])
                cl = mval.get("cave_levels")
                if isinstance(cl, list):
                    files.extend(f for f in cl if isinstance(f, str))
        slots.append({
            "index": sid,
            "character": raw_slot.get("character", "?"),
            "mode": mode,
            "day": day,
            "files": sorted(set(files)),
            "raw": raw_slot,
        })
    return slots


def describe_slot(slot: dict) -> str:
    mode = MODE_NAME_CN.get(slot["mode"], slot["mode"] or "未知")
    ch = CHARACTER_CN.get(slot["character"], slot["character"])
    return f"槽位{slot['index']} - {ch} - {mode} - {slot['day']}天"


def save_id_created_at(save_id) -> int | None:
    """从 save_id 猜建图时间，纯 best-effort。

    save_id 是一串数字。落在 Unix 秒（2001-2033）或毫秒（2001-2065）
    常见区间就换算成秒级时间戳，否则返回 None（界面显示"未知"）。
    """
    try:
        value = int(str(save_id).strip())
    except (TypeError, ValueError):
        return None
    if 1_000_000_000 <= value < 2_000_000_000:
        return value
    if 1_000_000_000_000 <= value < 2_000_000_000_000:
        return value // 1000
    return None


_DLC_CN = (
    ("porkland", "哈姆雷特"),
    ("hamlet", "哈姆雷特"),
    ("giants", "巨人国"),
    ("shipwrecked", "海难"),
)


def dlc_label(name: str) -> str:
    """DLC 原始键名（PORKLAND_DLC 之类）→ 中文名，认不出原样返回。"""
    low = str(name).lower().replace("_dlc", "")
    for pattern, cn in _DLC_CN:
        if pattern in low:
            return cn
    return str(name)


def slot_extras(raw_slot: dict) -> dict:
    """从原始槽位条目提取详情页要用的扩展字段，全部 best-effort。

    返回 {save_id, dlc, mod_ids, mode_days}，缺省给空值，绝不抛异常。
    """
    if not isinstance(raw_slot, dict):
        return {"save_id": "", "dlc": [], "mod_ids": [], "mode_days": {}}

    dlc = []
    raw_dlc = raw_slot.get("dlc")
    if isinstance(raw_dlc, dict):
        for name, enabled in raw_dlc.items():
            if enabled:
                dlc.append(dlc_label(str(name)))

    mod_ids = []
    raw_mods = raw_slot.get("mods")
    if isinstance(raw_mods, dict):
        mod_ids = [str(k) for k in raw_mods.keys() if k != "__array__"]
    elif isinstance(raw_mods, list):
        mod_ids = [str(m) for m in raw_mods if isinstance(m, str)]

    mode_days = {}
    raw_modes = raw_slot.get("modes")
    if isinstance(raw_modes, dict):
        for mname, mval in raw_modes.items():
            if isinstance(mval, dict) and isinstance(mval.get("day"), int):
                mode_days[str(mname)] = int(mval["day"])

    return {
        "save_id": str(raw_slot.get("save_id") or ""),
        "dlc": dlc,
        "mod_ids": mod_ids,
        "mode_days": mode_days,
    }


def describe_slot(slot: dict) -> str:
    mode = MODE_NAME_CN.get(slot["mode"], slot["mode"] or "未知")
    ch = CHARACTER_CN.get(slot["character"], slot["character"])
    return f"槽位{slot['index']} - {ch} - {mode} - {slot['day']}天"


if __name__ == "__main__":
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.expanduser("~"), "Documents", "Klei", "DoNotStarve", "save")
    for item in load_slots(target) or []:
        print(describe_slot(item), "| files:", ",".join(item["files"]))
