# -*- coding: utf-8 -*-
"""在资源管理器里打开目录 / 定位文件 / 用默认浏览器开链接。"""
import os
import subprocess


def reveal(path: str) -> bool:
    try:
        if os.path.isdir(path):
            os.startfile(path)  # noqa: S606 - 本地桌面应用，路径来自自己的备份根目录
            return True
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
        return True
    except OSError:
        return False


def open_url(url: str) -> bool:
    """用默认浏览器打开链接。os.startfile 走 ShellExecute，浏览器派发才正确；
    explorer.exe 硬开 URL 会报"没有关联的应用"。"""
    try:
        os.startfile(url)  # noqa: S606 - 调用方已做白名单校验
        return True
    except OSError:
        return False
