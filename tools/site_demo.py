# -*- coding: utf-8 -*-
"""홈페이지(docs/)의 체험판과 알림 카드 그림을 만든다.

    python tools/site_demo.py

결과: docs/demo/        실제 화면(web/)을 그대로 베끼고, 서비스 대신 demo.js 가 답한다
      docs/card.png     알림 카드 한 장 (toast.py 가 실제로 그리는 그림)

체험판은 서버 없이 돈다. 본보기 일정을 임시 APPDATA 에 심고 실제 서비스 핸들러에게
물어 받은 답(개요 · 달력 회차 · 동기화 상태)을 demo.js 안에 구워 둔다. 날짜는 여는
날에 맞춰 옮기고, 시각은 홈페이지의 막대가 정한다. 완료 · 건너뛰기 · 삭제 · 설정은
그 자리에서만 바뀌고 저장하지 않는다.

화면을 고친 뒤 배포할 때 다시 돌린다 (docs/demo 는 web/ 의 사본이다).
실제 일정은 건드리지 않는다 - 모듈을 불러오기 전에 APPDATA 를 임시 폴더로 돌린다.
"""
import io
import json
import os
import shutil
import sys
import tempfile
import threading
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "web")
DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(DOCS, "demo")

SANDBOX = tempfile.mkdtemp(prefix="ls-demo-")
os.environ["APPDATA"] = SANDBOX
os.environ["LOCALAPPDATA"] = SANDBOX
sys.path.insert(0, ROOT)

# 베낄 화면 파일. 나머지(아이콘 원본 등)는 체험판에 필요 없다.
COPY = ["style.css", "app.js", "sky.js", "pebble.js", "icon-32.png", "fonts"]


def seed():
    """공개 홈페이지에 걸리는 본보기 일정. 누구의 실제 업무도 아닌, 흔한 하루."""
    import store
    t = date.today()
    D = lambda k: (t + timedelta(days=k)).isoformat()
    daily = {"period": "day", "business_only": False}
    for title, tm, rule in [
        ("아침 메일 정리", "08:30", daily),
        ("팀 스탠드업", "09:30", daily),
        ("거래처 주문 확인", "11:00", daily),
        ("오후 자료 점검", "15:00", daily),
        ("하루 마감 정리", "18:00", daily),
        ("월간 보고서 작성", "10:00", {"period": "month", "basis": "business_day", "n": 1}),
        ("월말 비용 정산", "16:00", {"period": "month", "basis": "business_day", "n": -1}),
        ("분기 점검 회의", "14:00", {"period": "month", "basis": "weekday", "weekday": 3, "n": -1,
                                     "months": [3, 6, 9, 12]}),
    ]:
        store.add({"title": title, "kind": "routine", "due_time": tm, "rule": rule})
    for title, k, tm in [("견적서 회신", -1, "09:00"), ("발표 자료 초안", 0, "13:30"),
                         ("주간 보고 제출", 2, "17:00"), ("분기 계획 공유", 6, "15:00"),
                         ("회의실 예약", 0, "")]:
        store.add({"title": title, "kind": "deadline", "due_date": D(k), "due_time": tm})
    for m in ["읽을 책 목록 정리", "새 노트북 알아보기", "여름휴가 숙소 후보"]:
        store.add({"title": m, "kind": "floating"})


def capture():
    """실제 서비스 핸들러에게 묻는다 - 화면이 받는 것과 글자 하나까지 같은 답."""
    import http.client

    import app
    import paths
    srv = app.Server(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]

    def get(path):
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        c.request("GET", path, headers={"X-TM-Token": paths.ipc_token(),
                                        "Host": "127.0.0.1:%d" % port})
        r = c.getresponse()
        body = json.loads(r.read().decode("utf-8"))
        assert r.status == 200, (path, body)
        return body

    t = date.today()
    lo, hi = t - timedelta(days=45), t + timedelta(days=120)   # 달력을 앞뒤로 몇 달 넘겨 볼 만큼
    rng = "from=%s&to=%s" % (lo, hi)
    try:
        return {
            "base": t.isoformat(),
            "overview": get("/api/overview"),
            "occ": get("/api/occurrences?" + rng)["items"],
            "sync": get("/api/sync"),
        }
    finally:
        srv.shutdown()
        srv.server_close()


def card():
    """알림 카드 한 장을 2배로 그린다 (홈페이지에서 반으로 줄여 보여 준다)."""
    import toast
    toast.set_scale(2.0)
    img, _ = toast._card_rgba({"title": "주간 보고 제출", "when": "17:00", "rel": "30분 뒤",
                               "meta": "할 일", "on_done": toast._noop,
                               "on_snooze": toast._noop, "can_open": True})
    img.save(os.path.join(DOCS, "card.png"), optimize=True)
    return img.size


def build(data):
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    for n in COPY:
        src, dst = os.path.join(WEB, n), os.path.join(OUT, n)
        (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, dst)

    html = io.open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    for old, new in [
        ('<meta name="tm-token" content="__TM_TOKEN__">\n', '<meta name="robots" content="noindex">\n'),
        ('<link rel="stylesheet" href="style.css">',
         '<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="demo.css">'),
        ('<script src="app.js"></script>', '<script src="demo.js"></script>\n<script src="app.js"></script>'),
    ]:
        assert html.count(old) == 1, old
        html = html.replace(old, new)
    io.open(os.path.join(OUT, "index.html"), "w", encoding="utf-8", newline="").write(html)

    shim = io.open(os.path.join(HERE, "site_demo.js"), encoding="utf-8").read()
    shim = shim.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    io.open(os.path.join(OUT, "demo.js"), "w", encoding="utf-8", newline="").write(shim)
    shutil.copy2(os.path.join(HERE, "site_demo.css"), os.path.join(OUT, "demo.css"))


def main():
    try:
        seed()
        data = capture()
        build(data)
        size = card()
    finally:
        shutil.rmtree(SANDBOX, ignore_errors=True)
    n = sum(len(f) for _, _, f in os.walk(OUT))
    print("체험판 %s (파일 %d개) · 알림 카드 %dx%d" % (os.path.relpath(OUT, ROOT), n, *size))


if __name__ == "__main__":
    main()
