# -*- coding: utf-8 -*-
import http.client
import json
import sys
import threading
import types

import pytest

import app
import autostart
import paths
import store


@pytest.fixture
def server():
    srv = app.Server(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def call(port, method, path, body=None, headers=None, token=True, host=None, ctype="application/json"):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    h = {"Host": host or "127.0.0.1:%d" % port}
    if token:
        h["X-TM-Token"] = paths.ipc_token()
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        h["Content-Type"] = ctype
    h.update(headers or {})
    conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
    for k, v in h.items():
        conn.putheader(k, v)
    if data is not None:
        conn.putheader("Content-Length", str(len(data)))
    conn.endheaders(data)
    r = conn.getresponse()
    raw = r.read()
    conn.close()
    try:
        return r.status, json.loads(raw)
    except ValueError:
        return r.status, raw


TASK = {"title": "보고서", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:00"}


# ---------- 막아야 하는 것 ----------

def test_index_carries_token_for_the_page(server):
    status, body = call(server, "GET", "/", token=False)
    assert status == 200
    assert paths.ipc_token().encode() in body and b"__TM_TOKEN__" not in body


def test_api_requires_token(server):
    assert call(server, "GET", "/api/overview", token=False)[0] == 403
    assert call(server, "GET", "/api/overview", headers={"X-TM-Token": "0" * 64})[0] == 403
    assert call(server, "POST", "/api/task", TASK, token=False)[0] == 403
    assert not store.tasks()


def test_cross_site_simple_request_is_rejected(server):
    """예전에는 아무 웹 페이지가 text/plain 으로 보내도 일정이 추가·삭제됐다."""
    evil = {"Origin": "https://evil.example"}
    assert call(server, "POST", "/api/task", TASK, headers=evil, token=False, ctype="text/plain")[0] == 403
    assert call(server, "POST", "/api/task", TASK, headers=evil)[0] == 403      # 비밀값이 새도 출처로 한 번 더
    assert call(server, "POST", "/api/task", TASK, ctype="text/plain")[0] == 415
    assert not store.tasks()


def test_dns_rebinding_host_is_rejected(server):
    assert call(server, "GET", "/api/overview", host="evil.example:%d" % server)[0] == 403
    assert call(server, "GET", "/", host="evil.example:%d" % server, token=False)[0] == 403


def test_side_effects_are_not_reachable_by_get(server):
    assert call(server, "GET", "/api/open")[0] == 404
    assert call(server, "GET", "/api/hidden")[0] == 404
    assert call(server, "GET", "/api/quit")[0] == 404


@pytest.mark.parametrize("path", ["/../app.py", "/%2e%2e/app.py", "/..%5capp.py", "/web/../../app.py"])
def test_static_files_cannot_escape_web_dir(server, path):
    assert call(server, "GET", path, token=False)[0] == 404


# ---------- 입력 확인 ----------

def test_invalid_input_gets_a_readable_400(server):
    status, body = call(server, "POST", "/api/task", dict(TASK, due_time="abc"))
    assert status == 400 and "시각" in body["error"]
    assert call(server, "POST", "/api/task", b"{not json")[0] == 400
    assert call(server, "POST", "/api/task", [1, 2])[0] == 400
    assert not store.tasks()


def test_oversized_body_is_refused_before_reading(server):
    # 길이만 크게 알린다. 서버는 본문을 읽기 전에 거절해야 한다.
    # (실제로 큰 본문을 보내면 Windows 가 거절 뒤 남은 전송을 끊어 결과를 못 읽는다)
    status, _ = call(server, "POST", "/api/task", b"{}",
                     headers={"Content-Length": str(app.MAX_BODY + 1)})
    assert status == 413


def test_all_accepts_a_range_and_refuses_a_silly_one(server):
    """달력이 보고 있는 달만 물어본다. 기간이 길수록 반복 규칙을 그만큼 펼쳐야 한다."""
    store.add({"title": "매일", "kind": "routine", "due_time": "09:00",
               "rule": {"period": "day", "business_only": True}})
    short = call(server, "GET", "/api/all?back=0&ahead=10")[1]["items"]
    long_ = call(server, "GET", "/api/all?back=0&ahead=40")[1]["items"]
    assert len(long_) > len(short)
    assert call(server, "GET", "/api/all?back=0&ahead=9999")[0] == 400
    assert call(server, "GET", "/api/all?ahead=abc")[0] == 400
    # 기간을 안 주면 예전처럼 동작한다
    assert call(server, "GET", "/api/all")[0] == 200


def test_show_routines_is_a_real_setting(server):
    """달력의 반복 표시는 껐다 켠 것이 남아야 한다."""
    assert call(server, "POST", "/api/settings", {"show_routines": False})[0] == 200
    assert store.settings()["show_routines"] is False
    assert call(server, "POST", "/api/settings", {"show_routines": "yes"})[0] == 400


def test_bad_settings_do_not_touch_autostart(server, monkeypatch):
    calls = []
    monkeypatch.setattr(autostart, "set_enabled", lambda on: calls.append(on))
    status, body = call(server, "POST", "/api/settings", {"notify_min": "abc", "autostart": True})
    assert status == 400 and calls == []
    assert call(server, "POST", "/api/settings", {"autostart": "yes"})[0] == 400 and calls == []


def test_unknown_task_is_404(server):
    assert call(server, "POST", "/api/task/nope", {"title": "x"})[0] == 404
    assert call(server, "POST", "/api/task/nope/done", {"done": True})[0] == 404


# ---------- 정상 동작 ----------

def test_task_lifecycle(server):
    status, t = call(server, "POST", "/api/task", TASK)
    assert status == 200
    tid = t["id"]
    assert call(server, "POST", "/api/task/%s/done" % tid, {"date": "2026-09-15", "done": True})[1]["done"]
    assert call(server, "POST", "/api/task/%s/done" % tid, {"date": "2026-09-15", "done": True})[1]["done"]
    assert call(server, "POST", "/api/task/%s" % tid, {"title": "고침"})[1]["title"] == "고침"
    assert call(server, "POST", "/api/task/%s/delete" % tid, {})[0] == 200
    status, o = call(server, "GET", "/api/overview")
    assert status == 200 and o["tasks"] == []


def test_overview_survives_a_bad_record(server):
    with store.transaction() as d:
        d["tasks"].append({"id": "bad", "title": "깨짐", "kind": "deadline",
                           "due_date": "2026-09-15", "due_time": "abc"})
    status, o = call(server, "GET", "/api/overview")
    assert status == 200 and [t["id"] for t in o["tasks"]] == ["bad"]


def test_preview_reports_rule_errors_and_uses_today_as_anchor(server):
    status, body = call(server, "POST", "/api/preview", {"rule": {"period": "week", "weekdays": []}})
    assert status == 200 and "요일" in body["error"]
    status, body = call(server, "POST", "/api/preview",
                        {"rule": {"period": "week", "weekdays": [0, 1, 2, 3, 4], "interval": 2}})
    assert status == 200 and len(body["dates"]) == 5 and "격주" in body["text"]


# ---------- 창 프로세스(ui.py) 와의 약속 ----------

@pytest.fixture
def ui_server(monkeypatch):
    sys.modules.setdefault("webview", types.ModuleType("webview"))   # 창 없이 핸들러만 시험
    import ui
    focused, destroyed = [], []
    monkeypatch.setattr(ui, "focus", lambda: focused.append(1))
    monkeypatch.setattr(ui, "_destroy_all", lambda: destroyed.append(1))
    srv = app.Server(("127.0.0.1", 0), ui.FocusHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(app, "UI_PORT", srv.server_address[1])
    yield srv.server_address[1], focused, destroyed
    srv.shutdown()
    srv.server_close()


def test_window_ipc_requires_token(ui_server):
    port, focused, destroyed = ui_server
    assert call(port, "POST", "/focus", token=False)[0] == 403
    assert call(port, "POST", "/quit", headers={"Origin": "https://evil.example"})[0] == 403
    assert call(port, "GET", "/quit")[0] == 405
    assert call(port, "POST", "/focus", host="evil.example:%d" % port)[0] == 403
    assert focused == [] and destroyed == []


def test_service_can_focus_the_window(ui_server):
    port, focused, _ = ui_server
    assert app.focus_ui() is True and focused == [1]
