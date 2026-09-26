# -*- coding: utf-8 -*-
"""빨라지려고 한 일들이 조용히 틀어지지 않게 지킨다.

여기 있는 것은 속도 자체를 재는 시험이 아니다 (기계마다 다르고 CI 에서 흔들린다).
빠르게 만들려고 둔 "같은 값을 두 벌로 들고 있는" 자리들이 서로 어긋나지
않는지, 그리고 지워 버린 응답 항목이 되살아나지 않는지를 본다.
"""
import os
from datetime import date, datetime

import pytest

import paths
import recur
import store

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_holiday_strings_and_dates_stay_in_sync():
    """is_business_day 는 date 집합을, 응답은 문자열 집합을 쓴다. 둘은 같아야 한다."""
    recur.set_holidays(["2026-12-24", "2026-12-26"])
    assert {d.isoformat() for d in recur._HOLIDAY_DATES} == set(recur.HOLIDAYS)
    assert not recur.is_business_day(date(2026, 12, 24))
    assert recur.is_business_day(date(2026, 12, 23))
    # 되돌린다
    recur.set_holidays([])
    assert {d.isoformat() for d in recur._HOLIDAY_DATES} == set(recur.HOLIDAYS)
    assert recur.is_business_day(date(2026, 12, 24))


def test_a_broken_holiday_string_does_not_take_the_others_down():
    recur.set_holidays(["2026-12-24", "언젠가", ""])
    assert not recur.is_business_day(date(2026, 12, 24))
    recur.set_holidays([])


def test_span_days_cache_gives_back_the_same_days():
    a = recur._span_days(date(2026, 9, 1), date(2026, 9, 5))
    b = recur._span_days(date(2026, 9, 1), date(2026, 9, 5))
    assert a == b == tuple(date(2026, 9, d) for d in range(1, 6))
    assert isinstance(a, tuple), "부르는 쪽이 고칠 수 있으면 캐시가 망가진다"


def test_rule_text_is_the_same_whether_it_was_precomputed_or_not():
    """_expand 는 항목당 한 번만 구해서 회차마다 나눠 준다. 결과가 달라지면 안 된다."""
    cases = [
        {"id": "a", "kind": "routine", "title": "매 영업일",
         "rule": {"period": "day", "business_only": True}},
        {"id": "b", "kind": "routine", "title": "격주 월", "created": "2026-01-01",
         "rule": {"period": "week", "weekdays": [0], "interval": 2}},
        {"id": "c", "kind": "routine", "title": "규칙 없음"},      # describe(None) → "반복"
        {"id": "d", "kind": "deadline", "title": "마감", "due_date": "2026-09-20"},
    ]
    for t in cases:
        rows = store._expand(t, date(2026, 9, 1), date(2026, 9, 30))
        for row in rows:
            fresh = store._inst(t, date.fromisoformat(row["date"]) if row["date"] else None)
            assert row["rule_text"] == fresh["rule_text"], t["id"]
            assert row["rule_n"] == fresh["rule_n"], t["id"]


def test_overview_does_not_carry_fields_nobody_reads():
    """지운 것이 되살아나면 폴링마다 다시 실려 나간다.

    later: 계산해서 실어 보내기만 하고 읽는 곳이 없었다.
    rule:  회차마다 같은 규칙이 통째로 실렸다. 수정 창은 rule_n 을 읽는다.
    """
    o = store.overview()
    assert "later" not in o
    for key in ("todays", "overdue", "upcoming", "routines", "floating"):
        for i in o[key]:
            assert "rule" not in i, "%s 에 raw rule 이 돌아왔다" % key


def test_edit_form_still_gets_what_it_needs():
    """rule 을 뺐으니 rule_n 은 반드시 있어야 한다 (수정 창이 이걸로 그린다)."""
    store.add({"kind": "routine", "title": "월말 보고",
               "rule": {"period": "month", "basis": "before_end_bd", "k": 0}})
    rows = [i for i in store.instances(back=0, ahead=70) if i["kind"] == "routine"]
    assert rows, "반복이 펼쳐지지 않았다"
    for i in rows:
        assert i["rule_n"] and i["rule_n"].get("period") == "month"
        assert i["rule_text"]


def test_overview_is_not_recomputed_while_the_file_is_unchanged(monkeypatch):
    """창은 45초마다, 스케줄러는 1분마다 개요를 묻는다. 파일이 그대로면 다시 펼치지 않는다.

    시각(now)은 부를 때마다 새로 싣는다 - 계산해 둔 본문은 날짜와 파일만 본다.
    """
    store.add({"kind": "routine", "title": "매 영업일", "rule": {"period": "day", "business_only": True}})
    calls = []
    real = store._overview_body
    monkeypatch.setattr(store, "_overview_body", lambda d, t: calls.append(t) or real(d, t))

    a = store.overview(now=datetime(2026, 9, 24, 9, 0))
    b = store.overview(now=datetime(2026, 9, 24, 9, 5))
    assert len(calls) == 1
    assert (a["now"], b["now"]) == ("09:00", "09:05")
    assert a["routines"] == b["routines"]

    store.add({"kind": "floating", "title": "새 메모"})        # 파일이 바뀌면 다시
    c = store.overview(now=datetime(2026, 9, 24, 9, 6))
    assert len(calls) == 2
    assert [i["title"] for i in c["floating"]] == ["새 메모"]

    store.overview(now=datetime(2026, 9, 25, 9, 0))           # 날이 바뀌어도 다시
    assert len(calls) == 3


def test_overview_without_a_rev_is_never_cached(monkeypatch):
    """data 만 넘기면(저장하지 않은 내용일 수 있다) 계산해 둔 것을 쓰면 안 된다."""
    calls = []
    real = store._overview_body
    monkeypatch.setattr(store, "_overview_body", lambda d, t: calls.append(t) or real(d, t))
    d = store.load()
    store.overview(data=d, now=datetime(2026, 9, 24, 9, 0))
    store.overview(data=d, now=datetime(2026, 9, 24, 9, 0))
    assert len(calls) == 2


def test_data_file_is_written_without_indentation():
    """indent 를 주면 json 이 느린 파이썬 인코더로 떨어지고 파일도 40% 커진다."""
    store.add({"kind": "deadline", "title": "보고", "due_date": "2026-09-30"})
    with open(paths.DATA_FILE, encoding="utf-8") as f:
        raw = f.read()
    assert "\n" not in raw and ": " not in raw


def test_the_sun_glow_is_not_an_animated_svg_filter():
    """SVG 안에서 흐림 필터를 숨 쉬게 하면 창이 가만히 있어도 1초에 60번 다시 칠한다."""
    js = ""
    for name in ("app.js", "sky.js", "pebble.js"):
        with open(os.path.join(ROOT, "web", name), encoding="utf-8") as f:
            js += f.read()
    assert "feGaussianBlur" not in js
