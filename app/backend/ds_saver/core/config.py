# -*- coding: utf-8 -*-
"""配置：单一默认值来源 + 原子写 + 字段校验 + 旧版迁移。

旧版的三个问题：
  1. 默认值散落在 UI 调用点，换个界面就漏一个
  2. `open(path, "w")` 直接写，断电会留下半截 JSON
  3. 解析失败静默返回 {}，等于"设置全部悄悄清空"
"""
import json
import os
import time

from . import paths
from .errors import DsError, ErrorCode

DEFAULTS = {
    "config_version": 3,
    "theme_mode": "auto",
    "theme_preset": "nightfall",
    "font_size": 17,
    "backup_root": "",
    "excluded_candidates": [],
    "keep": 10,
    "keep_auto": 5,
    "keep_mode": "count",
    "keep_days_manual": 0,
    "keep_days_auto": 0,
    "auto_backup": True,
    "auto_mode": "change",
    "auto_interval_min": 30,
    "auto_min_gap_min": 5,
    "auto_only_when_running": False,
    "close_action": "ask",
    "save_dir": "",
    "game_dir": "",
}

OPTIONS = {
    "auto_mode": [
        {"value": "change", "label": "变化时", "hint": "存档写完就快照"},
        {"value": "interval", "label": "固定间隔", "hint": "每隔 N 分钟一份"},
        {"value": "both", "label": "两者", "hint": "变化时 + 固定间隔"},
    ],
    "keep_mode": [
        {"value": "count", "label": "按份数", "hint": "只看保留几份"},
        {"value": "days", "label": "按天数", "hint": "超龄且超份数才删"},
    ],
    "theme_mode": [
        {"value": "auto", "label": "跟随系统"},
        {"value": "dark", "label": "暗色"},
        {"value": "light", "label": "亮色"},
    ],
    "theme_preset": [
        {"value": "nightfall", "label": "夜航", "hint": "冷灰石墨 · 月光青"},
        {"value": "ledger", "label": "野外手账", "hint": "暖炭纸白 · 发丝线"},
        {"value": "brass", "label": "暗铜机械", "hint": "墨绿黑 · 黄铜"},
    ],
    "font_size": [
        {"value": 15, "label": "小"},
        {"value": 16, "label": "偏小"},
        {"value": 17, "label": "标准"},
        {"value": 18, "label": "偏大"},
        {"value": 19, "label": "大"},
    ],
    "close_action": [
        {"value": "ask", "label": "每次询问"},
        {"value": "tray", "label": "隐藏到托盘"},
        {"value": "exit", "label": "直接退出"},
    ],
}

THEME_MODES = {item["value"] for item in OPTIONS["theme_mode"]}
THEME_PRESETS = {item["value"] for item in OPTIONS["theme_preset"]}
FONT_SIZES = {item["value"] for item in OPTIONS["font_size"]}
# 历史：v5.0 三档 14/16/18 → v5.4 曾把 14 迁到 15。自定义 14-22 开放后 14 是合法值，
# 且 v5.0 的 14 本就是 14px，保留原值更符合老配置本意，迁移表已移除（见 test_config）。
CLOSE_ACTIONS = {item["value"] for item in OPTIONS["close_action"]}
AUTO_MODES = {item["value"] for item in OPTIONS["auto_mode"]}
KEEP_MODES = {item["value"] for item in OPTIONS["keep_mode"]}

# 旧版四套强调色 → 三套主题。plum 和 azure 都属冷调，一起并到夜航
ACCENT_MIGRATION = {
    "ember": "ledger",
    "azure": "nightfall",
    "moss": "brass",
    "plum": "nightfall",
}

LEGACY_BACKUP_ROOT = os.path.join(os.path.expanduser("~"), "Documents", "Klei", "DST-Saver-Backups")


