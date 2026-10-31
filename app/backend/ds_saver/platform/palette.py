# -*- coding: utf-8 -*-
"""原生标题栏用的最小色板。

前端有一份完整令牌，这里是给 DWM 用的两色副本（底色 + 次要文字色）。
只此一处重复，避免为了染标题栏把整个主题系统搬进 Python。
"""

CHROME = {
    "nightfall": {"dark": ("#1D1F22", "#A7AEB8"), "light": ("#EEF1F4", "#1A1D21")},
    "ledger": {"dark": ("#1A1815", "#B3A893"), "light": ("#F4EFE4", "#5A5245")},
    "brass": {"dark": ("#1B201D", "#A8A38F"), "light": ("#ECE6D6", "#1A1D21")},
}

DEFAULT_PRESET = "nightfall"


def chrome_colors(preset: str, scheme: str) -> tuple[str, str]:
    preset_map = CHROME.get(preset) or CHROME[DEFAULT_PRESET]
    return preset_map.get(scheme) or preset_map["dark"]
