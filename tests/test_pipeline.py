# -*- coding: utf-8 -*-
"""빠르게 · 가볍게 만든 자리와, 다른 화면(나중의 휴대폰 앱)이 기댈 약속을 지킨다.

  · 화면에 내보내는 항목 필드는 정해 둔 목록뿐이다 (늘어나는 저장 필드가 새지 않는다)
  · rev 는 일정이 바뀔 때만 바뀐다 (받는 쪽은 이것으로 다시 물을지 정한다)
  · /api/occurrences 는 날짜로 기간을 받고 회차만 가볍게 준다
  · 알림 카드의 그림자 · 결 · 바탕은 한 번 만든 것을 나눠 쓰되, 그림은 예전과 같다
"""
import io
import os
import socket
from datetime import date, timedelta

import pytest
from PIL import ImageChops

import app
import ipc
import store
import toast
from test_api import call

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAILY = {"title": "매일 점검", "kind": "routine", "due_time": "09:00",
         "rule": {"period": "day", "business_only": False}}


# ---------- 화면과의 약속 ----------

def test_overview_tasks_carry_only_the_public_fields():
    """done_dates 는 매일 늘어난다. 화면은 읽지 않으므로 45초마다 실어 보낼 까닭이 없다."""
    t = store.add(DAILY)
    store.set_done(t["id"], date.today().isoformat(), True)
    (row,) = store.overview()["tasks"]
    assert set(row) <= set(store.PUBLIC_TASK_FIELDS)
    for hidden in ("done_dates", "skip_dates", "created", "updated", "done_at"):
        assert hidden not in row
    # 화면(달력 · 전체 관리 · 수정 창)이 읽는 것은 남아 있어야 한다
    assert {"id", "title", "kind", "rule", "done"} <= set(row)


def test_rev_changes_when_and_only_when_the_data_changes():
    first = store.overview()["rev"]
    assert store.overview()["rev"] == first            # 읽기만 하면 그대로
    t = store.add(DAILY)
    after_add = store.overview()["rev"]
    assert after_add != first
    store.set_done(t["id"], date.today().isoformat(), True)
    assert store.overview()["rev"] != after_add
    today = date.today()
    assert store.occurrences(today, today)["rev"] == store.overview()["rev"]


def test_occurrences_are_lean_and_follow_completion(server):
    t = store.add(DAILY)
    store.add({"title": "보고서", "kind": "deadline", "due_date": date.today().isoformat()})
    lo, hi = date.today(), date.today() + timedelta(days=20)
    q = "from=%s&to=%s" % (lo, hi)

    status, body = call(server, "GET", "/api/occurrences?kind=routine&" + q)
    assert status == 200 and body["rev"] == store.overview()["rev"]
    items = body["items"]
    assert len(items) == 21
    assert all(set(i) == {"id", "date", "time", "done"} for i in items)
    assert {i["id"] for i in items} == {t["id"]}
    assert all(lo.isoformat() <= i["date"] <= hi.isoformat() for i in items)

    # 달력에서 완료하면 같은 날짜 회차가 완료로 나온다 (예전에는 달을 넘기기 전까지 그대로였다)
    store.set_done(t["id"], lo.isoformat(), True)
    items = call(server, "GET", "/api/occurrences?kind=routine&" + q)[1]["items"]
    assert [i["done"] for i in items if i["date"] == lo.isoformat()] == [True]

    kinds = {i["id"] for i in call(server, "GET", "/api/occurrences?" + q)[1]["items"]}
    assert len(kinds) == 2                                # kind 를 안 주면 모두


@pytest.mark.parametrize("query", [
    "",                                                   # 기간이 없다
    "from=2026-09-01",
    "from=2026-09-30&to=2026-09-01",                      # 거꾸로
    "from=2026-01-01&to=2029-01-01",                      # 너무 길다
    "from=yesterday&to=2026-02-30",                       # 날짜가 아니다 · 없는 날
    "from=2026-09-01&to=2026-09-30&kind=bogus",
])
def test_occurrences_refuse_a_bad_range(server, query):
    assert call(server, "GET", "/api/occurrences?" + query)[0] == 400


