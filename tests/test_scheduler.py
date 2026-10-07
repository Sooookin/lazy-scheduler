# -*- coding: utf-8 -*-
from datetime import datetime

from desktop import app
from core import store
from desktop import toast


def cards():
    out = []
    while not toast._queue.empty():
        out.append(toast._queue.get_nowait())
    return out


def restart():
    """프로세스를 새로 켠 것처럼: 첫 tick 표시와 메모리 속 중복 거르기를 비운다."""
    app.tick._ran = False
    toast._seen.clear()


def no_brief():
    store.update_settings({"brief_time": ""})


def test_restart_does_not_repeat_an_alert_already_shown():
    no_brief()
    store.add({"title": "보고서", "kind": "deadline", "due_date": "2026-09-15", "due_time": "09:50"})
    shown = 0
    for _ in range(3):
        restart()
        app.tick(now=datetime(2026, 9, 15, 10, 0))
        shown += len(cards())
    assert shown == 1


def test_alert_is_shown_once_inside_lead_time():
    no_brief()
    store.add({"title": "회의", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:20"})
    app.tick(now=datetime(2026, 9, 15, 9, 40))
    assert cards() == []                                 # 알림 시각(09:50) 전
    app.tick(now=datetime(2026, 9, 15, 10, 0))
    (card,) = cards()
    assert card["title"] == "회의" and card["sub"] == "20분 뒤 마감 · 10:20"
    app.tick(now=datetime(2026, 9, 15, 10, 1))
    assert cards() == []


def test_item_without_time_never_alerts_at_night():
    no_brief()
    store.add({"title": "시각 없음", "kind": "deadline", "due_date": "2026-09-15", "due_time": ""})
    for hm in ((9, 0), (23, 30), (23, 45)):
        app.tick(now=datetime(2026, 9, 15, *hm))
    assert cards() == []


def test_holiday_shifted_routine_alerts_on_the_shifted_day():
    """매월 1일 → 11/1(일) 은 10/30(금) 으로 옮겨진다. 예전에는 이 회차의 알림이 빠졌다."""
    no_brief()
    t = store.add({"title": "월초 점검", "kind": "routine", "due_time": "10:00",
                   "rule": {"period": "month", "basis": "day", "n": 1}})
    with store.transaction() as d:
        d["tasks"][0]["created"] = "2026-01-01T00:00:00"
    app.tick(now=datetime(2026, 10, 30, 9, 45))
    (card,) = cards()
    assert card["title"] == "월초 점검"
    assert card["key"] == "%s:2026-10-30" % t["id"]


def test_card_done_button_never_undoes_completion():
    tid = store.add({"title": "x", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:00"})["id"]
    store.set_done(tid, None, True)                      # 창에서 먼저 완료
    app._complete(tid, "2026-09-15")                     # 그 뒤 카드의 [완료]
    assert store.tasks()[0]["done"] is True
    store.remove(tid)
    app._complete(tid, "2026-09-15")                     # 그 사이 지워졌어도 조용히


def test_bad_stored_setting_cannot_stop_the_scheduler():
    no_brief()
    with store.transaction() as d:                       # 검증을 거치지 않은 옛 값
        d["settings"]["notify_min"] = "abc"
    store.add({"title": "회의", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:20"})
    app.tick(now=datetime(2026, 9, 15, 10, 0))           # 기본값 30분으로 동작
    assert [c["title"] for c in cards()] == ["회의"]


def test_brief_is_shown_once_per_day():
    store.update_settings({"brief_time": "08:30"})
    store.add({"title": "오늘 할 일", "kind": "deadline", "due_date": "2026-09-15", "due_time": "17:00"})
    app.tick(now=datetime(2026, 9, 15, 8, 31))
    restart()
    app.tick(now=datetime(2026, 9, 15, 8, 40))
    briefs = [c for c in cards() if c.get("label") == "아침 브리핑"]
    assert len(briefs) == 1 and briefs[0]["rows"][0][1] == "오늘 할 일"


def test_notify_plan_explains_skips():
    store.add({"title": "시각 없음", "kind": "deadline", "due_date": datetime.now().date().isoformat()})
    (row,) = app.notify_plan()["rows"]
    assert row["will_notify"] is False and "시각 없음" in row["skip"]


def test_early_alert_fires_the_day_before_and_keeps_the_usual_one():
    """하루 전 미리 알림은 마감 시각에 하루 앞서 한 번, 그리고 마감 30분 전 알림도 그대로 뜬다."""
    no_brief()
    store.add({"title": "보고서", "kind": "deadline", "due_date": "2026-09-16", "due_time": "15:00",
               "early_days": 1})
    app.tick(now=datetime(2026, 9, 15, 14, 50))
    assert cards() == []                                 # 아직 이르다
    app.tick(now=datetime(2026, 9, 15, 15, 0))
    (card,) = cards()
    assert card["title"] == "보고서" and card["rel"] == "내일 마감" and "미리 알림" in card["meta"]
    restart()
    app.tick(now=datetime(2026, 9, 15, 18, 0))           # 다시 켜도 또 뜨지 않는다
    assert cards() == []
    app.tick(now=datetime(2026, 9, 16, 14, 31))
    assert [c["sub"] for c in cards()] == ["29분 뒤 마감 · 15:00"]


def test_early_alert_without_time_uses_the_brief_time_and_only_that_day():
    store.update_settings({"brief_time": "08:30"})
    store.add({"title": "분기 자료", "kind": "deadline", "due_date": "2026-09-18", "early_days": 3})
    app.tick(now=datetime(2026, 9, 15, 8, 0))
    assert [c for c in cards() if c.get("rel")] == []
    app.tick(now=datetime(2026, 9, 15, 21, 0))           # 늦게 켰어도 그 날 안이면
    (card,) = [c for c in cards() if c.get("rel")]
    assert card["rel"] == "3일 뒤 마감" and card["meta"].startswith("3일 뒤 마감 · 미리 알림")
    store.add({"title": "그제 것", "kind": "deadline", "due_date": "2026-09-17", "early_days": 3})
    app.tick(now=datetime(2026, 9, 15, 22, 0))           # 미리 알림 날(9/14)이 지났으면 뜨지 않는다
    assert [c for c in cards() if c.get("rel")] == []


def test_early_days_is_checked_and_dropped_when_off():
    t = store.add({"title": "x", "kind": "deadline", "due_date": "2026-09-16", "early_days": 2})
    assert t["early_days"] == 2
    t = store.update(t["id"], {"early_days": 0})
    assert "early_days" not in t
    m = store.add({"title": "메모", "kind": "floating", "early_days": 1})
    assert "early_days" not in m
    import pytest
    with pytest.raises(store.ValidationError):
        store.add({"title": "y", "kind": "deadline", "due_date": "2026-09-16", "early_days": 9})
