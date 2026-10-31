# -*- coding: utf-8 -*-
import base64
import os
import struct
import zlib

import pytest

from ds_saver.core import klei


def test_load_slots_reads_characters_modes_days(save_dir):
    slots = klei.load_slots(str(save_dir))
    assert slots is not None
    assert [slot["index"] for slot in slots] == ["1", "2"]
    assert slots[0]["character"] == "wilson"
    assert slots[0]["mode"] == "survival"
    assert slots[0]["day"] == 42
    assert "cave_1_1_1" in slots[0]["files"]


def test_load_slots_returns_none_without_saveindex(tmp_path):
    assert klei.load_slots(str(tmp_path)) is None


def test_truncated_file_raises_value_error_not_index_error(tmp_path):
    (tmp_path / "saveindex").write_bytes(b"KLEI     1D" + b"AAAA")
    with pytest.raises(ValueError):
        klei.load_slots(str(tmp_path))


def test_nil_value_does_not_recurse_forever(tmp_path):
    from tests.conftest import encode_klei

    (tmp_path / "saveindex").write_bytes(encode_klei('return { a = nil, b = 1 }'))
    slots = klei.load_slots(str(tmp_path))
    assert slots == []


def test_describe_slot_is_chinese(save_dir):
    slot = klei.load_slots(str(save_dir))[0]
    text = klei.describe_slot(slot)
    assert "威尔逊" in text and "42天" in text


def test_waxwell_alias_is_translated():
    assert klei.CHARACTER_CN["waxwell"] == "麦斯威尔"
    assert klei.CHARACTER_CN["wmaxwell"] == "麦斯威尔"


def test_waxwell_alias_is_translated():
    assert klei.CHARACTER_CN["waxwell"] == "麦斯威尔"
    assert klei.CHARACTER_CN["wmaxwell"] == "麦斯威尔"


# ---------------- 写回门禁（v5.2） ----------------

def _normalize(value):
    """解析器把纯数组表还原成 list；比较前把 list 归一化成 {"__array__": [...]}。"""
    if isinstance(value, list):
        return {"__array__": [_normalize(item) for item in value]}
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    return value


def test_bracket_key_roundtrip():
    """["..."]= 键必须完整保留——这是删除存档写回 saveindex 的前提。"""
    data = {"slots": {"__array__": [{"resurrectors": {"shipwrecked_1:100111": 0}}]}}
    text = klei.serialize_lua_table(data)
    assert '["shipwrecked_1:100111"]=' in text
    assert _normalize(klei.parse_lua_table(text)) == data


def test_serialize_edge_cases():
    data = {
        "f": -0.5,
        "sci": 1e-05,
        "neg": -3,
        "empty": {},
        "esc": 'a"b\\c\nd',
        "mixed": {"__array__": [1, 2], "name": "x"},
    }
    text = klei.serialize_lua_table(data)
    assert klei.parse_lua_table(text) == data


def test_encode_klei_prefix_fields():
    text = "return { a = 1 }"
    payload = klei.encode_klei_text(text)
    assert payload.startswith(b"KLEI     1D")
    body = base64.b64decode(payload[11:])
    version, header_len, declen, complen = struct.unpack("<IIII", body[:16])
    assert (version, header_len) == (1, 16)
    assert declen == len(text.encode("utf-8"))
    assert complen == len(body) - 16
    assert zlib.decompress(body[16:]).decode("utf-8") == text


def test_encode_klei_keeps_original_prefix8():
    prefix_bytes = struct.pack("<II", 7, 16) + struct.pack("<II", 4, 2)
    original = b"KLEI     1D" + base64.b64encode(prefix_bytes + b"1234")
    payload = klei.encode_klei_text("return {}", klei._original_prefix8(original))
    body = base64.b64decode(payload[11:])
    version, header_len = struct.unpack("<II", body[:8])
    assert (version, header_len) == (7, 16)


def test_drop_slot_array_keeps_length_and_saveid(save_dir):
    data = klei.parse_lua_table(klei.decode_klei_file(str(save_dir / "saveindex")))
    dropped = klei.drop_slot(data, "2")
    before = data["slots"]
    after = dropped["slots"]
    after_array = after.get("__array__") if isinstance(after, dict) else after
    before_array = before.get("__array__") if isinstance(before, dict) else before
    slots = after_array
    assert len(slots) == len(before_array)
    assert slots[1].get("save_id") == before_array[1].get("save_id")
    assert slots[1].get("character") is None
    # 原数据不被修改
    assert before_array[1].get("character") is not None


def test_drop_slot_named_key():
    data = {"slots": {"1": {"character": "wilson"}, "screecher": {"character": "wilson"}}}
    dropped = klei.drop_slot(data, "screecher")
    assert "screecher" not in dropped["slots"]
    assert "1" in dropped["slots"]


def test_drop_slot_unknown_raises(save_dir):
    data = klei.parse_lua_table(klei.decode_klei_file(str(save_dir / "saveindex")))
    with pytest.raises(ValueError):
        klei.drop_slot(data, "99")


def test_write_saveindex_atomic_roundtrip(save_dir):
    data = klei.parse_lua_table(klei.decode_klei_file(str(save_dir / "saveindex")))
    original = (save_dir / "saveindex").read_bytes()
    dropped = klei.drop_slot(data, "2")
    klei.write_saveindex_atomic(str(save_dir), dropped, original)

    slots = {s["index"]: s for s in klei.load_slots(str(save_dir))}
    assert slots["2"]["files"] == []            # 槽位被清空（游戏自己的"已删"形态）
    assert slots["1"]["character"] == "wilson"  # 其他槽位不受影响
    # 写出的文件能用真实结构再解一遍
    again = klei.parse_lua_table(klei.decode_klei_file(str(save_dir / "saveindex")))
    assert _normalize(again) == _normalize(dropped)


def test_write_saveindex_rolls_back_on_failure(save_dir, monkeypatch):
    data = klei.parse_lua_table(klei.decode_klei_file(str(save_dir / "saveindex")))
    original = (save_dir / "saveindex").read_bytes()
    dropped = klei.drop_slot(data, "1")

    real_replace = os.replace

    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        klei.write_saveindex_atomic(str(save_dir), dropped, original)
    monkeypatch.setattr(os, "replace", real_replace)

    # 原文件没被动过，临时文件也被清掉
    assert (save_dir / "saveindex").read_bytes() == original
    leftovers = [p for p in save_dir.iterdir() if p.name.startswith(".saveindex-")]
    assert leftovers == []


def test_real_saveindex_roundtrip():
    """真实存档：parse -> serialize -> encode -> decode -> parse 必须全等。"""
    from ds_saver.core import scan

    dirs = scan.locate_save_dirs()
    if not dirs:
        pytest.skip("本机没有饥荒存档")
    path = os.path.join(dirs[0], "saveindex")
    if not os.path.isfile(path):
        pytest.skip("saveindex 不存在")
    raw = open(path, "rb").read()
    data = klei.parse_lua_table(klei.decode_klei_file(path))
    text = klei.serialize_lua_table(data)
    payload = klei.encode_klei_text(text, raw[11:19])
    import base64 as b64

    body = b64.b64decode(payload[11:])
    assert zlib.decompress(body[16:]).decode("utf-8") == text
    assert klei.parse_lua_table(text) == data
