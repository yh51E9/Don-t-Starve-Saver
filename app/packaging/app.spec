# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包脚本（onedir 优先，验证通过后再切 onefile）。

构建目录必须是纯 ASCII 路径，前端资源用相对路径进包。
"""
import os

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
UI_DIST = os.path.join(ROOT, "ui", "dist")
ICON = os.path.join(SPECPATH, "icon.ico")

ASSETS = os.path.join(ROOT, "backend", "ds_saver", "assets")
datas = [(UI_DIST, "web")]
if os.path.isdir(ASSETS):
    datas += [(ASSETS, os.path.join("ds_saver", "assets"))]
datas += collect_data_files("webview")

hiddenimports = [
    "webview.platforms.winforms",
    "pystray._win32",
]
hiddenimports += collect_submodules("clr_loader")

a = Analysis(
    [os.path.join(ROOT, "run.py")],
    pathex=[os.path.join(ROOT, "backend")],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "PyQt5", "PyQt6", "PySide2", "PySide6", "gtk", "tkinter",
        "matplotlib", "numpy", "pandas", "scipy", "IPython", "pytest",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="饥荒存档备份工具",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON if os.path.isfile(ICON) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="饥荒存档备份工具",
)
