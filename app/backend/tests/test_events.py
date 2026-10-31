# -*- coding: utf-8 -*-
from ds_saver.services.eventbus import EventBus


def test_seq_is_monotonic():
    bus = EventBus()
    bus.emit("a", n=1)
    bus.emit("b", n=2)
    events, seq, lost = bus.drain(0)
    assert [event["type"] for event in events] == ["a", "b"]
    assert seq == 2 and lost is None


def test_drain_respects_cursor():
    bus = EventBus()
    bus.emit("a")
    bus.emit("b")
    events, _seq, _lost = bus.drain(1)
    assert [event["type"] for event in events] == ["b"]


def test_progress_events_are_merged():
    bus = EventBus()
    for percent in range(0, 100, 5):
        bus.emit("job.progress", job_id="j1", percent=percent)
    events, seq, _lost = bus.drain(0)
    assert len(events) == 1
    assert events[0]["payload"]["percent"] == 95
    assert seq == 20


def test_progress_of_different_jobs_does_not_merge():
    bus = EventBus()
    bus.emit("job.progress", job_id="j1", percent=10)
    bus.emit("job.progress", job_id="j2", percent=20)
    events, _seq, _lost = bus.drain(0)
    assert len(events) == 2


def test_overflow_reports_lost_from():
    bus = EventBus(maxlen=4)
    for index in range(10):
        bus.emit("tick", index=index)
    events, _seq, lost = bus.drain(0)
    assert len(events) == 4
    assert lost is not None
    assert events[0]["payload"]["index"] == 6
