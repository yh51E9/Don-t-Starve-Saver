# -*- coding: utf-8 -*-
"""暴露给 JavaScript 的接口。

约定：
  - 所有方法返回 {ok, data, error}
  - 所有 id 都是不透明字符串，前端不拼路径
  - 耗时动作只返回 job_id，结果通过 poll_events 推回去
"""
import logging
import os
import shutil

import webview

from ..core import avatars
from ..core import klei, mods
from ..core import config as config_mod
from ..core import models, paths, scan, store
from ..core.errors import DsError, ErrorCode
from ..platform import shell, win32
from .envelope import guard

log = logging.getLogger(__name__)


class JsApi:
    def __init__(self, session, runner, bus, host=None):
        # 一律私有：pywebview 会遍历 js_api 的公开属性，指回 AppHost/window 会无限递归
        self._session = session
        self._runner = runner
        self._bus = bus
        self._host = host

    # ---------- 基础 ----------

    @guard
    def bootstrap(self):
        payload = self._session.bootstrap()
        payload["platform"] = {
            **payload.get("platform", {}),
            "win_build": win32.windows_build(),
            "webview2": win32.webview2_version(),
            "titlebar_dark": bool(self._host.titlebar_dark) if self._host else False,
            "chrome": dict(self._host.chrome) if self._host else {},
            "log_dir": paths.log_dir(),
            # 自动检测到的 DS 安装目录（即使配置留空，界面也要能显示实际用的路径）
            "game_dir_auto": (mods.ds_roots() or [""])[0],
            # 明暗初始值：设置窗 boot 用它初始化 scheme，否则配置亮色时重开设置窗恒暗
            "scheme": self._host.resolve_scheme() if self._host else "dark",
        }
        payload["defaults"] = dict(config_mod.DEFAULTS)
        payload["options"] = config_mod.OPTIONS
        return payload

    @guard
    def list_save_dirs(self):
        return {"dirs": self._session.save_dirs, "save_dir": self._session.save_dir}

    @guard
    def list_save_candidates(self):
        excluded = list(self._session.cfg.get("excluded_candidates") or [])
        return {"candidates": scan.find_save_candidates(excluded),
                "save_dir": self._session.save_dir, "excluded": excluded}

    @guard
    def exclude_save_candidate(self, path):
        return self._set_excluded_candidate(path, add=True)

    @guard
    def restore_save_candidate(self, path):
        return self._set_excluded_candidate(path, add=False)

    def _set_excluded_candidate(self, path, add: bool):
        """持久排除/恢复一个候选存档目录（只动 config，不碰磁盘）。"""
        target = os.path.normpath(str(path or "").strip())
        if not target or target == ".":
            raise DsError(ErrorCode.BAD_ARGS, "路径不能为空")
        current = [os.path.normpath(p) for p in
                   (self._session.cfg.get("excluded_candidates") or [])]
        key = os.path.normcase(target)
        if add:
            if os.path.normcase(self._session.save_dir or "") == key:
                raise DsError(ErrorCode.BAD_ARGS, "不能排除当前正在使用的存档目录")
            if key not in map(os.path.normcase, current):
                current.append(target)
        else:  # 恢复幂等：不在列表里也照常返回最新状态
            current = [p for p in current if os.path.normcase(p) != key]
        self._session.update_config({"excluded_candidates": current})
        excluded = list(self._session.cfg.get("excluded_candidates") or [])
        return {"excluded": excluded,
                "candidates": scan.find_save_candidates(excluded)}

    @guard
    def set_save_dir(self, path):
        return self._session.set_save_dir(path)

    @guard
    def list_worlds(self):
        # 先重读 saveindex：否则只返回开机缓存，游戏里新建的槽位永远不出现
        self._session.refresh_worlds()
        return {"worlds": self._session.worlds_payload(),
                "selected_slot": self._session.selected_id}

    @guard
    def select_world(self, slot_id):
        self._session.select(slot_id)
        worlds = self._session.worlds_payload()
        slot = next((item for item in worlds if item["id"] == str(slot_id)), None)
        if slot is None:
            raise DsError(ErrorCode.UNKNOWN_SLOT, "这个世界已经不在存档里了")
        return {"slot": slot, "backups": self._session.backups(slot_id)}

    @guard
    def list_backups(self, slot_id=None):
        return {"backups": self._session.backups(slot_id)}

    @guard
    def world_details(self, slot_id):
        world = self._session.world(slot_id)
        return models.world_details(world, self._session.save_dir,
                                    str(self._session.cfg.get("game_dir") or ""))

    @guard
    def get_stats(self):
        return store.stats(self._session.backup_root())

    @guard
    def pick_folder(self, kind="save_dir"):
        if self._host is None or self._host.window is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境不支持系统文件夹选择框")
        result = self._host.window.create_file_dialog(webview.FileDialog.FOLDER)
        if not result:
            return {"path": None}
        path = result[0] if isinstance(result, (list, tuple)) else result
        return {"path": os.path.normpath(str(path))}

    # ---------- 备份 / 恢复 ----------

    @guard
    def backup(self, slot_id, tag="manual"):
        self._session.world(slot_id)
        if not self._session.save_dir:
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")
        return {"job_id": self._runner.submit("backup", slot_id=str(slot_id), tag=tag)}

    @guard
    def preview_restore(self, backup_id):
        root = self._session.backup_root()
        slot_id, backup_path = store.resolve_backup_id(root, backup_id)
        world = self._session.world(slot_id)
        if not os.path.isdir(backup_path):
            raise DsError(ErrorCode.BACKUP_NOT_FOUND, "这份备份已经不在了")
        preview = store.preview_restore(world, backup_path)
        preview["game_running"] = store.is_game_running()
        preview["slot_id"] = slot_id
        return preview

    @guard
    def restore(self, backup_id, confirmed_idle=False):
        """恢复备份。游戏在跑时默认拒绝；confirmed_idle=True 表示用户已勾选
        「游戏没在玩这个存档」（在主菜单或玩别的档），放行且跳过运行中复检。"""
        root = self._session.backup_root()
        slot_id, backup_path = store.resolve_backup_id(root, backup_id)
        if not os.path.isdir(backup_path):
            raise DsError(ErrorCode.BACKUP_NOT_FOUND, "这份备份已经不在了")
        if store.is_game_running() and not confirmed_idle:
            raise DsError(ErrorCode.GAME_RUNNING, "检测到饥荒正在运行，请先退出游戏再恢复")
        store.validate_backup(backup_path)
        return {"job_id": self._runner.submit("restore", backup_id=str(backup_id),
                                              confirmed_idle=bool(confirmed_idle))}


    # ---------- 导入 / 导出 ----------

    @guard
    def pick_file(self, allow_multiple=False, file_types=None):
        """系统文件选择框（导入用）。"""
        if self._host is None or self._host.window is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境不支持系统文件选择框")
        ftypes = tuple(file_types) if file_types else ("All files (*.*)",)
        result = self._host.window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=bool(allow_multiple), file_types=ftypes)
        if not result:
            return {"paths": []}
        items = result if isinstance(result, (list, tuple)) else [result]
        return {"paths": [os.path.normpath(str(p)) for p in items]}

    @guard
    def pick_save_file(self, default_name="backups.zip"):
        """系统保存对话框（导出用）。"""
        if self._host is None or self._host.window is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境不支持系统保存对话框")
        result = self._host.window.create_file_dialog(
            webview.FileDialog.SAVE, save_filename=str(default_name),
            file_types=("Zip archive (*.zip)",))
        if not result:
            return {"path": None}
        path = result[0] if isinstance(result, (list, tuple)) else result
        return {"path": os.path.normpath(str(path))}

    @guard
    def export_backups(self, backup_ids, dest_path):
        """把选中的备份打包成 zip。"""
        root = self._session.backup_root()
        return store.export_backups(root, [str(x) for x in (backup_ids or [])], str(dest_path))

    @guard
    def import_scan(self, path):
        """识别导入源内容（向导：选文件 -> 预览）。"""
        return store.import_scan(str(path))

    @guard
    def import_backup(self, path, mode="backup", entry_key=None):
        """导入一份内容：mode=backup 收进备份库（tag=import）；
        mode=save 写进游戏存档（先拍「恢复前」保护快照，游戏必须已退出）。"""
        session = self._session
        scan = store.import_scan(str(path))
        entry = next((e for e in scan["entries"] if e["key"] == (entry_key or "")), None)
        if entry is None and len(scan["entries"]) == 1:
            entry = scan["entries"][0]
        if entry is None:
            raise DsError(ErrorCode.BAD_ARGS, "请指定要导入的那一份内容", {})
        if not entry.get("slot_id"):
            raise DsError(ErrorCode.PARSE, "无法确定这份内容属于哪个存档槽位", {})
        sid = str(entry["slot_id"])
        save_dir = session.save_dir
        if not save_dir:
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")
        root = session.backup_root()

        if mode == "save":
            if store.is_game_running(force=True):
                raise DsError(ErrorCode.GAME_RUNNING, "检测到饥荒正在运行，请先退出游戏再导入")
            world = next((w for w in session.worlds_copy() if str(w["index"]) == sid), None)
            pre = store.backup_slot(save_dir, world, root, tag="pre") if world else None
            restored = store.import_as_save(save_dir, str(path), entry, sid)
            session.refresh_worlds()
            self._bus.emit("data.backups_changed", slot_id=sid)
            return {"mode": "save", "restored": restored, "slot_id": sid,
                    "pre_backup": pre.get("id") if pre else None, "stats": store.stats(root)}

        created = store.import_as_backup(root, str(path), entry, borrow_index_from=save_dir)
        session.refresh_worlds()
        self._bus.emit("data.backups_changed", slot_id=sid)
        return {"mode": "backup", "backup": created, "slot_id": sid, "stats": store.stats(root)}

    @guard
    def delete_backup(self, backup_id):
        result = store.delete_backup(self._session.backup_root(), backup_id)
        from ..core import undo
        undo.record("delete_backup", f"删除备份（槽位 {result['slot_id']}）", result["slot_id"],
                    {"trash_path": result["trash_path"]})
        return {
            "deleted": True,
            "freed_bytes": result["freed_bytes"],
            "backups": self._session.backups(result["slot_id"]),
            "stats": store.stats(self._session.backup_root()),
        }

    @guard
    def undo_last(self):
        """撤销最近一次危险操作（删除存档 / 恢复 / 删备份）。"""
        from ..core import undo

        entry = undo.last()
        if entry is None:
            raise DsError(ErrorCode.BAD_ARGS, "没有可撤销的操作")
        session = self._session
        root = session.backup_root()
        save_dir = session.save_dir
        kind = entry["kind"]
        payload = entry.get("payload") or {}

        if kind in ("delete_world", "restore"):
            if not save_dir:
                raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")
            slot_id, path = store.resolve_backup_id(root, str(payload.get("backup_id") or ""))
            restored = store.restore_slot(save_dir, path, slot_id=str(slot_id))
            session.refresh_worlds()
            self._bus.emit("data.backups_changed", slot_id=str(slot_id))
            undo.remove(entry["id"])
            return {"kind": kind, "label": entry["label"], "restored": len(restored),
                    "slot_id": str(slot_id), "stats": store.stats(root)}

        if kind == "delete_backup":
            result = store.undelete_backup(root, str(payload.get("trash_path") or ""))
            self._bus.emit("data.backups_changed", slot_id=result["slot_id"])
            undo.remove(entry["id"])
            return {"kind": kind, "label": entry["label"], "slot_id": result["slot_id"],
                    "backups": session.backups(result["slot_id"]),
                    "stats": store.stats(root)}

        raise DsError(ErrorCode.BAD_ARGS, f"这种操作不支持撤销：{kind}")

    @guard
    def orphan_backups(self):
        """已删除/被替换世界的残留快照（save_id 不属于任何当前世界）。"""
        from ..core import models

        worlds = self._session.worlds_copy()
        items = store.orphan_backups(self._session.backup_root(),
                                     [str(w.get("save_id") or "") for w in worlds])
        return {"items": [models.backup_view(item) for item in items]}

    @guard
    def cleanup(self, scope="all", slot_id=None):
        if scope == "slot" and slot_id:
            root = self._session.backup_root()
            removed, freed = store.enforce_from_config(
                root, str(slot_id), self._session.cfg)
            self._bus.emit("data.backups_changed", slot_id=str(slot_id))
            return {"job_id": None, "removed": removed, "freed_bytes": freed,
                    "stats": store.stats(root)}
        return {"job_id": self._runner.submit("cleanup", scope=scope)}

    @guard
    def cancel_job(self, job_id):
        return self._runner.cancel(job_id)

    # ---------- 删除存档 ----------

    @guard
    def game_running(self):
        return {"running": store.is_game_running()}

    @guard
    def open_settings(self):
        if self._host is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境不支持独立设置窗口")
        self._host.open_settings()
        return {"opened": True}

    @guard
    def close_settings(self):
        if self._host is not None:
            self._host.close_settings()
        return {"closed": True}

    @guard
    def ack_settings_close(self):
        """前端收到关闭信号（弹了确认框）时取消后端兜底强关。"""
        if self._host is not None:
            return {"acked": self._host.ack_settings_close()}
        return {"acked": True}

    @guard
    def delete_save(self, slot_id, delete_backups=False):
        """把存档移进回收站并从 saveindex 摘除。真正干活在 delete_world 任务里。"""
        slot_id = str(slot_id)
        self._session.world(slot_id)
        if not self._session.save_dir:
            raise DsError(ErrorCode.SAVE_DIR_INVALID, "还没有指定存档目录")
        if store.is_game_running():
            raise DsError(ErrorCode.GAME_RUNNING, "检测到饥荒正在运行，请先退出游戏再删除存档")
        return {"job_id": self._runner.submit(
            "delete_world", slot_id=slot_id, delete_backups=bool(delete_backups))}

    # ---------- 设置 ----------

    @guard
    def get_settings(self):
        return {
            "config": dict(self._session.cfg),
            "defaults": dict(config_mod.DEFAULTS),
            "options": config_mod.OPTIONS,
        }

    @guard
    def save_settings(self, patch):
        if not isinstance(patch, dict):
            raise DsError(ErrorCode.BAD_ARGS, "设置必须是对象")
        cfg = self._session.update_config(patch)
        if self._host is not None:
            self._host.apply_theme_from_config()
        # 广播完整配置：另一扇窗（主窗）无需重启即可应用新主题/字号
        self._bus.emit("config.changed", config=cfg)
        return {
            "config": cfg,
            "applied": {
                "color_scheme": self._host.current_scheme if self._host else "dark",
                "preset": cfg.get("theme_preset"),
                "font_size": cfg.get("font_size"),
            },
        }

    @guard
    def system_scheme(self):
        """系统当前明暗，供"跟随系统"预览使用。"""
        return {"scheme": self._host.system_scheme() if self._host else "dark"}

    @guard
    def preview_chrome(self, preset, scheme):
        """设置页即时预览：只染标题栏，不落盘（保存才写配置）。"""
        if self._host is None:
            return {"ok": False}
        self._host.preview_chrome(str(preset), "light" if scheme == "light" else "dark")
        return {"ok": True}

    @guard
    def set_auto_backup(self, on):
        return self._session.set_auto(bool(on))

    # ---------- 角色头像 ----------

    def _game_dir(self):
        return self._session.cfg.get("game_dir") or None

    @guard
    def get_avatars(self, chars):
        return avatars.get_data_urls([str(c) for c in (chars or [])], self._game_dir())

    @guard
    def refresh_avatars(self, chars=None):
        requested = [str(c) for c in (chars or [])]
        result = avatars.refresh(requested, self._game_dir())
        return result

    @guard
    def avatar_diagnostics(self):
        return avatars.diagnostics(self._game_dir())

    @guard
    def avatar_library(self):
        worlds = self._session.worlds_copy()
        chars = [str(w.get("character") or "") for w in worlds]
        return avatars.library(self._game_dir(), all_chars=chars)

    @guard
    def avatar_rebuild(self):
        return avatars.rebuild(self._game_dir())

    @guard
    def avatar_preview(self):
        """兼容入口：内部转调图片库（仅头像分组）。"""
        lib = self.image_library()
        return {"items": lib["avatars"], "cache_count": len(lib["avatars"]),
                "cache_bytes": sum(item["size"] for item in lib["avatars"])}

    @guard
    def backup_mods(self, backup_id):
        """备份当时的 mod 列表：解析备份内 saveindex 的 mod_ids → 实时解析 mod 信息。"""
        _slot, path = store.resolve_backup_id(self._session.backup_root(), str(backup_id))
        mod_ids: list[str] = []
        for slot in klei.load_slots(path) or []:
            if str(slot["index"]) == _slot:
                mod_ids = klei.slot_extras(slot.get("raw") or {})["mod_ids"]
                break
        resolved = mods.resolve_mods(mod_ids, str(self._session.cfg.get("game_dir") or ""))
        # icon 相对路径 → dataURL（与 world_details 同款转换）
        import base64
        for item in resolved:
            rel = item.get("icon") or ""
            if rel and not rel.startswith("data:"):
                try:
                    with open(paths.data_dir(*rel.split("/")), "rb") as fh:
                        item["icon"] = "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")
                except OSError:
                    item["icon"] = ""
        return {"mods": resolved, "mods_count": len(mod_ids)}

    @guard
    def avatar_assign_from(self, char, source_char):
        """把图片库里另一个角色的当前头像指定给 char（存档右键选图）。"""
        return avatars.assign_from(str(char), str(source_char))

    @guard
    def avatar_clear_layer(self, layer):
        """按层批量删除（upload/mod）；official 不可删。"""
        layer = str(layer)
        if layer not in ("upload", "mod"):
            raise DsError(ErrorCode.BAD_ARGS, "只能批量清空上传层或 Mod 层")
        removed = avatars.clear_layer(layer)
        return {"removed": removed}

    @guard
    def get_changelog(self):
        """读内置 CHANGELOG.md（随 exe 打包），前端「关于」渲染。"""
        path = os.path.join(paths.assets_dir(), "CHANGELOG.md")
        try:
            with open(path, encoding="utf-8") as fh:
                return {"markdown": fh.read()}
        except OSError:
            return {"markdown": ""}

    @guard
    def log_js_error(self, message, detail=""):
        """前端 JS 错误上报：白屏/渲染异常的栈进 app.log，便于远程诊断。"""
        log.error("[js] %s | %s", message, str(detail)[:2000])
        return {"logged": True}

    @guard
    def backup_set_note(self, backup_id, note):
        """给备份写/清备注（存在程序数据目录，不改备份内容）。"""
        return store.set_backup_note(str(backup_id), str(note))

    @guard
    def filter_options(self):
        """表格筛选项：兼容性 / 当前世界 / 角色。

        角色只给官方中文名（不受上传头像自定义名影响）；
        mod / 尖啸者 / 未知统一走前端的「其他」桶。
        """
        from ..core import avatars, klei

        compat = ["原版", "巨人国", "海难", "哈姆雷特"]
        worlds = [
            "原版生存", "巨人国", "海滩", "猪镇",
            "原版-洞穴第 1 层", "原版-洞穴第 2 层",
            "巨人国-洞穴第 1 层", "巨人国-洞穴第 2 层",
            "海滩-火山",
        ]
        # 去重：waxwell / wmaxwell 都是麦斯威尔，显示一次即可
        canonical: dict[str, str] = {}
        for key, label in klei.CHARACTER_CN.items():
            if label not in canonical:
                canonical[label] = key

        groups = [
            {"key": "base", "label": "原版", "items": []},
            {"key": "rog", "label": "巨人国新增", "items": []},
            {"key": "sw", "label": "海滩新增", "items": []},
            {"key": "hamlet", "label": "猪镇新增", "items": []},
            {"key": "other", "label": "其他", "items": []},
        ]
        bucket = {"base": groups[0]["items"], "rog": groups[1]["items"],
                  "sw": groups[2]["items"], "hamlet": groups[3]["items"],
                  "other": groups[4]["items"]}

        dlc_group = {
            "wilson": "base", "willow": "base", "wolfgang": "base", "wendy": "base",
            "wx78": "base", "wickerbottom": "base", "woodie": "base", "wes": "base",
            "waxwell": "base", "wmaxwell": "base",
            "wathgrithr": "rog", "webber": "rog",
            "walani": "sw", "warly": "sw", "woodlegs": "sw", "wonkey": "sw",
            "wilba": "hamlet", "wormwood": "hamlet", "wheeler": "hamlet",
            "wagstaff": "hamlet", "warbucks": "hamlet",
            "wanda": "other", "walter": "other", "winona": "other",
            "wurt": "other", "wortox": "other", "screecher": "other",
        }

        for label, key in sorted(canonical.items(), key=lambda item: item[0]):
            bucket[dlc_group.get(key, "other")].append({"key": key, "label": label})

        seen = set(canonical.values())
        for key in avatars.known_chars():
            # unknown 是官方头像目录里的「问号兜底图」，不是真角色，不能进筛选
            if key in seen or key in ("unknown",) or key.startswith(avatars.ASSET_PREFIX):
                continue
            seen.add(key)
            bucket["other"].append({"key": key, "label": key})

        return {"compat": compat, "world": worlds, "character_groups": groups}

    @guard
    def backup_overview(self, backup_id):
        """备份详情：世界列表 / 兼容性 / 未生成世界 / 其他文件。"""
        return store.backup_overview(self._session.backup_root(), str(backup_id))

    @guard
    def backup_files(self, backup_id):
        """备份目录文件清单（详情弹窗）。"""
        return store.backup_files(self._session.backup_root(), str(backup_id))

    @guard
    def image_library(self):
        """图片库：角色头像（多来源）/ Mod 图标 / 兜底素材，统一 dataURL 预览。"""
        import base64
        from ..core import avatars

        groups: dict[str, list[dict]] = {"avatars": [], "official": [], "modicons": [], "fallback": []}

        # 角色头像：每角色列可用来源与当前生效层（upload/official/mod/unknown）
        avatars.get_data_urls(avatars.known_chars())  # 懒触发 mod 扫描
        for char in avatars.known_chars():
            sources = []
            for source in ("upload", "official", "mod"):
                path = avatars._source_path(char, source)
                if path:
                    sources.append({
                        "source": source,
                        "deletable": source != "official",
                    })
            url = avatars.resolve_url(char)
            override = avatars._state["overrides"].get(char, "auto")
            groups["avatars"].append({
                "key": char,
                "label": avatars.display_label(char),
                "url": url,
                "active_source": override if override in avatars.SOURCES else "auto",
                "sources": sources,
                "path": "",
                "size": 0,
            })

        # 上传素材：独立丢进库里的头像，不绑定角色（key 以 up_ 开头，可重命名/删除）
        try:
            names = avatars._read_names()
        except Exception:  # noqa: BLE001
            names = {}
        try:
            for name in sorted(os.listdir(avatars.uploads_dir())):
                if not name.startswith(avatars.ASSET_PREFIX) or not name.endswith(".png"):
                    continue
                key = os.path.splitext(name)[0]
                full = os.path.join(avatars.uploads_dir(), name)
                try:
                    with open(full, "rb") as fh:
                        raw = fh.read()
                except OSError:
                    continue
                groups["avatars"].append({
                    "key": key,
                    "label": names.get(key, key),
                    "url": "data:image/png;base64," + base64.b64encode(raw).decode("ascii"),
                    "active_source": "upload",
                    "sources": [{"source": "upload", "deletable": True}],
                    "path": "",
                    "size": len(raw),
                })
        except OSError:
            pass

        # 官方头像组：全部官方角色图 + 问号兜底末尾（只读展示，不支持删除）
        official_path = avatars.official_dir()
        try:
            official_names = sorted(os.listdir(official_path))
        except OSError:
            official_names = []
        for name in official_names:
            if not name.endswith(".png"):
                continue
            key = os.path.splitext(name)[0]
            if key == "unknown":
                continue  # 问号兜底单独放末尾，避免双胞胎
            full = os.path.join(official_path, name)
            try:
                with open(full, "rb") as fh:
                    url = "data:image/png;base64," + base64.b64encode(fh.read()).decode("ascii")
                size = os.path.getsize(full)
            except OSError:
                continue
            groups["official"].append({
                "key": key,
                "label": avatars.display_label(key),
                "url": url,
                "path": "",
                "size": size,
            })
        unknown_png = os.path.join(paths.data_dir("images", "fallback"), "unknown.png")
        if os.path.isfile(unknown_png):
            try:
                with open(unknown_png, "rb") as fh:
                    data = base64.b64encode(fh.read()).decode("ascii")
                groups["official"].append({
                    "key": "unknown",
                    "label": "未知人物",
                    "url": "data:image/png;base64," + data,
                    "path": "",
                    "size": os.path.getsize(unknown_png),
                })
            except OSError:
                pass

        # Mod 图标：只列**磁盘上真实安装**的 mod（缓存仅提供名称/图标，不能凭空造出幽灵项）
        try:
            installed = set(mods.installed_ids(self._game_dir() or ""))
            for mod_id, cached in mods.read_cache().items():
                if installed and mod_id not in installed:
                    continue
                icon = ""
                name = mod_id
                if isinstance(cached, dict):
                    icon = cached.get("icon") or ""
                    name = cached.get("name") or mod_id
                if icon:
                    if icon.startswith("data:"):
                        payload = icon.split(",", 1)[1]
                        size = (len(payload) * 3) // 4 - payload.count("=", -2)
                    else:
                        # 旧缓存存的是相对路径（images/modicons/x.png）→ 转 dataURL
                        try:
                            with open(paths.data_dir(*icon.split("/")), "rb") as fh:
                                raw = fh.read()
                            icon = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
                            size = len(raw)
                        except OSError:
                            continue
                    groups["modicons"].append({
                        "key": mod_id,
                        "label": name,
                        "url": icon,
                        "path": "",
                        "size": size,
                    })
        except Exception:  # noqa: BLE001
            pass

        scan_dirs = (
            ("fallback", paths.data_dir("images", "fallback"), "images/fallback"),
        )
        for group, directory, rel in scan_dirs:
            try:
                for name in sorted(os.listdir(directory)):
                    if not name.endswith(".png"):
                        continue
                    full = os.path.join(directory, name)
                    with open(full, "rb") as fh:
                        raw = fh.read()
                    groups[group].append({
                        "key": os.path.splitext(name)[0],
                        "url": "data:image/png;base64," + base64.b64encode(raw).decode("ascii"),
                        "path": f"{rel}/{name}",
                        "size": len(raw),
                    })
            except OSError:
                continue
        # 兜底组空时尝试生成一份（三级链：文件→官方→网络），再扫一次
        if not groups["fallback"]:
            try:
                from ..core import fallback

                fallback.ensure_unknown(self._game_dir())
                directory = paths.data_dir("images", "fallback")
                for name in sorted(os.listdir(directory)):
                    if not name.endswith(".png"):
                        continue
                    full = os.path.join(directory, name)
                    with open(full, "rb") as fh:
                        raw = fh.read()
                    groups["fallback"].append({
                        "key": os.path.splitext(name)[0],
                        "label": "未知人物" if os.path.splitext(name)[0] == "unknown" else os.path.splitext(name)[0],
                        "url": "data:image/png;base64," + base64.b64encode(raw).decode("ascii"),
                        "path": f"images/fallback/{name}",
                        "size": len(raw),
                    })
            except Exception:  # noqa: BLE001 - 兜底失败回落首字母
                pass
        total = sum(item["size"] for items in groups.values() for item in items)
        return {**groups, "cache_count": sum(len(v) for v in groups.values()),
                "cache_bytes": total}

    @guard
    def avatar_pick_image(self):
        """系统文件框选一张 PNG，返回路径与默认名（不落盘，由 avatar_upload 收口）。"""
        window = self._host.window if self._host else None
        if window is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境不支持文件选择框")
        try:
            picked = window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("PNG 图片 (*.png)",),
            )
        except Exception as exc:  # noqa: BLE001
            raise DsError(ErrorCode.IO, "无法打开文件选择框", {"detail": str(exc)})
        if not picked:
            return {"picked": ""}
        source = picked[0] if isinstance(picked, (list, tuple)) else picked
        default_name = os.path.splitext(os.path.basename(str(source)))[0]
        return {"picked": str(source), "name": default_name}

    @guard
    def avatar_set_name(self, char, name):
        """给角色（含它的上传层）设置显示名；空串回落内置中文名。"""
        avatars.set_display_name(str(char), str(name))
        return {"ok": True, "char": str(char), "label": avatars.display_label(str(char))}

    @guard
    def avatar_upload_asset(self, source_path, name=""):
        """上传一张头像素材到图片库（不绑定角色），显示名可之后重命名。"""
        return avatars.upload_asset(str(source_path), str(name))

    @guard
    def avatar_rename_asset(self, key, name):
        """重命名上传版素材。"""
        return avatars.rename_asset(str(key), str(name))

    @guard
    def avatar_upload_asset(self, source_path, name=""):
        """上传一张头像素材到图片库（不绑定角色），显示名可之后重命名。"""
        return avatars.upload_asset(str(source_path), str(name))

    @guard
    def avatar_rename_asset(self, key, name):
        """重命名上传版素材。"""
        return avatars.rename_asset(str(key), str(name))

    @guard
    def avatar_upload(self, char, source_path, display_name=""):
        """把选中的 PNG 落盘为角色上传层头像，display_name 作为列表显示名。"""
        safe = avatars._norm_char(str(char))
        if not safe:
            raise DsError(ErrorCode.BAD_ARGS, "角色名不合法")
        source = str(source_path or "")
        if not source or not os.path.isfile(source):
            raise DsError(ErrorCode.BAD_ARGS, "请先选择图片文件")
        try:
            from PIL import Image

            with Image.open(source) as image:
                image.verify()  # 只验真伪，不动原文件
        except Exception as exc:  # noqa: BLE001
            raise DsError(ErrorCode.BAD_ARGS, "不是有效的 PNG 图片", {"detail": str(exc)})
        target_dir = avatars.uploads_dir()
        os.makedirs(target_dir, exist_ok=True)
        shutil.copyfile(source, os.path.join(target_dir, f"{safe}.png"))
        avatars.set_display_name(safe, str(display_name or "").strip())
        return {"uploaded": True, "char": safe, "source": "upload"}

    @guard
    def avatar_set_source(self, char, source):
        """per 角色指定显示层（upload/official/mod/auto）。"""
        return avatars.set_source(str(char), str(source))

    def _delete_one(self, category, key, source=None):
        """删除单个 key 的底层实现（image_delete / image_delete_many 共用）。"""
        safe = str(key)
        if "/" in safe or "\\" in safe or safe.startswith("."):
            raise DsError(ErrorCode.BAD_ARGS, "key 不合法")
        if category == "avatars":
            return avatars.delete_cached(safe, str(source) if source else None)  # official 层内部拒绝
        if category == "fallback":
            raise DsError(ErrorCode.BAD_ARGS, "兜底素材不可删除，可删除后自动重建")
        if category == "modicons":
            # Mod 图标来自 mods 解析缓存（dataURL），删文件不够——必须清缓存并记忆
            cleared = mods.clear_icon(safe)
            full = os.path.join(paths.data_dir("images", "modicons"), f"{safe}.png")
            removed_file = False
            if os.path.isfile(full):
                try:
                    os.remove(full)
                    removed_file = True
                except OSError:
                    pass
            return {"deleted": bool(cleared or removed_file)}
        directories = {"modicons": paths.data_dir("images", "modicons")}
        if category not in directories:
            raise DsError(ErrorCode.BAD_ARGS, "未知分组")
        full = os.path.join(directories[category], f"{safe}.png")
        if not os.path.isfile(full):
            return {"deleted": False}
        try:
            os.remove(full)
            return {"deleted": True}
        except OSError:
            return {"deleted": False}

    @guard
    def image_delete(self, category, key, source=""):
        """删除图片库里的一份图；source 指定层（upload/mod），空则删全部可删层。"""
        return self._delete_one(category, key, str(source) if source else None)

    @guard
    def image_delete_many(self, category, keys):
        """批量删除（勾选后一次提交）：逐个删，返回成功数量与失败的 key。"""
        removed = 0
        failed: list[str] = []
        for key in list(keys or [])[:1000]:
            try:
                if self._delete_one(category, key).get("deleted"):
                    removed += 1
            except DsError:
                failed.append(str(key))
        return {"removed": removed, "failed": failed}

    @guard
    def modicon_preview(self, mod_id):
        """悬停预览：按需解出最大 256px 的原图（原图 <128px 返回空，前端按原生尺寸显示）。"""
        from ..core import mods

        return {"url": mods.icon_preview(str(mod_id), self._game_dir() or "")}

    @guard
    def modicons_scan(self):
        """重扫 Mod 图标：丢掉缓存里的 icon 再重新解一遍（只影响我们的缓存）。"""
        from ..core import mods

        result = mods.rescan_icons(self._game_dir() or "")
        return result

    @guard
    def reveal_dir(self, path):
        """资源管理器定位任意目录（候选存档目录跳转等）。"""
        target = str(path or "").strip()
        if not target or not os.path.isdir(target):
            raise DsError(ErrorCode.IO, "目录不存在", {"path": target})
        return {"opened": shell.reveal(target)}

    @guard
    def open_mod_folder(self, mod_id):
        """资源管理器打开某个 mod 的安装目录（仅 DS 单机版）。"""
        from ..core import mods

        target = mods.mod_dir(str(mod_id), self._game_dir() or "")
        if not target or not os.path.isdir(target):
            raise DsError(ErrorCode.IO, "没有找到这个 mod 的目录", {"id": str(mod_id)})
        return {"opened": shell.reveal(target)}

    @guard
    def open_url(self, url):
        """白名单放行已知站点（创意工坊 / B 站 / GitHub / 占位页），防任意 URL 注入。用默认浏览器打开。"""
        import re as _re

        allowed = (
            r"^https://steamcommunity\.com/sharedfiles/filedetails/\?id=\d+$",
            r"^https://space\.bilibili\.com/\d+/?$",
            r"^https://github\.com/[\w.-]+(/[\w.-]+)?/?$",
            r"^https://www\.baidu\.com/?$",
        )
        text = str(url).strip()
        if not any(_re.match(pattern, text) for pattern in allowed):
            raise DsError(ErrorCode.BAD_ARGS, "只允许打开创意工坊 / B 站 / GitHub 等已知链接")
        return {"opened": shell.open_url(text)}

    # ---------- 事件 ----------

    @guard
    def poll_events(self, since_seq=0):
        events, seq, lost_from = self._bus.drain(since_seq)
        return {"events": events, "seq": seq, "lost_from": lost_from}

    # ---------- 系统 ----------

    @guard
    def reveal_path(self, kind="backup_root", backup_id=None):
        if kind == "backup" and backup_id:
            _slot_id, backup_path = store.resolve_backup_id(self._session.backup_root(), backup_id)
            if not os.path.isdir(backup_path):
                raise DsError(ErrorCode.BACKUP_NOT_FOUND, "这份备份已经不在了")
            return {"opened": shell.reveal(backup_path)}
        if kind == "log_dir":
            target = paths.log_dir()
        elif kind == "save_dir":
            target = self._session.save_dir
        else:
            target = self._session.backup_root()
        if not target or not os.path.isdir(target):
            raise DsError(ErrorCode.IO, "目录不存在", {"path": target})
        return {"opened": shell.reveal(target)}

    @guard
    def window_action(self, action):
        if self._host is None:
            raise DsError(ErrorCode.NOT_SUPPORTED, "当前环境没有窗口")
        return {"handled": self._host.window_action(action)}

    @guard
    def quit_app(self):
        if self._host is not None:
            self._host.quit()
        return {"quitting": True}
