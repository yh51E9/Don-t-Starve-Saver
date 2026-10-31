# -*- coding: utf-8 -*-
"""事件总线：环形缓冲 + 序号 + 进度合并。

前端不订阅推送，而是按 seq 轮询。好处有三：
  - 页面还没加载完不会丢事件（进程启动就开始缓冲）
  - 不跨线程调 evaluate_js，不会跟 UI 主循环抢锁
  - 天然有背压，进度再密也只是替换队尾
"""
import threading
import time
from collections import deque


class EventBus:
    def __init__(self, maxlen: int = 512):
        self._items: deque[dict] = deque(maxlen=maxlen)
        self._maxlen = maxlen
        self._seq = 0
        self._lost_from: int | None = None
        self._lock = threading.Lock()

    @property
    def seq(self) -> int:
        with self._lock:
            return self._seq

    def emit(self, type_: str, **payload) -> int:
        with self._lock:
            self._seq += 1
            event = {
                "seq": self._seq,
                "ts": round(time.time(), 3),
                "type": type_,
                "payload": payload,
            }
            # 同一个任务的连续进度只留最后一条，避免刷爆缓冲
            if type_ == "job.progress" and self._items:
                last = self._items[-1]
                if (last["type"] == "job.progress"
                        and last["payload"].get("job_id") == payload.get("job_id")):
                    self._items[-1] = event
                    return self._seq

            if len(self._items) == self._maxlen:
                oldest = self._items[0]
                if self._lost_from is None:
                    self._lost_from = oldest["seq"] + 1
                self._items.append(event)
                # deque 自动挤掉最旧一条，但只丢非终态——终态丢了前端就无法收敛
                if oldest["type"] in ("job.done", "job.failed"):
                    self._lost_from = None
            else:
                self._items.append(event)
            return self._seq

    def drain(self, since_seq: int = 0) -> tuple[list[dict], int, int | None]:
        with self._lock:
            events = [item for item in self._items if item["seq"] > int(since_seq or 0)]
            return events, self._seq, self._lost_from

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._lost_from = None
