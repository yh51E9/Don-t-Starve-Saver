# -*- coding: utf-8 -*-
"""测试夹具：造一个假的饥荒存档目录（KLEI 头 + base64(zlib(Lua))）。"""
import base64
import zlib

import pytest


def encode_klei(lua_text: str) -> bytes:
    return b"KLEI     1D" + base64.b64encode(zlib.compress(lua_text.encode("utf-8")))


def slot_lua(index: int, character: str, mode: str, day: int, files: list[str]) -> str:
    file_list = ", ".join(f'"{name}"' for name in files)
    return (
        '{ character="%s", current_mode="%s", modes={ %s={ day=%d, files={ %s } } } }'
        % (character, mode, mode, day, file_list)
    )


def write_save_dir(root, slots):
    root.mkdir(parents=True, exist_ok=True)
    lua = "return { slots = { " + ", ".join(slots) + " } }"
    (root / "saveindex").write_bytes(encode_klei(lua))
    for slot in slots:
        for name in _files_of(slot):
            (root / name).write_bytes(b"x" * 1024)
    return root


def _files_of(slot_lua_text: str) -> list[str]:
    import re

    return re.findall(r'"([a-z0-9_]+)"', slot_lua_text.split("files=")[-1])


@pytest.fixture
def save_dir(tmp_path):
    slots = [
        slot_lua(1, "wilson", "survival", 42, ["survival_1", "cave_1_1_1"]),
        slot_lua(2, "wx78", "shipwrecked", 7, ["shipwrecked_2"]),
    ]
    return write_save_dir(tmp_path / "save", slots)


@pytest.fixture
def backup_root(tmp_path):
    root = tmp_path / "backups"
    root.mkdir()
    return root


@pytest.fixture
def isolated_paths(tmp_path, monkeypatch):
    """把 config/backup/log 的默认位置重定向到临时目录。"""
    from ds_saver.core import paths

    monkeypatch.setattr(paths, "app_dir", lambda: str(tmp_path))
    return tmp_path
