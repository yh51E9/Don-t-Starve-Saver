# -*- coding: utf-8 -*-
"""应用外壳：建窗口、装托盘、管关闭三态、染标题栏。

这里是唯一同时看到 api 层和 platform 层的地方。
"""
import logging
import os
import shutil
import threading

import webview

from . import WINDOW_TITLE, __version__
from .api.js_api import JsApi
from .core import paths
from .platform import palette, win32
from .platform.tray import Tray
from .services.eventbus import EventBus
from .services.jobs import JobRunner
from .services.session import Session
from .services.watcher import Watcher

log = logging.getLogger(__name__)

WINDOW_W = 1240  # 与 ui/src/theme/layout.ts 同步
WINDOW_H = 840
SETTINGS_W = 980
SETTINGS_H = 720


class AppHost:
    def __init__(self, dev_url: str | None = None, debug: bool = False, no_tray: bool = False):
        self.bus = EventBus()
        self.session = Session(self.bus)
        self.runner = JobRunner(self.bus, self.session)
        self.watcher = Watcher(self.session, self.runner, self.bus)
        self.api = JsApi(self.session, self.runner, self.bus, host=self)

        self.dev_url = dev_url
        self.debug = debug
        self.no_tray = no_tray

        self.window = None
        self._settings_window = None
        self._settings_hwnd = 0
        self._settings_close_pending = False
        self._settings_force_close = False
        self.titlebar_dark = False
        self.chrome = {"dark": False, "caption": False, "text": False, "border": False}
        self.current_scheme = "dark"
        self._hwnd = 0
        self._force_quit = False
        self._stop = threading.Event()
        self._tray: Tray | None = None
        self._storage = paths.data_dir("webview")

    # ---------- 启动 ----------

    def run(self) -> None:
        if not win32.single_instance():
            win32.focus_window(WINDOW_TITLE)
            return

        self.runner.start()
        self.watcher.start()
        try:
            # 备份目录与数据目录一开始就建出来，用户点「打开备份目录/日志」不会报"目录不存在"
            os.makedirs(self.session.backup_root(), exist_ok=True)
            os.makedirs(paths.data_dir(), exist_ok=True)
        except OSError:
            pass
        self._create_window()
        threading.Thread(target=self._scheme_loop, name="ds-scheme", daemon=True).start()
        self._purge_stale_web_cache()
        try:
            webview.start(self._post_start, debug=self.debug, http_server=True,
                          private_mode=False, storage_path=self._storage)
        finally:
            self.shutdown()

    def _purge_stale_web_cache(self) -> None:
        """构建产物变更时清 WebView2 的 HTTP 缓存。

        WebView2 持久化配置目录会缓存 index.html 与旧 JS——不清理会出现
        "后端已是新版、前端还是旧界面"（改了文案/样式重启却看不到）。
        只删缓存目录，保留 Local Storage（列宽/主题/偏好等用户设置）。
        """
        if self.dev_url:
            return
        index = os.path.join(paths.web_dir(), "index.html")
        try:
            stamp = f"{__version__}:{int(os.path.getmtime(index))}"
        except OSError:
            return
        marker = os.path.join(self._storage, ".ui_stamp")
        try:
            with open(marker, encoding="utf-8") as fh:
                if fh.read().strip() == stamp:
                    return
        except OSError:
            pass
        profile = os.path.join(self._storage, "EBWebView", "Default")
        for sub in ("Cache", "Code Cache", "GPUCache", "Service Worker"):
            shutil.rmtree(os.path.join(profile, sub), ignore_errors=True)
        try:
            os.makedirs(self._storage, exist_ok=True)
            with open(marker, "w", encoding="utf-8") as fh:
                fh.write(stamp)
        except OSError:
            log.debug("写入 UI 版本标记失败", exc_info=True)

    def _resolve_url(self, query: str = "") -> str:
        url = self.dev_url
        if not url:
            index = os.path.join(paths.web_dir(), "index.html")
            if not os.path.isfile(index):
                self._fatal(f"前端资源缺失：\n{index}\n\n请先执行 npm run build，或重新安装。")
                raise SystemExit(1)
            url = index
        return f"{url}{query}" if query else url

    def _window_background(self) -> str:
        """首帧背景用当前主题的底色，杀掉暗色模式下的白板闪烁。"""
        try:
            scheme = self.resolve_scheme()
            preset = self.session.cfg.get("theme_preset", palette.DEFAULT_PRESET)
            background, _text = palette.chrome_colors(preset, scheme)
            return background
        except Exception:
            return "#1D1F22"

    def _create_window(self) -> None:
        self.window = webview.create_window(
            WINDOW_TITLE,
            url=self._resolve_url(),
            width=WINDOW_W,
            height=WINDOW_H,
            x=self._center_x(),
            y=self._center_y(),
            min_size=(1100, 760),
            resizable=True,
            js_api=self.api,
            text_select=False,
            background_color=self._window_background(),
        )
        self.window.events.shown += self._on_shown
        self.window.events.closing += self._on_closing

    # ---------- 设置独立窗口 ----------

    def open_settings(self) -> None:
        """js_api 线程里调用（非主线程），create_window 才不会卡死主线程。"""
        self._settings_force_close = False  # 上次关闭的放行标志不能带进新窗口
        if self._settings_window is not None:
            try:
                self._settings_window.show()
                self._settings_window.restore()
                # 已开窗也要同步一次明暗（配置可能在窗隐藏期间被改过）
                self.apply_theme_from_config()
                return
            except Exception:
                self._settings_window = None
        left, top, right, bottom = win32.work_area()
        # 主题随 URL 带过去：设置窗首帧就是正确的明暗/配色，不用先闪一下默认暗色
        scheme = self.resolve_scheme()
        preset = self.session.cfg.get("theme_preset", palette.DEFAULT_PRESET)
        self._settings_window = webview.create_window(
            f"{WINDOW_TITLE} · 设置",
            url=self._resolve_url(f"?window=settings&preset={preset}&scheme={scheme}"),
            width=SETTINGS_W,
            height=SETTINGS_H,
            x=left + max(0, (right - left - SETTINGS_W) // 2),
            y=top + max(0, (bottom - top - SETTINGS_H) // 2 - 12),
            min_size=(880, 620),
            resizable=True,
            js_api=self.api,
            text_select=False,
            background_color=self._window_background(),
        )
        self._settings_window.events.shown += self._on_settings_shown
        self._settings_window.events.closing += self._on_settings_closing
        # 注意：新窗的明暗靠 bootstrap.platform.scheme 随 boot 数据带来；
        # 这里不能 emit color_scheme——新 poller 会从 0 重放全部历史事件（闪退教训）

    def close_settings(self) -> None:
        self._settings_close_pending = False
        if self._settings_window is None:
            return
        self._settings_force_close = True  # 放行 closing 事件，否则 destroy 被自己取消
        try:
            self._settings_window.destroy()
        except Exception:
            pass
        self._settings_window = None
        self._settings_hwnd = 0

    def _on_settings_shown(self) -> None:
        threading.Timer(0.15, self._settings_late_init).start()

    def _settings_late_init(self) -> None:
        if self._settings_window is None:
            return
        try:
            self._settings_hwnd = win32.window_handle(self._settings_window)
            scheme = self.current_scheme
            preset = self.session.cfg.get("theme_preset", palette.DEFAULT_PRESET)
            background, text = palette.chrome_colors(preset, scheme)
            win32.apply_chrome(self._settings_hwnd, scheme, background, text)
            for delay in (0.6, 1.8):  # 同主窗：WebView2 就绪后会重绘，补应用
                threading.Timer(
                    delay,
                    lambda: win32.apply_chrome(
                        self._settings_hwnd, self.current_scheme,
                        *palette.chrome_colors(
                            self.session.cfg.get("theme_preset", palette.DEFAULT_PRESET),
                            self.current_scheme)),
                ).start()
        except Exception:
            log.exception("settings window init failed")

    def _on_settings_closing(self) -> bool:
        # close_settings() 主动销毁时置位：必须放行，否则 destroy 会被这里取消
        # （pywebview 的 destroy 内部走 Form.Close，同样触发 closing 事件）
        if self._force_quit or self._settings_force_close:
            return True
        self._settings_close_pending = True
        self.bus.emit("shell.settings_close_requested")

        def push() -> None:
            # 千万不能在本回调线程里 evaluate_js——它会等窗口 JS 循环，
            # 而 JS 循环正被关闭流程占着，同线程等自己 = 直接未响应。
            # 双重守卫：force_close（用户/超时已放行销毁）或窗口已清 → 不再碰 WebView2，
            # 否则与 destroy() 赛跑会抛 ObjectDisposedException（在 UI 线程，这里抓不住）。
            if self._settings_force_close or self._settings_window is None:
                return
            try:
                self._settings_window.evaluate_js(
                    "window.dispatchEvent(new CustomEvent('ds:settings_close_requested'))")
            except Exception as exc:  # noqa: BLE001 - 竞态兜底：窗口恰在销毁
                log.debug("close signal to a dying settings window: %s", exc)

        threading.Thread(target=push, name="ds-close-signal", daemon=True).start()
        # 前端 2.5 秒内没 ack（弹了确认框）也没关窗——兜底强关，别把用户晾着
        threading.Timer(2.5, self._settings_close_timeout).start()
        return False

    def _settings_close_timeout(self) -> None:
        if self._settings_close_pending and self._settings_window is not None:
            log.warning("settings close not acked in 2.5s, forcing close")
            self.close_settings()

    def ack_settings_close(self) -> bool:
        """前端收到信号并处理（弹确认框/开始关窗）时调用，取消兜底强关。"""
        self._settings_close_pending = False
        return True

    def _center_x(self) -> int:
        left, _top, right, _bottom = win32.work_area()
        return left + max(0, (right - left - WINDOW_W) // 2)

    def _center_y(self) -> int:
        _left, top, _right, bottom = win32.work_area()
        return top + max(0, (bottom - top - WINDOW_H) // 2 - 16)

    def _post_start(self, *_args) -> None:
        if not self.no_tray:
            self._tray = Tray(
                on_show=self.show_window,
                on_hide=self.hide_window,
                on_backup=self.backup_current,
                on_toggle_auto=self.toggle_auto,
                on_quit=self.quit,
                is_auto_on=lambda: self.session.auto_on,
            )
            self._tray.start()

    def _on_shown(self) -> None:
        threading.Timer(0.15, self._late_init).start()

    def _late_init(self) -> None:
        self._hwnd = win32.window_handle(self.window)
        log.info("hwnd = %s", self._hwnd)
        self.apply_theme_from_config()
        # WebView2 初始化完成时会重绘标题栏、把 DWM 暗色打回白色——分多次补应用
        for delay in (0.6, 1.8):
            threading.Timer(delay, self.apply_theme_from_config).start()

    @staticmethod
    def _fatal(message: str) -> None:
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, message, "饥荒存档备份工具", 0x10)
        except Exception:
            log.error(message)

    # ---------- 主题 ----------

    def system_scheme(self) -> str:
        """系统当前明暗（与配置无关）——设置页选"跟随系统"时要的是这个。"""
        return "dark" if win32.is_system_dark() else "light"

    def resolve_scheme(self) -> str:
        mode = self.session.cfg.get("theme_mode", "auto")
        if mode in ("dark", "light"):
            return mode
        return "dark" if win32.is_system_dark() else "light"

    def preview_chrome(self, preset: str, scheme: str) -> None:
        """设置页预览专用：只刷两扇窗的标题栏颜色，不写配置、不改 current_scheme。

        主题/明暗预览时主窗标题栏必须同步，否则内容换了皮、顶栏还是旧的。
        """
        background, text = palette.chrome_colors(preset, scheme)
        self.chrome = win32.apply_chrome(self._hwnd, scheme, background, text)
        if self._settings_hwnd:
            win32.apply_chrome(self._settings_hwnd, scheme, background, text)
        self.titlebar_dark = bool(self.chrome.get("dark"))

    def apply_theme_from_config(self) -> None:
        scheme = self.resolve_scheme()
        preset = self.session.cfg.get("theme_preset", palette.DEFAULT_PRESET)
        background, text = palette.chrome_colors(preset, scheme)
        self.current_scheme = scheme
        self.chrome = win32.apply_chrome(self._hwnd, scheme, background, text)
        if self._settings_hwnd:
            win32.apply_chrome(self._settings_hwnd, scheme, background, text)
        self.titlebar_dark = bool(self.chrome.get("dark"))
        self.bus.emit("shell.color_scheme", scheme=scheme, preset=preset)

    def _scheme_loop(self) -> None:
        while not self._stop.wait(3.0):
            if self.session.cfg.get("theme_mode", "auto") != "auto":
                continue
            scheme = "dark" if win32.is_system_dark() else "light"
            if scheme != self.current_scheme:
                self.apply_theme_from_config()

    # ---------- 关闭 ----------

    def _on_closing(self) -> bool:
        if self._force_quit:
            return True
        action = self.session.cfg.get("close_action", "tray")
        if action == "exit":
            self._force_quit = True
            return True
        if action == "tray":
            try:
                self.window.hide()
            except Exception:
                pass
            return False
        # 从任务栏 / 最小化状态点叉时，先把自己拉到前台：
        # 否则确认弹窗藏在窗口后面，用户会以为"点了关不掉"（托盘退出不走这里）
        try:
            self.window.show()
            self.window.restore()
            win32.focus_window(WINDOW_TITLE)
        except Exception:
            pass
        # 从任务栏 / 最小化状态点叉时，先把自己拉到前台：
        # 否则确认弹窗藏在窗口后面，用户会以为"点了关不掉"（托盘退出不走这里）
        try:
            self.window.show()
            self.window.restore()
            win32.focus_window(WINDOW_TITLE)
        except Exception:
            pass
        self.bus.emit("shell.close_requested")
        return False

    def window_action(self, action: str) -> bool:
        if self.window is None:
            return False
        try:
            if action == "minimize":
                self.window.minimize()
            elif action == "hide":
                self.hide_window()
            elif action in ("close", "quit"):
                self.quit()
            else:
                return False
            return True
        except Exception:
            log.exception("window_action(%s) failed", action)
            return False

    def show_window(self) -> None:
        try:
            self.window.show()
            self.window.restore()
            self.apply_theme_from_config()
        except Exception:
            pass

    def hide_window(self) -> None:
        try:
            self.window.hide()
        except Exception:
            pass

    # ---------- 托盘动作 ----------

    def backup_current(self) -> None:
        world = self.session.selected_world()
        if world is None:
            return
        self.runner.submit("backup", slot_id=world["id"], tag="manual")

    def toggle_auto(self) -> None:
        self.session.set_auto(not self.session.auto_on)
        if self._tray:
            self._tray.refresh()

    def quit(self) -> None:
        self._force_quit = True
        self.close_settings()
        try:
            self.window.destroy()
        except Exception:
            pass

    def shutdown(self) -> None:
        self._stop.set()
        self.watcher.stop()
        self.runner.stop()
        if self._tray:
            self._tray.stop()
            self._tray = None
        log.info("shutdown (version %s)", __version__)
