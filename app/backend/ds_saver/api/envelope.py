# -*- coding: utf-8 -*-
"""统一返回信封。

pywebview 会把 Python 异常变成难读的 Promise reject，前端拿不到 code。
所以 api 层永远返回 {ok, data, error}，一个异常都不往外抛。
"""
import functools
import logging

from ..core.errors import DsError, ErrorCode

log = logging.getLogger(__name__)


def ok(data=None) -> dict:
    return {"ok": True, "data": data, "error": None}


def fail(code: str, message: str, detail: dict | None = None) -> dict:
    return {"ok": False, "data": None,
            "error": {"code": code, "message": message, "detail": detail or {}}}


def guard(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return ok(fn(*args, **kwargs))
        except DsError as exc:
            return fail(exc.code, exc.message, exc.detail)
        except Exception as exc:  # noqa: BLE001
            log.exception("api.%s failed", fn.__name__)
            return fail(ErrorCode.INTERNAL, "内部错误",
                        {"reason": str(exc), "method": fn.__name__})
    return wrapper
