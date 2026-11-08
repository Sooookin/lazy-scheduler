# -*- coding: utf-8 -*-
"""창 밖에서 보는 것 (2026-11 편의성 전면안): 알림 카드의 [다음 영업일] · 트레이의 한 줄 · 전역 단축키."""
import sys
from datetime import date, timedelta

import pytest

from core import recur, store
from desktop import app, toast


def _task(tid):
    return next(t for t in store.load()["tasks"] if t["id"] == tid)


def test_card_later_moves_a_task_to_the_next_business_day():
    t = store.add({"title": "보고서", "kind": "deadline", "due_date": date.today().isoformat(), "due_time": "10:00"})
    app._later({"id": t["id"], "date": t["due_date"], "kind": "deadline", "title": t["title"]})
    want = recur.next_business_day(date.today() + timedelta(days=1))
    assert _task(t["id"])["due_date"] == want.isoformat()


def test_card_later_on_a_routine_skips_that_day_and_makes_one_task():
    r = store.add({"title": "일일 점검", "kind": "routine", "due_time": "18:30", "rule": {"period": "day", "business_only": False}})
    day = date.today().isoformat()
    app._later({"id": r["id"], "date": day, "kind": "routine", "title": r["title"], "time": "18:30"})
    assert day in _task(r["id"])["skip_dates"]
    made = [t for t in store.load()["tasks"] if t.get("title") == "일일 점검" and t.get("kind") == "deadline"]
    assert len(made) == 1 and made[0]["due_time"] == "18:30"


def test_card_offers_the_later_button_instead_of_open(monkeypatch):
    monkeypatch.setattr(toast, "_open_handler", lambda: None)
    item = {"title": "보고서", "sub": "", "on_done": lambda: None, "on_snooze": lambda: None,
            "on_later": lambda: None, "can_open": True}
    _, hits = toast._card_rgba(item)
    assert {"done", "snooze", "later"} <= set(hits) and "open" not in hits
    done = []
    item["on_later"] = lambda: done.append(1)
    cb, opens = toast._click_plan(item, "later")
    cb()
    assert done == [1] and not opens


def test_tray_line_says_what_the_lens_says():
    o = {"overdue": [{"title": "어제 일", "done": False, "time": ""}],
         "todays": [{"title": "아침", "done": False, "time": "08:30"},
                    {"title": "국내 일임 매매", "done": False, "time": "15:00"},
                    {"title": "끝낸 일", "done": True, "time": "09:00"}]}
    late, tip = app.glance(o, "11:00")
    assert late == 2
    assert "놓친 일 2" in tip and "다음 15:00 국내 일임 매매 · 4시간 뒤" in tip
    late, tip = app.glance({"overdue": [], "todays": []}, "11:00")
    assert late == 0 and "오늘 남은 일 없음" in tip


@pytest.mark.parametrize("spec,ok", [("ctrl+alt+space", True), ("ctrl+shift+n", True), ("", True),
                                     ("space", False), ("ctrl+", False), ("ctrl+alt+enter", False)])
def test_hotkey_setting_is_checked(spec, ok):
    if ok:
        assert store.update_settings({"hotkey": spec})["hotkey"] == spec
    else:
        with pytest.raises(store.ValidationError):
            store.update_settings({"hotkey": spec})


@pytest.mark.skipif(sys.platform != "win32", reason="Windows 의 RegisterHotKey")
def test_hotkey_spec_parses_to_win32_codes():
    from platforms.win import cards
    assert cards._parse_hot("ctrl+alt+space") == (0x2 | 0x1 | cards.MOD_NOREPEAT, 0x20)
    assert cards._parse_hot("ctrl+shift+n") == (0x2 | 0x4 | cards.MOD_NOREPEAT, ord("N"))
    assert cards._parse_hot("ctrl+f5")[1] == 0x74
    assert cards._parse_hot("space") is None and cards._parse_hot("hyper+x") is None


def test_next_gap_skips_busy_half_hours_and_stops_at_day_end():
    t = lambda tm, i="x": {"id": i, "date": "d", "time": tm, "done": False}
    todays = [t("15:00", "me"), t("15:30"), t("16:00"), t("18:30")]
    # 14:30 에 15:00 일의 카드: 그 일 자신은 빼고, 15:00 은 15:30 회의 앞까지 30분 빈다
    assert app.next_gap(todays, 14 * 60 + 30, skip=("me", "d")) == "15:00"
    # 15:10: 15:40 부터는 회의(15:30) · 송부(16:00) 에 걸리고, 16:30 이 처음 빈다
    assert app.next_gap(todays, 15 * 60 + 10, skip=("me", "d")) == "16:30"
    # 하루 끝을 넘으면 없다
    assert app.next_gap(todays, 17 * 60 + 40, skip=("me", "d")) is None
    assert app.next_gap([], 9 * 60 + 2) == "09:35"


def test_card_snooze_button_says_the_gap_time(monkeypatch):
    monkeypatch.setattr(toast, "_open_handler", lambda: None)
    item = {"title": "보고서", "sub": "", "on_done": lambda: None, "on_snooze": lambda: None,
            "on_later": lambda: None, "snooze_label": "16:30"}
    _, hits = toast._card_rgba(item)
    assert "snooze" in hits

