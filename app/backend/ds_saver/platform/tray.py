# -*- coding: utf-8 -*-
"""托盘：pystray + Pillow 运行时画图标（不打包图片资源）。

菜单回调在 pystray 自己的线程里，只能调 window.show()/hide() 和置标志，
销毁窗口统一走 apphost.quit() 这条路径。
"""
import logging

import pystray
from PIL import Image

from .icons import load_icon

log = logging.getLogger(__name__)


def _make_image() -> Image.Image:
    """托盘用 64px 图标，与 exe 同源（assets/icon.png）。"""
    return load_icon(64)


class Tray:
    def __init__(self, on_show, on_hide, on_backup, on_toggle_auto, on_quit, is_auto_on):
        self._on_show = on_show
        self._on_hide = on_hide
        self._on_backup = on_backup
        self._on_toggle_auto = on_toggle_auto
        self._on_quit = on_quit
        self._is_auto_on = is_auto_on
        self._icon: pystray.Icon | None = None

    def start(self) -> None:
        if self._icon is not None:
            return
        menu = pystray.Menu(
            pystray.MenuItem("显示主窗口", lambda *_: self._on_show(), default=True),
            pystray.MenuItem("立即备份当前世界", lambda *_: self._on_backup()),
            pystray.MenuItem("自动备份", lambda *_: self._on_toggle_auto(),
                             checked=lambda _item: bool(self._is_auto_on())),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("隐藏到托盘", lambda *_: self._on_hide()),
            pystray.MenuItem("退出", lambda *_: self._on_quit()),
        )
        self._icon = pystray.Icon("ds-saver", _make_image(), "饥荒存档备份工具", menu=menu)
        try:
            self._icon.run_detached()
        except Exception:
            log.exception("tray start failed")
            self._icon = None

    def stop(self) -> None:
        if self._icon is None:
            return
        try:
            self._icon.stop()
        except Exception:
            pass
        self._icon = None

    def refresh(self) -> None:
        if self._icon is None:
            return
        try:
            self._icon.update_menu()
        except Exception:
            pass
