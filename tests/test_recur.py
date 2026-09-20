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
    assert recur.describe({"period": "quarter", "basis": "before_end_bd", "k": 3}) == "매 분기 말일 3영업일 전"


# ---------- 예시 날짜 + 단위로 규칙 고르기 ----------

with open(os.path.join(HERE, "vectors", "suggest.json"), encoding="utf-8") as f:
    SUGGEST = json.load(f)["cases"]

SUGGEST_IDS = ["%s-%s%d" % (c["date"], c["unit"], c["every"]) for c in SUGGEST]


@pytest.mark.parametrize("case", SUGGEST, ids=SUGGEST_IDS)
def test_suggestions_match_the_shared_vectors(case):
    got = recur.suggest(date.fromisoformat(case["date"]), case["unit"], case["every"])
    assert [s["text"] for s in got] == case["expect"]
    assert [s["rule"] for s in got] == case["rules"]


@pytest.mark.parametrize("case", SUGGEST, ids=SUGGEST_IDS)
def test_every_suggestion_is_clean_and_runs_on_that_day(case):
    """화면에 뜬 것 중 무엇을 골라도 "그 날 하는 일" 이어야 한다.

    매일만 예외다 - 날마다 도는 일에 예시 날짜는 뜻이 없다.
    """
    day = date.fromisoformat(case["date"])
    for s in recur.suggest(day, case["unit"], case["every"]):
        assert recur.validate_rule(s["rule"]) == s["rule"]
        if case["unit"] == "day":
            continue
        assert day in recur.occurrences(s["rule"], day - timedelta(days=40), day + timedelta(days=40)), s["text"]


@pytest.mark.parametrize("case", SUGGEST, ids=SUGGEST_IDS)
def test_suggestions_do_not_repeat_themselves(case):
    texts = [s["text"] for s in recur.suggest(date.fromisoformat(case["date"]), case["unit"], case["every"])]
    assert len(texts) == len(set(texts))
    assert len(texts) <= recur.SUGGEST_MAX


def test_the_example_month_decides_which_months_run():
    """간격이 달을 정한다. 9월을 짚고 3달 간격이면 3·6·9·12월이다 (분기 초/말을 고를 일이 없다)."""
    sep, oct_ = date(2026, 9, 30), date(2026, 10, 30)
    assert recur.months_every(sep, 3) == [3, 6, 9, 12]
    assert recur.months_every(oct_, 3) == [1, 4, 7, 10]
    assert recur.months_every(sep, 6) == [3, 9]
    assert recur.months_every(sep, 1) is None
    for rule in [s["rule"] for s in recur.suggest(sep, "month", 3)]:
        assert rule["months"] == [3, 6, 9, 12]


def test_every_unit_offers_something():
    day = date(2026, 9, 30)
    for unit, every in (("day", 1), ("week", 1), ("week", 2), ("month", 1), ("month", 3), ("year", 1)):
        assert recur.suggest(day, unit, every), (unit, every)
    with pytest.raises(recur.RuleError):
        recur.suggest(day, "century", 1)


def test_weekend_example_keeps_its_own_day():
    """토요일을 짚었으면 토요일이 빠지면 안 된다 (휴일 보정 없이)."""
    sat = date(2026, 9, 26)
    got = recur.suggest(sat, "month", 1)
    assert all(s["rule"]["holiday_shift"] == "none" for s in got)
    assert not any("영업일" in s["text"] for s in got)


def test_wording_reads_like_korean():
    assert recur.describe({"period": "month", "basis": "weekday", "n": 1, "weekday": 4}) == "매월 첫째 금요일"
    assert recur.describe({"period": "month", "basis": "before_end", "k": 3}) == "매월 말일 3일 전"
    assert recur.describe({"period": "month", "basis": "before_end_bd", "k": 2}) == "매월 말일 2영업일 전"


def test_daily_wording_puts_calendar_days_first():
    assert recur.describe({"period": "day", "business_only": False}) == "매일"
    assert recur.describe({"period": "day", "business_only": True}) == "매일 · 영업일만"
