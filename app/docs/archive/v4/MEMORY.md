# 项目长期记忆

> 这份文件是给 AI 助手在后续会话中快速接续用的，包含必须遵守的约定和已确认的事实。

## 项目定位

《饥荒》单机版（AppID 219740）按世界/槽位粒度的存档备份工具。单文件 exe，中文界面，轻量级。

**核心痛点**：饥荒单机版一个世界就是一个存档，通用存档管理器一次性备份全部游戏，容易出错。

## 项目主目录（唯一）

```
D:\Tools\饥荒单机版存档备份\
├─ 饥荒存档备份工具.exe        主程序
├─ dst_saver_config.json       配置（exe 同级）
├─ backups\                     备份（exe 同级，软件自管）
├─ src\                         源码（6 个 py，见「架构」）
├─ docs\                        文档
├─ build.bat                    重新打包
├─ README.md
└─ CHANGELOG.md
```

## 必须遵守的约定

1. **所有修改和打包都在 `D:\Tools\饥荒单机版存档备份\` 进行**，不要在工作区另建副本
2. 打包后把 `src\dist\饥荒存档备份工具.exe` 拷贝到项目根目录
3. **GUI 进程只能用 `run_in_background` 启动**，不能用 shell `&`
4. **验证前先 taskkill** 所有 `python.exe` 和 `饥荒存档备份工具.exe` 实例
5. 耗时操作放线程，结果经 `state` 轮询回写（DPG 非线程安全）

## 已确认的关键事实

- 存档目录本机路径：`D:\Software\Steam\userdata\1222722443\219740\remote`
- **一个世界 = 一个文件**（`survival_1` / `cave_1_1_1` / `volcano_1` …）
- `saveindex` = `KLEI     1D` 头 + base64 + zlib + **Lua 表**（非 JSON）
- 备份一个槽位必须同时备份 `saveindex`
- 本机环境：无 .NET SDK、无系统 Python、内置 Python 无 tkinter → GUI 只能选 Dear PyGui

## 已验证记录

- 2026-10-27: 从 `D:\Tools\饥荒单机版存档备份\饥荒存档备份工具.exe` 启动运行约 7 小时（用户手动关闭），**stderr 无任何异常输出**
- 暗色 / 亮色两套主题均已截图确认渲染正常，选中色与主色统一，标题栏跟随主题

## 架构（v4.0 起，必须保持）

```
klei_format → backup_core → theme/widgets → pages ⇢ app → main
```

- `pages.py` 单向 import `app.py`；`app.py` **不** import pages，靠 `app.RENDER` 注册表回调
- 渲染分两层：静态骨架在 pages，动态内容在 app（设置页版面在 pages）
- 改界面**必读** `docs/TECH_MEMORY.md` 第二节的 22 条 DPG 坑，尤其是：
  `border=False` 的 child window 会吃掉 WindowPadding（要 border=True + 边框同底色）、
  selectable 不支持 width=-1、负高度是"父高 - N"

## 当前功能状态

- [x] 存档目录自动扫描（注册表 Steam 路径 + libraryfolders.vdf + 文档目录）
- [x] 世界列表（显示角色/模式/天数，自动跳过空槽）
- [x] 按槽位备份（含关联洞穴/火山 + saveindex）
- [x] 备份历史列表、恢复、删除（均带二次确认）
- [x] 双主题（跟随系统 / 暗色 / 亮色）+ 字号可调
- [x] 托盘最小化 + 关闭询问（可记住选择）
- [x] 恢复前检测游戏进程
- [x] 自动备份（巡检世界文件 + 60 秒冷却 + 与手动备份分开计数）
- [x] 恢复前自动快照（`_pre`）
- [x] 占用空间统计 + 清理入口
- [x] 备份元数据（解析备份内 saveindex，显示当时天数/角色/模式）
- [x] 无边框自绘标题栏、双主题、三档字号
- [ ] 备份备注标签
- [ ] 备份完整性校验（sha256 清单）

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| GUI | Dear PyGui 2.3.1 | 轻量、无需系统 Python、支持自定义主题/字体 |
| 打包 | PyInstaller 6.x | `--onefile --noconsole` 出单 exe |
| 托盘 | pystray + Pillow | DPG 无内置托盘 |
| 解析 | 标准库 + 自写 Lua 表解析器 | 零第三方依赖 |

## 依赖安装

```bat
python -m pip install dearpygui pystray pillow pyinstaller
```

## 构建

见 `build.bat`，或：

```bat
cd src
python -m PyInstaller --onefile --noconsole --clean --name "饥荒存档备份工具" main_gui.py
```
