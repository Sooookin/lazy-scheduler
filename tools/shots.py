# -*- coding: utf-8 -*-
"""화면을 하나씩 열어 두고 PNG 로 찍는다.

    python tools/shots.py            design/shots/*.png 로 전부
    python tools/shots.py cal add    고른 것만

실제 일정은 건드리지 않는다. 임시 APPDATA 에 본보기 자료를 심고 그 위에서 찍는다.
빛은 한낮(11시)으로 못 박는다 - 밤에 찍으면 밤 색을 기준으로 디자인하게 된다.
"""
import io
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "design", "shots")
PORT = 8798
W, H = 960, 592                                 # 실제 창과 같은 규격으로 찍는다

# 찍을 화면. 이름은 app.js 의 shotHook 과 같아야 한다.
SHOTS = [
    ("home",     "홈 · 오늘"),
    ("night",    "홈 · 한밤"),
    ("cal",      "달력"),
    ("add",      "새 항목 · 할 일"),
    ("add-rt",   "새 항목 · 루틴"),
    ("add-memo", "새 항목 · 메모"),
    ("time",     "시각 고르기"),
    ("edit",     "항목 수정"),
    ("day",      "하루 목록"),
    ("manage",   "전체 항목 관리"),
    ("settings", "설정"),
    ("ctx",      "오른쪽 단추 차림표"),
    ("undo",     "되돌리기"),
]


def browser():
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(p):
            return p
    raise SystemExit("크롬이나 엣지를 찾지 못했다")


def seed():
    """본보기 자료. 실제 쓰는 모양에 가깝게 - 빈 화면을 찍으면 볼 것이 없다.

    날마다 도는 루틴에 business_only 를 걸지 않는다. 걸어 두면 갈무리를 돌린 날이
    주말이나 공휴일일 때(실제로 추석에 걸렸다) 오늘 칸이 통째로 비어, 디자인을
    맡길 그림에 아무것도 안 남는다."""
    import store
    t = date.today()
    D = lambda k: (t + timedelta(days=k)).isoformat()
    for title, tm, rule in [
        ("아침운용현황 출력(대표님 전달) 및 부문 메일 송부", "08:30", {"period": "day", "business_only": False}),
        ("교보생명 802807 컴플 체크리스트 송부", "08:40", {"period": "day", "business_only": False}),
        ("퇴연 RA 비즈니스 미팅", "10:00", {"period": "month", "basis": "weekday", "weekday": 3, "n": -1}),
        ("팀장님 해외통합 업데이트", "10:35", {"period": "day", "business_only": False}),
        ("국내 일임 매매", "15:00", {"period": "day", "business_only": False}),
        ("일일 마감 점검", "18:30", {"period": "day", "business_only": False}),
        ("하나은행 월간운용보고서 작성", "11:00", {"period": "month", "basis": "business_day", "n": 1}),
        ("홍콩 수익자 요청 정리", "14:00", {"period": "month", "basis": "weekday", "weekday": 0, "n": 3}),
    ]:
        store.add({"title": title, "kind": "routine", "due_time": tm, "rule": rule})
    for title, k, tm in [("월간 운용보고서 초안 검토", 0, ""), ("출장 경비 정산", 0, ""),
                         ("월간 운용보고서 제출", 2, "17:00"), ("교보생명 분기 자료", 6, "15:00"),
                         ("리스크 한도 점검표 회신", -1, "09:00")]:
        store.add({"title": title, "kind": "deadline", "due_date": D(k), "due_time": tm})
    for m in ["멀모 해외 리밸 내역", "운용시스템-8U3150 주간 코멘트 추가", "운시-설정해지 반영"]:
        store.add({"title": m, "kind": "floating"})


def main(argv):
    want = [a for a in argv if not a.startswith("-")]
    box = tempfile.mkdtemp(prefix="ls-shots-")
    os.environ["APPDATA"] = box
    sys.path.insert(0, ROOT)
    import paths, app                                     # noqa: E402
    assert paths.DATA_DIR.startswith(box), "모래상자 밖이다 - 멈춘다"
    seed()

    srv = app.Server(("127.0.0.1", PORT), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    time.sleep(.6)

    if not os.path.isdir(OUT):
        os.makedirs(OUT)
    exe, done = browser(), []
    for name, label in SHOTS:
        if want and name not in want:
            continue
        png = os.path.join(OUT, "%s.png" % name)
        prof = tempfile.mkdtemp(prefix="ls-prof-")
        try:
            subprocess.run([
                exe, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                "--user-data-dir=" + prof, "--no-first-run", "--no-default-browser-check",
                "--force-device-scale-factor=2",              # 2배로 찍어 또렷하게
                "--window-size=%d,%d" % (W, H),
                "--virtual-time-budget=6000",
                "--screenshot=" + png,
                "http://127.0.0.1:%d/#shot=%s" % (PORT, name),
            ], timeout=90, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        finally:
            shutil.rmtree(prof, ignore_errors=True)
        ok = os.path.exists(png) and os.path.getsize(png) > 9000
        done.append((name, label, ok, os.path.getsize(png) if os.path.exists(png) else 0))
        sys.stdout.buffer.write(("  %-9s %-18s %s %d bytes\n" % (
            name, label, "ok " if ok else "BLANK?", done[-1][3])).encode("utf-8"))

    srv.shutdown()
    bad = [d for d in done if not d[2]]
    sys.stdout.buffer.write(("\n%d장, 의심 %d장 -> %s\n" % (len(done), len(bad), OUT)).encode("utf-8"))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
