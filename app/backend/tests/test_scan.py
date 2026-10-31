# -*- coding: utf-8 -*-
"""P1-4：候选存档目录扫描（不要求 saveindex、Steam 账号名、去重）。"""
import base64

import zlib

from ds_saver.core import scan


def _write_saveindex(remote, slots=1):
    lua = "return { slots = { " + ", ".join(
        '{ character="wilson", current_mode="survival", '
        f'modes={{ survival={{ day={10 + i}, files={{ "survival_{i + 1}" }} }} }} }}'
        for i in range(slots)
    ) + " } }"
    (remote / "saveindex").write_bytes(
        b"KLEI     1D" + base64.b64encode(zlib.compress(lua.encode("utf-8"))))
    for i in range(slots):
        (remote / f"survival_{i + 1}").write_bytes(b"x" * 64)


def _fake_steam(tmp_path, uid="1222722443", persona="玩家甲"):
    """造一个假 Steam 根：userdata + localconfig.vdf + 219740 remote。"""
    root = tmp_path / "steam"
    userdata = root / "userdata" / uid
    remote = userdata / "219740" / "remote"
    remote.mkdir(parents=True)
    config = userdata / "config"
    config.mkdir()
    (config / "localconfig.vdf").write_text(
        f'"UserLocalConfigStore"{{ "friends"{{ "PersonaName" "{persona}" }} }}',
        encoding="utf-8")
    return root, remote


def _isolate_docs(tmp_path, monkeypatch):
    """把文档目录指到空的 tmp home，避免真实机器的 Documents 漏进测试。"""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    monkeypatch.setattr(scan.os.path, "expanduser", lambda _: str(home))
    return home


def test_candidates_find_steam_remote_with_persona(tmp_path, monkeypatch):
    root, remote = _fake_steam(tmp_path)
    _write_saveindex(remote, slots=2)
    _isolate_docs(tmp_path, monkeypatch)
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root)])

    candidates = scan.find_save_candidates()
    assert len(candidates) == 1
    item = candidates[0]
    assert item["source"] == "steam"
    assert item["account"] == "玩家甲"
    assert item["has_saveindex"] is True
    assert item["world_count"] == 2
    assert item["last_modified"]


def test_candidates_without_saveindex_still_listed(tmp_path, monkeypatch):
    """空目录（没开过世界）也要出现在候选里，has_saveindex=False。"""
    root, remote = _fake_steam(tmp_path, persona="乙")
    _isolate_docs(tmp_path, monkeypatch)
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root)])

    candidates = scan.find_save_candidates()
    assert len(candidates) == 1
    assert candidates[0]["has_saveindex"] is False
    assert candidates[0]["world_count"] is None
    assert candidates[0]["account"] == "乙"


def test_candidates_persona_missing_falls_back_to_uid(tmp_path, monkeypatch):
    root, remote = _fake_steam(tmp_path)
    (root / "userdata" / "1222722443" / "config" / "localconfig.vdf").write_text(
        '"UserLocalConfigStore"{}', encoding="utf-8")
    _write_saveindex(remote)
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root)])

    candidates = scan.find_save_candidates()
    assert candidates[0]["account"] == "1222722443"


def test_candidates_corrupt_saveindex_reports_none(tmp_path, monkeypatch):
    root, remote = _fake_steam(tmp_path)
    (remote / "saveindex").write_bytes(b"garbage not klei format")
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root)])

    candidates = scan.find_save_candidates()
    assert candidates[0]["has_saveindex"] is True
    assert candidates[0]["world_count"] is None


def test_candidates_dedupes_and_includes_documents(tmp_path, monkeypatch):
    """Steam 根重复注册只出一候选；文档目录候选垫底且账号是固定文案。"""
    root, remote = _fake_steam(tmp_path)
    _write_saveindex(remote)
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root), str(root)])

    home = _isolate_docs(tmp_path, monkeypatch)
    save = home / "Documents" / "Klei" / "DoNotStarve" / "save"
    save.mkdir(parents=True)

    candidates = scan.find_save_candidates()
    # save 目录 + 其父目录 DoNotStarve 都是合法候选（代码有意为之）
    assert len(candidates) == 3
    assert candidates[0]["source"] == "steam"
    assert all(item["source"] == "documents" for item in candidates[1:])
    assert all(item["account"] == "本机文档目录" for item in candidates[1:])
    paths = [item["path"].lower() for item in candidates]
    assert len(paths) == len(set(paths))


def test_candidates_respects_exclusion(tmp_path, monkeypatch):
    """排除列表命中（大小写不敏感）的候选不再出现；不排除时行为不变。"""
    root, remote = _fake_steam(tmp_path)
    _write_saveindex(remote)
    monkeypatch.setattr(scan, "_steam_paths_from_registry", lambda: [str(root)])
    _isolate_docs(tmp_path, monkeypatch)

    base = scan.find_save_candidates()
    assert len(base) == 1
    target = base[0]["path"]

    # 大小写变体也要能命中
    variant = target.upper().replace("D://", "d://")
    assert scan.find_save_candidates([variant]) == []
    assert scan.find_save_candidates([]) == base
