# -*- coding: utf-8 -*-
"""进度节流：100ms 或 ≥1% 才发一条，首尾必发。"""
import time


class ProgressReporter:
    def __init__(self, bus, job_id: str, min_interval: float = 0.1):
        self._bus = bus
        self._job_id = job_id
        self._min_interval = min_interval
        self._last_at = 0.0
        self._last_percent = -1

    def __call__(self, phase: str, done: int, total: int,
                 bytes_done: int = 0, bytes_total: int = 0) -> None:
        now = time.time()
        percent = int(done * 100 / total) if total else 100
        is_edge = done >= total or done <= 1
        if not is_edge and (now - self._last_at) < self._min_interval and \
                (percent - self._last_percent) < 1:
            return
        self._last_at = now
        self._last_percent = percent
        self._bus.emit(
            "job.progress",
            job_id=self._job_id,
            phase=phase,
            done=done,
            total=total,
            bytes_done=bytes_done,
            bytes_total=bytes_total,
            percent=percent,
        )
