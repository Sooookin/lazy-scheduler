# -*- coding: utf-8 -*-
"""앱을 실제로 켜 보고 화면을 찍는다 (Windows · macOS). 테스트가 볼 수 없는 것 - 창이 뜨는지,
알림 카드가 그려지는지, 트레이 · 이벤트 루프가 죽지 않는지 - 를 본다.

    python tools/smoke.py                   소스로 켠다
    python tools/smoke.py --exe <실행 파일>   빌드본을 켠다 (macOS 는 .app 안의 Contents/MacOS/LazyScheduler)
    python tools/smoke.py --out <폴더>       찍은 화면을 둘 곳 (기본: design/shots/smoke)

설치된 앱이 돌고 있어도 된다: 데이터 폴더(APPDATA)는 임시 폴더로, 포트는 LS_PORT_BASE 로 비켜
나란히 켠다. 진짜 일정은 건드리지 않는다. GitHub Actions 의 macOS 빌드도 이것으로 확인한다.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 18777
MAC = sys.platform == "darwin"


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def up(port):
    try:
        with socket.create_connection(("127.0.0.1", port), 0.5):
            return True
    except OSError:
        return False


def wait(pred, secs):
    end = time.time() + secs
    while time.time() < end:
        if pred():
            return True
        time.sleep(0.5)
    return False


def shot(path):
    """화면 전체를 찍는다."""
    try:
        if MAC:
            subprocess.run(["screencapture", "-x", path], timeout=20)
        else:
            from PIL import ImageGrab
            ImageGrab.grab(all_screens=True).save(path)
        print("  찍음", path, os.path.exists(path))
    except Exception as e:
        print("  찍지 못함", path, e)


def shot_window(path, exe_hint):
    """앱 창만 찍는다 (Windows). 뒤에서 켠 프로세스는 앞으로 나오지 못해(포커스 제한) 다른 창에
    가려지므로, 화면이 아니라 창 자체를 그리게 한다(PrintWindow). 설치된 앱의 창과 헷갈리지 않게
    실행 파일 이름(exe_hint)으로 고른다."""
    if MAC:
        return
    import ctypes
    from ctypes import wintypes
    from PIL import Image
    u, k = ctypes.windll.user32, ctypes.windll.kernel32
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        b = ctypes.create_unicode_buffer(64)
        u.GetWindowTextW(h, b, 64)
        if b.value != "LazyScheduler" or not u.IsWindowVisible(h):
            return True
        pid = wintypes.DWORD()
        u.GetWindowThreadProcessId(h, ctypes.byref(pid))
        hp = k.OpenProcess(0x1000, False, pid.value)          # PROCESS_QUERY_LIMITED_INFORMATION
        name = ctypes.create_unicode_buffer(520)
        n = wintypes.DWORD(520)
        if hp and k.QueryFullProcessImageNameW(hp, 0, name, ctypes.byref(n)):
            if os.path.basename(name.value).lower().startswith(exe_hint):
                r = wintypes.RECT()
                u.GetWindowRect(h, ctypes.byref(r))
                found.append((r.right - r.left, r.bottom - r.top, h))
        if hp:
            k.CloseHandle(hp)
        return True

    u.EnumWindows(cb, 0)
    if not found:
        print("  앱 창을 찾지 못했다")
        return
    w, h, hwnd = max(found)
    g = ctypes.windll.gdi32
    dc = u.GetWindowDC(hwnd)
    mem = g.CreateCompatibleDC(dc)
    bmp = g.CreateCompatibleBitmap(dc, w, h)
    g.SelectObject(mem, bmp)
    u.PrintWindow(hwnd, mem, 2)                                 # PW_RENDERFULLCONTENT: WebView2 도 그린다
    buf = ctypes.create_string_buffer(w * h * 4)
    g.GetBitmapBits(bmp, len(buf), buf)
    Image.frombuffer("RGBA", (w, h), buf, "raw", "BGRA", 0, 1).convert("RGB").save(path)
    g.DeleteObject(bmp)
    g.DeleteDC(mem)
    u.ReleaseDC(hwnd, dc)
    print("  창을 찍음", path, (w, h))


def call(method, path, token, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"X-TM-Token": token, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    out = os.path.abspath(arg("--out", os.path.join(ROOT, "design", "shots", "smoke")))
    os.makedirs(out, exist_ok=True)
    box = tempfile.mkdtemp(prefix="ls-smoke-")
    env = dict(os.environ, APPDATA=box, LS_PORT_BASE=str(PORT))
    exe = arg("--exe")
    cmd = [exe] if exe else [sys.executable, os.path.join(ROOT, "main.py")]
    print("켠다:", cmd, "데이터:", box)
    proc = subprocess.Popen(cmd, cwd=os.path.dirname(exe) if exe else ROOT, env=env)
    data = os.path.join(box, "LazyScheduler")
    ok = True
    try:
        if not wait(lambda: up(PORT), 90):
            print("실패: 서비스가 포트를 열지 않았다")
            ok = False
            return 1
        print("서비스 떴다")
        token = open(os.path.join(data, "ipc.key"), encoding="ascii").read().strip()
        o = call("GET", "/api/overview", token)
        print("  버전", o.get("version"), "· 할 일", len(o.get("today", []) if isinstance(o.get("today"), list) else []))
        if not wait(lambda: up(PORT + 2), 90):
            print("실패: 창 프로세스가 뜨지 않았다")
            ok = False
        else:
            print("창 떴다")
        time.sleep(6)                                    # 화면이 다 그려지기를
        if MAC:
            shot(os.path.join(out, "window.png"))
        else:
            shot_window(os.path.join(out, "window.png"),
                        os.path.basename(exe).lower()[:8] if exe else "python")
        call("POST", "/api/test-toast", token, {})
        time.sleep(2.5)
        shot(os.path.join(out, "toast.png"))
        call("POST", "/api/quit", token, {})
        if not wait(lambda: not up(PORT) and not up(PORT + 2), 20):
            print("실패: 종료하라고 했는데 포트가 남아 있다")
            ok = False
        else:
            print("곱게 내려갔다")
        return 0 if ok else 1
    finally:
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        log = os.path.join(data, "app.log")
        if os.path.exists(log):
            text = open(log, encoding="utf-8", errors="replace").read()
            shutil.copy(log, os.path.join(out, "app.log"))
            print("---- app.log ----")
            print(text[-6000:])
            if "Traceback" in text:
                print("경고: app.log 에 Traceback 이 있다")
        shutil.rmtree(box, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
