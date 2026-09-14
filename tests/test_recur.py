# -*- coding: utf-8 -*-
import json
import os
import threading
from datetime import date, timedelta

import pytest

import recur

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "vectors", "recurrence.json"), encoding="utf-8") as f:
    VECTORS = json.load(f)["cases"]


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_specification_vectors(case):
    got = recur.occurrences(case["rule"], date.fromisoformat(case["start"]),
                            date.fromisoformat(case["end"]))
    assert [d.isoformat() for d in got] == case["expect"]


WINDOW_RULES = [
    {"period": "month", "basis": "day", "n": 1},
    {"period": "month", "basis": "day", "n": -1, "holiday_shift": "next"},
    {"period": "month", "basis": "weekday", "n": -1, "weekday": 3},
    {"period": "month", "basis": "business_day", "n": 2, "months": [3, 6, 9, 12]},
    {"period": "week", "weekdays": [0], "interval": 1},
    {"period": "week", "weekdays": [4], "interval": 2, "anchor": "2026-01-02"},
    {"period": "week", "weekdays": [0, 3], "interval": 3},              # 기준 주 없음
    {"period": "quarter", "basis": "before_end_bd", "k": 3},
    {"period": "quarter", "basis": "day", "n": 1, "holiday_shift": "next"},
    {"period": "day", "business_only": True},
]


@pytest.mark.parametrize("rule", WINDOW_RULES, ids=[json.dumps(r) for r in WINDOW_RULES])
def test_dates_do_not_depend_on_the_window(rule):
    """스케줄러는 어제~내일, 화면은 10일 전~75일 뒤를 본다. 어느 쪽이든 같은 날짜여야 한다.

    예전에는 보정으로 구간 안에 들어오는 회차(11/1(일) → 10/30(금))를 좁은 구간에서 놓쳐
    알림이 뜨지 않았다.
    """
    wide = set(recur.occurrences(rule, date(2026, 1, 1), date(2027, 12, 31)))
    assert wide
    day = date(2026, 1, 1)
    while day <= date(2027, 12, 31):
        narrow = recur.occurrences(rule, day - timedelta(days=1), day + timedelta(days=1))
        assert (day in narrow) == (day in wide), day
        day += timedelta(days=1)


def test_set_holidays_swaps_atomically():
    """다른 스레드가 공휴일을 다시 설정하는 중에도 공휴일이 영업일로 보이면 안 된다."""
    chuseok = date(2026, 9, 25)
    stop = threading.Event()

    def churn():
        while not stop.is_set():
            recur.set_holidays(["2030-01-01"])

    t = threading.Thread(target=churn)
    t.start()
    try:
        assert all(not recur.is_business_day(chuseok) for _ in range(20000))
    finally:
        stop.set()
        t.join()
        recur.set_holidays([])


def test_extra_holidays_apply():
    recur.set_holidays(["2026-09-16"])
    try:
        assert not recur.is_business_day(date(2026, 9, 16))
    finally:
        recur.set_holidays([])
    assert recur.is_business_day(date(2026, 9, 16))


@pytest.mark.parametrize("rule", [
    None, [], "month",
    {"period": "year"},
    {"period": "week", "weekdays": []},
    {"period": "week", "weekdays": [7]},
    {"period": "week", "weekdays": [True]},
    {"period": "week", "weekdays": [0], "interval": 0},
    {"period": "week", "weekdays": [0], "anchor": "2026/01/01"},
    {"period": "month", "basis": "business_day", "n": 0},
    {"period": "month", "basis": "business_day", "n": "2"},
    {"period": "month", "basis": "business_day", "n": True},
    {"period": "month", "basis": "day", "n": 32},
    {"period": "month", "basis": "weekday", "n": 1, "weekday": 7},
    {"period": "month", "basis": "before_end", "k": -1},
    {"period": "month", "basis": "nope"},
    {"period": "month", "basis": "day", "n": 1, "months": []},
    {"period": "month", "basis": "day", "n": 1, "months": [13]},
    {"period": "month", "basis": "day", "n": 1, "holiday_shift": "sideways"},
    {"period": "day", "business_only": "yes"},
])
def test_validate_rule_rejects(rule):
    with pytest.raises(recur.RuleError):
        recur.validate_rule(rule)


def test_validate_rule_normalizes_and_drops_unknown_keys():
    out = recur.validate_rule({"period": "week", "weekdays": [4, 0, 4], "interval": 2,
                               "evil": "<script>", "anchor": "2026-09-07"})
    assert out == {"period": "week", "holiday_shift": "prev", "weekdays": [0, 4],
                   "interval": 2, "anchor": "2026-09-07"}


def test_validate_rule_accepts_legacy_format():
    out = recur.validate_rule({"kind": "monthly_business_day", "n": 2})
    assert out["period"] == "month" and out["basis"] == "business_day" and out["n"] == 2


def test_describe():
    assert recur.describe({"period": "month", "basis": "business_day", "n": 2}) == "매월 2번째 영업일"
    assert recur.describe({"period": "week", "weekdays": [0, 2], "interval": 2}) == "격주 월·수요일"
    assert recur.describe({"period": "quarter", "basis": "before_end_bd", "k": 3}) == "매 분기 말 3영업일 전"
