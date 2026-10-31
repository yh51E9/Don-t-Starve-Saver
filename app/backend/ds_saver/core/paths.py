# -*- coding: utf-8 -*-
r"""路径的唯一出口。

旧版把 APP_DIR 定义成 __file__ 所在目录，导致源码运行写 src/backups、
exe 运行写 exe 同级 backups，调试时"看不见备份"。这里统一成：
  - 冻结（PyInstaller）：exe 所在目录
  - 源码：项目根 app/

v5.3 布局（Don't Starve Saver）：
  <app_dir>\
    ├── 饥荒存档备份工具.exe / run.py
    ├── data\\\\              全部可写数据：config、缓存、备份
    │   └── backups\       备份根（可被用户改到别处）
    └── logs\              日志（与 data 同级，好找）
"""
import json
import os
import sys

from .. import APP_NAME


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> str:
    if is_frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    # core/paths.py -> ds_saver -> backend -> app
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "..", ".."))


def config_file() -> str:
    r"""运行配置归入 data\，与缓存同一居所。"""
    return os.path.join(data_dir(), "ds_saver_config.json")


def legacy_config_file() -> str:
    r"""v5.2 之前配置放在程序根（旧文件名 dst_saver_config.json），读取时自动迁移到 data\。"""
    return os.path.join(app_dir(), "dst_saver_config.json")


def migrate_config_filename() -> str:
    r"""一次性迁移旧配置文件名 dst_saver_config.json → ds_saver_config.json。

    旧文件可能在 data\（v5.3）或程序根（v5.2）；新文件已存在则不动（新值优先，
    旧文件保留当备份）。迁移失败回退返回旧路径，让调用方读旧文件不丢数据。幂等。
    """
    new = config_file()
    if os.path.isfile(new):
        return new
    for old in (
        os.path.join(data_dir(), "dst_saver_config.json"),
        legacy_config_file(),
    ):
        if os.path.isfile(old):
            try:
                os.makedirs(os.path.dirname(new), exist_ok=True)
                os.replace(old, new)
                return new
            except OSError:
                return old  # 迁移失败回退读旧文件，绝不丢设置
    return new


def default_backup_root() -> str:
    r"""备份根在 data\ 之下：备份也是数据，一起便携。"""
    return os.path.join(data_dir(), "backups")


def web_dir() -> str:
    """前端构建产物。冻结时由 PyInstaller 解到 _MEIPASS/web。"""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return os.path.join(meipass, "web")
    return os.path.join(app_dir(), "ui", "dist")


def assets_dir() -> str:
    """打包进 exe 的静态资源（应用图标等）。与 web_dir() 同款解析。"""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return os.path.join(meipass, "ds_saver", "assets")
    # core/paths.py -> ds_saver/assets
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "assets"))


def data_dir(*parts: str) -> str:
    r"""所有可写数据的唯一根：项目目录下的 data\。

    用户的规则：软件的任何存储都只能局限于项目目录。
    头像缓存 / WebView2 存储 / 备份全部收进来，便携式布局，
    整个项目目录拷走就是完整迁移。
    """
    base = os.path.join(app_dir(), "data")
    return os.path.join(base, *parts) if parts else base


def avatar_cache_dir() -> str:
    return os.path.join(data_dir(), "avatars")


def log_dir() -> str:
    r"""日志与 data\ 同级：运维时常翻，不想埋在数据堆里。"""
    return os.path.join(app_dir(), "logs")


def to_portable(path: str) -> str:
    r"""项目内部的路径存成相对形式（如 data/backups），随目录改名/搬家自动跟随；
    项目外的路径（存档目录、游戏目录）保持绝对原样。分隔符统一正斜杠。

    注意：已经是相对形式的输入直接原样返回——绝不能用 abspath 去解释它，
    abspath 会基于进程 cwd 随机落点（pytest/服务 cwd 不同就散了）。
    """
    if path and not os.path.isabs(path) and not (len(path) > 1 and path[1] == ":"):
        return path.replace("\\", "/")
    path = os.path.normpath(os.path.abspath(path))
    try:
        rel = os.path.relpath(path, app_dir())
    except ValueError:  # 跨盘符
        return path.replace("\\", "/")
    if rel.startswith(".."):
        return path.replace("\\", "/")
    return rel.replace("\\", "/")


def resolve_portable(path: str) -> str:
    r"""相对形式 → 基于 app_dir 的绝对路径；绝对原样返回。"""
    if not path:
        return path
    if os.path.isabs(path) or (len(path) > 1 and path[1] == ":"):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(app_dir(), *path.split("/")))


def migrate_legacy_layout(base: str | None = None, config_path: str | None = None) -> None:
    r"""一次性把旧布局迁到 v5.3 布局，全 best-effort。

    1. 旧备份根 <base>\backups → <base>\data\backups
    2. 旧日志 <base>\data\logs → <base>\logs
    3. 配置里指向已消失位置的 backup_root 修正到当前默认
    """
    base = base or app_dir()
    migrate_config_filename()  # 配置文件名迁移先行，否则下面读 config 会找不到旧名文件
    cfg_path = config_path or config_file()
    old_backups = os.path.join(base, "backups")
    new_backups = os.path.join(base, "data", "backups")
    try:
        if os.path.isdir(old_backups) and not os.path.isdir(new_backups):
            if not any(os.scandir(old_backups)):
                os.rmdir(old_backups)  # 空壳直接清掉
            else:
                os.makedirs(os.path.dirname(new_backups), exist_ok=True)
                os.replace(old_backups, new_backups)
    except OSError:
        pass

    old_logs = os.path.join(base, "data", "logs")
    new_logs = os.path.join(base, "logs")
    try:
        if os.path.isdir(old_logs) and not os.path.isdir(new_logs):
            os.makedirs(os.path.dirname(new_logs), exist_ok=True)
            os.replace(old_logs, new_logs)
    except OSError:
        pass

    # 配置里的 backup_root 若指向已消失的旧安装位置，改回当前默认
    if os.path.isfile(cfg_path):
        try:
            with open(cfg_path, encoding="utf-8") as fh:
                cfg = json.load(fh)
            backup_root = cfg.get("backup_root")
            if backup_root and not os.path.isdir(backup_root):
                cfg["backup_root"] = "data/backups"  # 相对形式，随项目走
                with open(cfg_path, "w", encoding="utf-8") as fh:
                    json.dump(cfg, fh, ensure_ascii=False, indent=2)
        except (OSError, ValueError):
            pass


def ensure_dir(path: str) -> str:
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path
