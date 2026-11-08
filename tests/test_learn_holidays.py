# -*- coding: utf-8 -*-
"""걸린 시간 배우기 (state.json · 빈 때 셈) 와 공휴일 표 받기 (desktop/holidays.py · tools/fetch_holidays.py)."""
import hashlib
import json
import os
import sys
from datetime import date, datetime, timedelta

import pytest

from core import recur, store
from desktop import app, holidays

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import fetch_holidays  # noqa: E402

TODAY = date.today()
AT = lambda hm: datetime.combine(TODAY, datetime.strptime(hm, "%H:%M").time())


def _routine(title, tm):
    return store.add({"title": title, "kind": "routine", "due_time": tm, "rule": {"period": "day", "business_only": False}})


def _wipe_state():
    s = store._read_state()
    s.pop("dur", None); s.pop("last", None)
    store._write_json(store.STATE, s)


# ---------- 걸린 시간 ----------

def test_duration_runs_from_the_later_of_its_time_and_the_previous_done():
    _wipe_state()
    a, b = _routine("아침 출력", "09:00"), _routine("  보고서   작성 ", "09:30")
    at = lambda dd, hm: datetime.combine(dd, datetime.strptime(hm, "%H:%M").time())
    for k in (2, 1, 0):                                           # 한 회차는 한 기록 - 세 날에 걸쳐 (지난날부터) 쌓는다
        dd = TODAY - timedelta(days=k)
        store.set_done(a["id"], dd.isoformat(), True, now=at(dd, "09:50"))    # 09:00 → 09:50 = 50분
        store.set_done(b["id"], dd.isoformat(), True, now=at(dd, "10:30"))    # 09:30 이 아니라 앞 일을 끝낸 09:50 부터 = 40분
    assert store.durations() == {"아침 출력": 50, "보고서 작성": 40}   # 이름은 공백을 접고 소문자로 견준다
    # 되돌리면 그 회차의 기록이 빠지고 (둘 남음 → 아직 모름), '앞서 끝낸 때' 도 되돌아간다
    store.set_done(b["id"], TODAY.isoformat(), False, now=at(TODAY, "10:31"))
    assert "보고서 작성" not in store.durations()
    assert store._read_state()["last"]["m"] == 9 * 60 + 50


def test_duration_needs_three_samples_and_drops_outliers():
    _wipe_state()
    t = _routine("마감 점검", "15:00")
    day = TODAY.isoformat()
    store.set_done(t["id"], day, True, now=AT("15:01"))          # 1분: 미리 해 두고 누른 것 - 버린다
    store.set_done(t["id"], day, False, now=AT("15:02"))
    store.set_done(t["id"], day, True, now=AT("19:00"))          # 4시간: 끝냄을 잊은 것 - 버린다
    assert store.durations() == {}


def test_next_gap_uses_learned_lengths():
    t = lambda tm, i, title: {"id": i, "date": "d", "time": tm, "done": False, "title": title}
    todays = [t("15:00", "me", "매매"), t("15:40", "x", "보고서 검토")]
    # 모두 30분이면 16:10 (15:40 + 30), 검토가 70분 걸린다는 것을 알면 16:50
    assert app.next_gap(todays, 14 * 60 + 50, skip=("me", "d"), base=15 * 60, end="18:00", title="매매") == "16:10"
    assert app.next_gap(todays, 14 * 60 + 50, skip=("me", "d"), base=15 * 60, end="18:00",
                        dur={"보고서 검토": 70}, title="매매") == "16:50"
    # 옮길 일 자신이 길면 하루 끝 앞에 들어갈 자리가 없다
    assert app.next_gap(todays, 16 * 60 + 50, skip=("me", "d"), end="18:00", dur={"매매": 60}, title="매매") is None


# ---------- 공휴일 표 ----------

def test_fetch_script_reads_the_api_shapes():
    one = {"response": {"body": {"items": {"item": {"isHoliday": "Y", "locdate": 20280126, "dateName": "설날"}}}}}
    many = {"response": {"body": {"items": {"item": [
        {"isHoliday": "Y", "locdate": 20280125, "dateName": "설날"},
        {"isHoliday": "N", "locdate": 20280501, "dateName": "근로자의 날"}]}}}}
    empty = {"response": {"body": {"items": ""}}}
    assert fetch_holidays.items_of(one) == {"2028-01-26": "설날"}
    assert fetch_holidays.items_of(many) == {"2028-01-25": "설날"}
    assert fetch_holidays.items_of(empty) == {}


def test_fetch_script_writes_only_on_change(tmp_path):
    out = tmp_path / "holidays.json"
    doc = fetch_holidays.build({"2028-01-26": "설날"})
    assert fetch_holidays.write(doc, str(out)) is True
    assert fetch_holidays.write(doc, str(out)) is False
    body = out.read_bytes()
    assert (tmp_path / "holidays.json.sha256").read_text(encoding="ascii").split()[0] == hashlib.sha256(body).hexdigest()
    assert holidays.parse(json.loads(body)) == {"2028-01-26": "설날"}


def test_shipped_table_parses():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "holidays.json")
    with open(p, "rb") as f:
        body = f.read()
    with open(p + ".sha256", encoding="ascii") as f:
        assert f.read().split()[0] == hashlib.sha256(body).hexdigest()
    assert holidays.parse(json.loads(body))


@pytest.mark.parametrize("bad", [
    {"v": 2, "days": {"2028-01-26": "설날"}},
    {"v": 1, "days": {}},
    {"v": 1, "days": {"2028-1-26": "설날"}},
    {"v": 1, "days": {"2099-01-01": "먼 날"}},
    {"v": 1, "days": {"2028-01-26": ""}},
])
def test_parse_refuses_wrong_tables(bad):
    with pytest.raises(ValueError):
        holidays.parse(bad)


def test_apply_adds_new_days_to_data_and_takes_back_only_ours():
    y = TODAY.year + 1
    new, mine = "%d-04-15" % y, "%d-04-16" % y
    with store.transaction() as d:
        d["holidays"] = [mine]                                    # 사람이 손으로 더한 날
    known = sorted(recur.DEFAULT_HOLIDAYS)[-1]
    holidays.apply({new: "임시공휴일", known: "성탄절"})
    got = store.load()["holidays"]
    assert new in got and mine in got and known not in got        # 기본 표에 있는 날은 넣지 않는다
    assert recur.HOLIDAY_NAMES[new] == "임시공휴일"
    assert not recur.is_business_day(date.fromisoformat(new))
    holidays.apply({known: "성탄절"})                              # 표에서 빠지면 우리가 넣은 것만 거둔다
    got = store.load()["holidays"]
    assert new not in got and mine in got
    assert holidays.status()["got"] == TODAY.isoformat()
