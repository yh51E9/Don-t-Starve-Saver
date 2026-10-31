# 阶段 0 探针结论（2026-10-27）

环境：Windows 11 build 26300 / Python 3.13.14 / pywebview 6.2.1 / pythonnet 3.2.1 / WebView2 155.0.4283.62

| # | 问题 | 实测结论 |
|---|---|---|
| 1 | pywebview 能否在 Python 3.13 起来 | **可以**。最小窗口正常，`pywebview 6.2.1` + `pythonnet 3.2.1`（PyPI 标注支持 3.11–3.15） |
| 2 | 能不能拿到 HWND | `window.native` 是 `webview.platforms.winforms.BrowserView.BrowserForm`，`window.native.Handle` 是 `IntPtr`，**必须 `.ToInt64()`**，不能 `int()`。实测 `788420` |
| 3 | 拿不到时的备选 | 按 PID 枚举：类名 `WindowsForms10.Window.8.app.0.aec740_r24_ad1`、标题正确、`IsWindowVisible=True`。同进程还有 `GDI+ Hook Window Class`、`.NET-BroadcastEventWindow`、`IME`、`MSCTFIME UI` 四个干扰窗口，**必须过滤可见性 + 类名前缀** |
| 4 | `closing` 返回值语义 | 返回 **`False` = 取消关闭**（窗口保留），返回 `True` = 放行。实测调用两次后正常退出 |
| 5 | `http_server=True` 的 URL | `http://127.0.0.1:42001/index.html`（端口随机）。`private_mode=False, storage_path=...` 两个参数被接受 |
| 6 | 托盘与主循环共存 | pystray `run_detached()` + webview 主循环正常；菜单回调里 `window.show()/hide()/destroy()` 都不阻塞，验证后正常退出 |
| 7 | `webview.screens` | 返回 `Screen` 对象，`width/height/scale` 可用（本机 1920×1080 / 1.0） |
| 8 | `window.get_current_url()` | `html=` 建的窗口在 `shown` 时返回 `None`；`url=` 加载的窗口 0.8s 后返回真实 URL。**不要在 `html` 模式下依赖它** |

## 对实现的约束

1. `native.Handle` 一律包 `try/except`，取 `int(handle.ToInt64())`。
2. HWND 只取一次并缓存；`shown` 之后延迟 ~150ms 再取（`BrowserForm` 尚未完成布局时可能还没句柄）。
3. 走 `http_server=True`，前端资源用 `url=` 传绝对路径；构建产物目录必须存在，否则给中文错误框而不是白屏。
4. 关闭三态用 `closing` 返回 `False` 取消 + `_force_quit` 放行，不依赖 `window.destroy()` 的异常行为。
5. 托盘菜单只调 `window.show()/hide()` 和置标志，销毁统一走主循环。

## KTEX / DXT5 解码（v5.1 P0-S，2026-10-27）

- 头部：`KTEX` + 4 字节 specs；从 `0x08` 起每个 mip **10 字节**：`u16 w, u16 h, u16 pitch, u32 size`
- mip 数用 `8 + 10*n + Σsize == filesize` 反推，四个样本全部唯一命中（512²=10、1024×512=11、1024²=11、64²=7）
- 格式用首 mip 的 `data_size` 判断：`ceil(w/4)*ceil(h/4)*16` → DXT5
- **贴图自下而上存储**：UV 按自上而下裁，再把裁出的图 `FLIP_TOP_BOTTOM`。不翻转会得到上下颠倒的头像
- UV 朝向已用 wilson / waxwell / wolfgang 三格交叉验证：行与列都对得上，Maxwell 不会串到 Wilson 的格子
- alpha 正常（`alpha_min=0`），透明边不是黑底

实测耗时（Windows / Python 3.13 / 单线程）：

| 样本 | 尺寸 | 裁剪解码 |
|---|---|---|
| `saveslot_portraits` wilson | 512² 图集，单格约 119×103 | **10 ms** |
| `bigportraits\wagstaff` | 1024²，单图 | **22 ms** |
| mod `avatar_carney` | 64² | **4 ms** |
| 整图 `decode_all` | 512² | 208 ms |

结论：生产路径必须裁剪解码；`decode_all` 只留调试。首屏 4 个世界（2 个不同角色）预计 <80ms。

## KTEX / DXT5 解码（v5.1 P0-S，2026-10-27）

- 头部：`KTEX` + 4 字节 specs；从 `0x08` 起每个 mip **10 字节**：`u16 w, u16 h, u16 pitch, u32 size`
- mip 数用 `8 + 10*n + Σsize == filesize` 反推，四个样本全部唯一命中（512²=10、1024×512=11、1024²=11、64²=7）
- 格式用首 mip 的 `data_size` 判断：`ceil(w/4)*ceil(h/4)*16` → DXT5
- **贴图自下而上存储**：UV 按自上而下裁，再把裁出的图 `FLIP_TOP_BOTTOM`。不翻转会得到上下颠倒的头像
- UV 朝向已用 wilson / waxwell / wolfgang 三格交叉验证：行与列都对得上，Maxwell 不会串到 Wilson 的格子
- alpha 正常（`alpha_min=0`），透明边不是黑底

实测耗时（Windows / Python 3.13 / 单线程）：

| 样本 | 尺寸 | 裁剪解码 |
|---|---|---|
| `saveslot_portraits` wilson | 512² 图集，单格约 119×103 | **10 ms** |
| `bigportraits\wagstaff` | 1024²，单图 | **22 ms** |
| mod `avatar_carney` | 64² | **4 ms** |
| 整图 `decode_all` | 512² | 208 ms |

结论：生产路径必须裁剪解码；`decode_all` 只留调试。首屏 4 个世界（2 个不同角色）预计 <80ms。
