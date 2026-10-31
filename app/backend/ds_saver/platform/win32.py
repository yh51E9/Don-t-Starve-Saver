# -*- coding: utf-8 -*-
"""Win32 / DWM 的一点点能力：HWND、暗色标题栏、单实例、系统深浅色。

全部允许失败：拿不到 HWND 就只是标题栏不跟随主题，绝不影响主流程。
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi
kernel32 = ctypes.windll.kernel32

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36

ERROR_ALREADY_EXISTS = 183

_mutex_handle = None
_mutex_handle_legacy = None


def windows_build() -> int:
    try:
        return int(sys.getwindowsversion().build)
    except Exception:
        return 0


def webview2_version() -> str:
    try:
        import winreg

        for hive, key in (
            (winreg.HKEY_LOCAL_MACHINE,
             r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
            (winreg.HKEY_CURRENT_USER,
             r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"),
        ):
            try:
                with winreg.OpenKey(hive, key) as handle:
                    value, _ = winreg.QueryValueEx(handle, "pv")
                    if value:
                        return str(value)
            except OSError:
                pass
    except Exception:
        pass
    return ""


def is_system_dark() -> bool:
    """跟随系统：读 App 主题（不是 System 主题，标题栏跟的是 App）。"""
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        ) as handle:
            value, _ = winreg.QueryValueEx(handle, "AppsUseLightTheme")
            return int(value) == 0
    except Exception:
        return True


def colorref(hex_color: str) -> int:
    """#RRGGBB → 0x00BBGGRR（Windows 是反的）。"""
    value = hex_color.lstrip("#")
    red, green, blue = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    return (blue << 16) | (green << 8) | red


def _dwm_int(hwnd: int, attribute: int, value: int) -> bool:
    try:
        raw = ctypes.c_int(value)
        result = dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(hwnd), attribute, ctypes.byref(raw), ctypes.sizeof(raw))
        return result == 0
    except Exception:
        return False


def window_handle(window) -> int:
    """优先 native.Handle（IntPtr 必须 ToInt64），失败再按 PID + 窗类枚举。"""
    try:
        handle = window.native.Handle
        return int(handle.ToInt64() if hasattr(handle, "ToInt64") else handle)
    except Exception:
        pass
    return _enum_forms_window()


def _enum_forms_window() -> int:
    best = [0, 0]

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _lparam):
        pid = ctypes.c_uint()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != os.getpid():
            return True
        if not user32.IsWindowVisible(hwnd):
            return True
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if not name.value.startswith("WindowsForms10.Window."):
            return True
        rect = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        area = (rect.right - rect.left) * (rect.bottom - rect.top)
        if area > best[1]:
            best[0], best[1] = int(hwnd), area
        return True

    user32.EnumWindows(each, None)
    return best[0]


def apply_chrome(hwnd: int, scheme: str, background: str, text: str) -> dict:
    """把系统标题栏染成界面底色。逐属性返回，设置页可以显示哪一项没生效。"""
    result = {"dark": False, "caption": False, "text": False, "border": False}
    if not hwnd:
        return result
    dark = 1 if scheme == "dark" else 0
    result["dark"] = _dwm_int(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, dark)
    if windows_build() >= 22000:
        # Win11 22H2+：标题栏、文字、边框都能精确指定，窗口"溶解"进界面
        result["caption"] = _dwm_int(hwnd, DWMWA_CAPTION_COLOR, colorref(background))
        result["text"] = _dwm_int(hwnd, DWMWA_TEXT_COLOR, colorref(text))
        result["border"] = _dwm_int(hwnd, DWMWA_BORDER_COLOR, colorref(background))
    return result


def work_area() -> tuple[int, int, int, int]:
    """不含任务栏的工作区。SPI_GETWORKAREA = 0x0030。"""
    try:
        rect = wt.RECT()
        user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0)
        return rect.left, rect.top, rect.right, rect.bottom
    except Exception:
        return 0, 0, 1920, 1080


def single_instance(name: str = r"Local\ds-saver-v5") -> bool:
    """True = 第一个实例。句柄必须保持引用，否则互斥体立刻释放。

    同时占新名 ds-saver-v5 与旧名 dst-saver-v5：升级瞬间新旧版本双向互斥
    （旧版跑着时新版被旧名挡住，反之亦然）。旧名留一个大版本后再清理。
    """
    global _mutex_handle, _mutex_handle_legacy
    first = True
    try:
        _mutex_handle = kernel32.CreateMutexW(None, False, name)
        if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            first = False
    except Exception:
        pass
    try:  # 旧版互斥体名，挡住/被挡旧版本
        _mutex_handle_legacy = kernel32.CreateMutexW(None, False, r"Local\dst-saver-v5")
        if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            first = False
    except Exception:
        pass
    return first


def focus_window(title: str) -> bool:
    try:
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return False
        user32.ShowWindow(ctypes.c_void_p(hwnd), 9)  # SW_RESTORE
        user32.SetForegroundWindow(ctypes.c_void_p(hwnd))
        return True
    except Exception:
        return False


# ---------------- 进程枚举（游戏运行检测） ----------------

_TH32CS_SNAPPROCESS = 0x2
_MAX_PATH = 260


class _PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("cntUsage", wt.DWORD),
        ("th32ProcessID", wt.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wt.DWORD),
        ("cntThreads", wt.DWORD),
        ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wt.DWORD),
        ("szExeFile", ctypes.c_wchar * _MAX_PATH),
    ]


def image_names() -> list[str]:
    """当前所有进程的镜像名（小写）。失败返回空列表，调用方自行降级。

    CreateToolhelp32Snapshot 一次系统调用，毫秒级，不用起 tasklist 子进程。
    """
    try:
        snapshot = kernel32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if snapshot == -1:  # INVALID_HANDLE_VALUE
            return []
        try:
            entry = _PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
            names = []
            ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                names.append(entry.szExeFile.lower())
                ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
            return names
        finally:
            kernel32.CloseHandle(snapshot)
    except Exception:
        return []


def any_image_starts_with(prefix: str) -> bool:
    prefix = prefix.lower()
    return any(name.startswith(prefix) for name in image_names())
