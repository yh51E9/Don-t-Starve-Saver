# -*- coding: utf-8 -*-
"""统一错误类型与错误码。

core 层自己抛 DsError，api 层把它翻成信封，前端只认 code。
不把中文文案写死在 core 里——同一种错误在弹窗和 toast 里可能要不同措辞。
"""


class ErrorCode:
    BAD_ARGS = "E_BAD_ARGS"
    UNKNOWN_SLOT = "E_UNKNOWN_SLOT"
    BACKUP_NOT_FOUND = "E_BACKUP_NOT_FOUND"
    PATH_ESCAPE = "E_PATH_ESCAPE"
    SAVE_DIR_INVALID = "E_SAVE_DIR_INVALID"
    GAME_RUNNING = "E_GAME_RUNNING"
    BUSY = "E_BUSY"
    IO = "E_IO"
    PARSE = "E_PARSE"
    CONFIG = "E_CONFIG"
    CANCELLED = "E_CANCELLED"
    NOT_SUPPORTED = "E_NOT_SUPPORTED"
    INTERNAL = "E_INTERNAL"


class DsError(Exception):
    """带机器可读 code 的业务异常。"""

    def __init__(self, code: str, message: str, detail: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def __str__(self) -> str:  # 日志里能直接看清是哪类错误
        return f"[{self.code}] {self.message}"
