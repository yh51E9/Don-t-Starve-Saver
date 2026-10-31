# 架构

## 分层

```
core（纯逻辑，可单测）
  ↑
services（会话 / 任务队列 / 巡检 / 事件）
  ↑
api（信封 + 错误码）      platform（Win32 / 托盘 / 资源管理器）
  ↑                        ↑
        apphost（窗口与生命周期）
```

三条边界：

1. `core` 不 import 上层，不知道「当前选中世界」，只接受显式参数和可选 `on_progress`。
2. `services` 只往 `EventBus` 塞事件，不认识前端。
3. `apphost` 是唯一同时看到 `api` 与 `platform` 的地方。

## 一次操作怎么走

```
React action
  → BridgeApi（api.ts 拆信封）
  → JsApi.backup(slot_id)
  → JobRunner.submit() 返回 job_id
  → 单 worker 线程：core.store.backup_slot(on_progress=…)
  → EventBus.emit(job.progress / job.done)
  → 前端 poll_events(seq) 拉取
  → Zustand.applyEvents() → toast + 刷新
```

**为什么轮询而不是推送**：`evaluate_js` 要跨线程 marshal 到 UI 线程并等返回值，
10Hz 的进度会和主循环抢锁；页面没加载完还会抛异常。轮询最多 150ms 延迟，进度完全够，
而且事件从进程启动就写进环形缓冲，前端第一次拉取就能拿到全部积压，不需要就绪握手。

## 错误模型

`core` 抛 `DstError(code, message, detail)`，`api.envelope.guard` 统一包成：

```json
{"ok": false, "data": null, "error": {"code": "E_GAME_RUNNING", "message": "...", "detail": {}}}
```

前端 `api.ts` 见到 `ok=false` 抛 `ApiError`，界面用 `code` 映射提示文案。
**任何异常都不会穿到 JS**，避免 pywebview 把 Python traceback 变成一段不可读的 Promise reject。

## 状态

Zustand 单 store。理由：事件来自 React 树外的轮询器，需要 `getState()` 这种外部写入口；
时间轴十几行、进度每秒数次更新，需要 selector 精准订阅。路由不用 react-router——
桌面窗口没有地址栏和深链，`view: 'worlds' | 'settings'` 就够。

## 主题

- 语义令牌（`--dst-bg` / `--dst-hairline` / `--dst-accent`…）是唯一真相
- 字号只有四档 `--dst-fs-micro/meta/body/title`（0.75/0.8125/0.9375/1.0625rem），
  根字号 17px 由 `documentElement.style.fontSize` 驱动
- 图标只有三档 14/18/22，stroke 1.6/1.8；尺寸常量在 `theme/layout.ts`
- Mantine 的 `colors.accent` 只是 10 阶 ramp，锚点强制等于令牌里的 accent
- 把 `--mantine-color-body/text/dimmed/default-border/anchor/error` 映射到令牌，
  内置组件默认态自动跟随，不用逐个覆盖
- 签名细节（菱形节点、双线、铆钉、纸纹）走 CSS Modules + `light-dark()`，按 `data-dst-preset` 切换
- 对比度由 `ui/scripts/check-contrast.mjs` 把关：3 套 × 2 明暗 × 15 组，不过就 exit 1

## 角色头像

```
saveindex.character
  → avatars.resolve()        mod > DLC0003/2/1 > base > bigportraits
  → tex.parse_tex()          KTEX 头 + n×10B mip 元数据
  → tex.decode_rect()        只解 UV 覆盖的 DXT5 block，再垂直翻转
  → PNG 缓存                  %LOCALAPPDATA%\ds-saver\avatars\<char>.png
  → api.get_avatars()         base64 data URL（96×96 约 7–10KB）
```

- **必须裁剪解码**：整图 512² 约 208ms，单格约 10ms；生产路径禁止 `decode_all`
- **必须垂直翻转**：Klei 贴图自下而上存储，UV 直接裁完会上下颠倒
- 缓存失效看源文件 `mtime_ns + size`；设置页「重建头像」清 PNG 与索引
- 头像失败不影响主流程，前端保持字母徽记

## 原生窗口

- HWND：`window.native.Handle.ToInt64()`，失败按 PID + 类名 `WindowsForms10.Window.*` 枚举
- 标题栏：`DwmSetWindowAttribute` 20（深浅）+ 35/36/34（Win11 22H2+ 的标题栏/文字/边框色）
- 关闭三态：`closing` 返回 `False` 取消关闭；`tray` → `window.hide()`；`ask` → 推 `shell.close_requested`
- `close_action="tray"` 是**隐藏到托盘**（v4.x 是最小化到任务栏，这里按语义修正）