def _as_int(value, default, low=None, high=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    if low is not None and number < low:
        number = low
    if high is not None and number > high:
        number = high
    return number


def normalize(raw: dict | None) -> dict:
    """把任意来源的配置洗成合法配置。不抛异常。"""
    raw = raw if isinstance(raw, dict) else {}
    cfg = dict(DEFAULTS)

    if raw.get("theme_mode") in THEME_MODES:
        cfg["theme_mode"] = raw["theme_mode"]
    if raw.get("theme_preset") in THEME_PRESETS:
        cfg["theme_preset"] = raw["theme_preset"]
    raw_font = raw.get("font_size")
    if raw_font in FONT_SIZES:
        cfg["font_size"] = raw_font
    elif isinstance(raw_font, int) and 14 <= raw_font <= 22:
        cfg["font_size"] = raw_font  # 自定义字号（14-22px）
    if raw.get("close_action") in CLOSE_ACTIONS:
        cfg["close_action"] = raw["close_action"]

    # 旧配置迁移：accent → theme_preset，迁移完不再保留 accent
    accent = raw.get("accent")
    if "theme_preset" not in raw and accent in ACCENT_MIGRATION:
        cfg["theme_preset"] = ACCENT_MIGRATION[accent]

    for key, default in (("keep", 10), ("keep_auto", 5)):
        # 0 在新语义里表示"清空该组"，绝不能从配置里读出来，否则升级即删光
        cfg[key] = _as_int(raw.get(key), default, low=1, high=999)

    # 备份保留策略：count=按份数；days=超龄且超份数的交集才删（保守）
    if raw.get("keep_mode") in KEEP_MODES:
        cfg["keep_mode"] = raw["keep_mode"]
    # 天数 0 = 不限，所以 low=0 合法
    cfg["keep_days_manual"] = _as_int(raw.get("keep_days_manual"), 0, low=0, high=3650)
    cfg["keep_days_auto"] = _as_int(raw.get("keep_days_auto"), 0, low=0, high=3650)

    # 自动备份触发策略
    if raw.get("auto_mode") in AUTO_MODES:
        cfg["auto_mode"] = raw["auto_mode"]
    cfg["auto_interval_min"] = _as_int(raw.get("auto_interval_min"), 30, low=1, high=1440)
    cfg["auto_min_gap_min"] = _as_int(raw.get("auto_min_gap_min"), 5, low=1, high=720)
    cfg["auto_only_when_running"] = bool(raw.get("auto_only_when_running", False))

    root = raw.get("backup_root")
    if isinstance(root, str) and root.strip():
        # 项目内目录存相对形式（data/backups），随目录改名/搬家自动跟随
        cfg["backup_root"] = paths.to_portable(root.strip())
    if os.path.normcase(paths.resolve_portable(cfg["backup_root"])) == os.path.normcase(LEGACY_BACKUP_ROOT):
        cfg["backup_root"] = ""  # 旧版默认位置，迁到程序目录
    if not cfg["backup_root"]:
        cfg["backup_root"] = paths.to_portable(paths.default_backup_root())

    save_dir = raw.get("save_dir")
    cfg["save_dir"] = save_dir.strip() if isinstance(save_dir, str) else ""
    game_dir = raw.get("game_dir")
    cfg["game_dir"] = game_dir.strip() if isinstance(game_dir, str) else ""
    # 持久排除的候选存档目录（弹窗里"不再显示"）；脏输入一律洗成 []
    excluded = raw.get("excluded_candidates")
    cfg["excluded_candidates"] = (
        [p.strip() for p in excluded if isinstance(p, str) and p.strip()]
        if isinstance(excluded, list) else []
    )
    cfg["auto_backup"] = bool(raw.get("auto_backup", DEFAULTS["auto_backup"]))
    cfg["config_version"] = DEFAULTS["config_version"]
    return cfg


def load() -> tuple[dict, list[str]]:
    """返回 (配置, 警告码列表)。文件坏掉时备份原文件并用默认值启动。"""
    # migrate_config_filename 覆盖旧文件名 dst_saver_config.json（data\ 或 v5.2 程序根）
    path = paths.migrate_config_filename()
    if not os.path.isfile(path):
        return normalize(None), []

    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            raise ValueError("配置根节点不是对象")
        return normalize(raw), []
    except (OSError, ValueError, json.JSONDecodeError):
        stamp = time.strftime("%Y%m%d_%H%M%S")
        try:
            os.replace(path, f"{path}.bak-{stamp}")
        except OSError:
            pass
        return normalize(None), [ErrorCode.CONFIG]


def save(cfg: dict) -> dict:
    """原子写：同目录 tmp + os.replace。返回落盘后的配置。"""
    data = normalize(cfg)
    path = paths.config_file()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return data


def update(patch: dict) -> dict:
    """读改写一步到位。patch 里只放要改的键。"""
    current, _ = load()
    merged = dict(current)
    merged.update(patch or {})
    return save(merged)


def require_save_dir(path: str) -> str:
    """校验一个目录能不能当存档目录用。"""
    if not isinstance(path, str) or not path.strip():
        raise DsError(ErrorCode.BAD_ARGS, "存档目录不能为空")
    path = os.path.normpath(path.strip())
    if not os.path.isdir(path):
        raise DsError(ErrorCode.SAVE_DIR_INVALID, "目录不存在", {"path": path})
    if not os.path.isfile(os.path.join(path, "saveindex")):
        raise DsError(ErrorCode.SAVE_DIR_INVALID, "这个目录里没有 saveindex，不像是饥荒存档目录",
                       {"path": path})
    return path