def test_ping_reports_the_contract_versions(server):
    status, body = call(server, "GET", "/api/ping")
    assert status == 200 and body["api"] == app.API_VERSION and body["schema"] == store.SCHEMA_VERSION


# ---------- 창 프로세스와의 약속 ----------

def test_ipc_post_says_none_when_nobody_listens():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    assert ipc.post(port, "/focus", timeout=0.3) is None


# ---------- 알림 카드: 나눠 쓰되 그림은 같다 ----------

@pytest.mark.parametrize("scale", [1.0, 1.25, 2.0])
@pytest.mark.parametrize("height", [120, 187, 260])
def test_sliced_shadow_matches_a_real_blur(scale, height):
    """새 높이마다 흐리지 않고 한 번 흐린 본을 늘려 붙인다. 눈에 보이는 차이가 없어야 한다."""
    toast.set_scale(scale)
    h = int(height * scale)
    real = toast._shadow_sheet(toast.CW, h)
    sliced = toast._shadow(toast.CW, h)
    assert real.size == sliced.size
    worst = max(band[1] for band in ImageChops.difference(real, sliced).getextrema())
    assert worst <= 2, "그림자 차이 %d" % worst


def test_cached_card_face_is_never_drawn_on():
    """바탕을 기억해 두고 나눠 쓴다. 누군가 그 위에 직접 그리면 다음 카드에 글자가 남는다."""
    card = {"title": "보고서 제출", "when": "10:20", "rel": "20분 뒤",
            "on_done": lambda: None, "on_snooze": lambda: None}
    img, _ = toast._card_rgba(card)
    h = img.height - toast.PAD * 2
    before = toast._card_face(toast.CW, h).tobytes()
    toast._card_rgba(card, "done")
    toast._card_rgba(card, "snooze")
    assert toast._card_face(toast.CW, h).tobytes() == before
    assert toast._card_face.__wrapped__(toast.CW, h).tobytes() == before


def test_prewarm_prepares_every_font_a_card_uses():
    toast._font.cache_clear()
    toast.prewarm()
    loaded = toast._font.cache_info().currsize
    toast._card_rgba({"title": "보고서", "when": "09:00", "rel": "지남", "late": True,
                      "on_done": lambda: None, "on_snooze": lambda: None})
    toast._card_rgba({"title": "브리핑", "label": "아침", "rows": [("10:00", "a", False)], "more": 2})
    assert toast._font.cache_info().currsize == loaded, "첫 알림에서 글꼴을 새로 열었다"


# ---------- 화면 코드 ----------

def _js():
    """화면 코드 전부 (app.js · 하늘 sky.js · 돌멩이 pebble.js)."""
    return "\n".join(io.open(os.path.join(ROOT, "web", n), encoding="utf-8").read()
                     for n in ("app.js", "sky.js", "pebble.js"))


def test_background_refresh_does_not_touch_the_settings_form():
    """45초마다 새로 읽을 때 설정 창의 값을 다시 채우면, 고치던 값이 되돌아간다."""
    body = _js().split("function render(o){")[1].split("\n}\n")[0]
    for field in ("#s-lead", "#s-brief", "#s-biz", "#s-auto", "#s-hold"):
        assert field not in body, "render() 가 설정 창 %s 를 덮어쓴다" % field


def test_calendar_routines_are_refetched_when_the_data_changes():
    body = _js().split("function ensureRoutines(y, m){")[1].split("\n}\n")[0]
    assert "STATE.rev" in body, "달력의 반복 회차가 달만 보고 다시 묻지 않는다"


def test_polling_pauses_while_the_window_is_hidden():
    src = _js()
    tail = src.split("const POLL_MS")[1]
    assert "setInterval(() => { if(onScreen()) load(); }, POLL_MS)" in tail
    assert "window.__lsShown" in tail
