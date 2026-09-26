# -*- coding: utf-8 -*-
"""'LazyScheduler' 앱 창 (네이티브 WebView2 창). 서비스와 별도 프로세스로 뜬다."""
import ctypes, ctypes.wintypes, hashlib, os, socket, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import webview

import ipc
import paths
import win32

BASE = paths.APP_DIR
HOST, SERVICE_PORT = ipc.HOST, ipc.SERVICE_PORT
SERVICE_URL = f"http://{HOST}:{SERVICE_PORT}/"


class Api:
    """자체 타이틀바 버튼."""

    def minimize(self):
        w = webview.windows[0]
        w.minimize()

    def toggle_max(self):
        """최대화 <-> 복원. 상태는 창에 직접 물어본다.

        예전에는 파이썬 쪽에 _maxed 를 기억해 뒀는데, Win+Up 이나 제목줄
        두 번 누르기로 최대화하면 그 값이 실제와 어긋나 버튼이 먹지 않았다.
        """
        h = hwnd()
        if not h:
            return False
        maxed = bool(_U.IsZoomed(h))
        if maxed:
            _restore(h)
        else:
            _normal[0] = _rect(h)
            _U.ShowWindow(h, SW_MAXIMIZE)
        return not maxed

    def begin_move(self):
        """제목줄을 눌렀다. 마우스를 뗄 때까지 창이 따라온다 (최대화 중이면 먼저 복원)."""
        threading.Thread(target=_move_loop, daemon=True).start()

    def is_max(self):
        h = hwnd()
        return bool(h and _U.IsZoomed(h))

    def begin_resize(self, edge):
        """창 가장자리를 눌렀다 (화면의 .grip). 마우스를 뗄 때까지 창 크기를 따라 바꾼다."""
        if edge in _EDGES:
            threading.Thread(target=_resize_loop, args=(edge,), daemon=True).start()

    def close(self):
        """창을 없애지 않고 숨긴다.

        창을 파괴하면 프로세스가 끝나고, 다시 열 때 WebView2 초기화를 처음부터
        해야 해서 몇 초가 걸린다. 숨겨두면 다음 열기가 즉시 끝난다.
        완전히 끄는 것은 트레이의 "완전히 종료" 가 담당한다.
        """
        hide()


# 창을 보이고 숨기는 일은 Win32 로 직접 한다.
# pywebview 의 show/restore 는 UI 스레드에서 부르도록 만들어져 있어서, 포커스
# 요청을 받은 HTTP 스레드에서 부르면 조용히 아무 일도 일어나지 않았다.
# (최소화된 창에 열기를 눌러도 그대로 최소화 상태로 남던 원인)
_U = ctypes.windll.user32
SW_HIDE, SW_MAXIMIZE, SW_SHOW, SW_RESTORE = 0, 3, 5, 9
MONITOR_DEFAULTTONEAREST = win32.MONITOR_DEFAULTTONEAREST
SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x0001, 0x0004, 0x0010


# 핸들을 돌려주는 함수는 restype 을 밝혀 둬야 한다. 기본값(c_int)이면
# 64비트에서 핸들 위쪽 절반이 잘려 엉뚱한 값이 된다.
_U.MonitorFromPoint.restype = ctypes.c_void_p
_U.MonitorFromWindow.restype = ctypes.c_void_p

_placed = [False]

# ── 창 크기 조절 ──
# 테두리 없는 창(frameless)이라 Windows 가 주는 크기 조절 테두리가 없다. 화면이
# 가장자리에 보이지 않는 손잡이(.grip)를 깔아 두고, 누르면 여기서 마우스를 따라
# 창 크기를 바꾼다. 손을 뗄 때까지만 돈다.
#
# 화면은 창 크기에 비례해서 커지고 작아진다. 기준 크기(BASE)에서 배율 1 이고,
# 가로 · 세로 중 덜 늘어난 쪽을 따른다 - 그래야 어느 쪽으로 늘려도 넘치지 않고,
# 더 늘어난 쪽은 목록 · 달력이 넓어지는 데 쓰인다. 배율은 WebView2 자체의
# 확대(ZoomFactor)라서 글자 · 선 · 하늘이 흐려지지 않고 그 크기로 새로 그려진다.
BASE_W, BASE_H = 960, 592
# 처음 뜨는 크기. 기준보다 조금 크게 - 화면도 그 비율(가로 · 세로 중 작은 쪽, 1.09)로 커져 뜬다.
# 기준의 가로:세로를 이 크기와 같게 두어야 높이를 줄여도 글자가 함께 작아지지 않는다.
DEFAULT_W, DEFAULT_H = 1050, 648
MIN_W, MIN_H = 720, 480
ZOOM_MIN, ZOOM_MAX = 0.75, 2.0
_EDGES = ("l", "r", "t", "b", "tl", "tr", "bl", "br")
VK_LBUTTON = 0x01
_zoom = [1.0]


def _scale(h):
    try:
        return (_U.GetDpiForWindow(h) or 96) / 96.0
    except Exception:
        return 1.0


def _rect(h):
    r = ctypes.wintypes.RECT()
    _U.GetWindowRect(h, ctypes.byref(r))
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


# 최대화하기 직전의 창 자리와 크기. 복원할 때 Windows 에 맡기지 않고 여기로 되돌린다 -
# 테두리 없는 창은 창 틀(WinForms)이 기억하는 복원 크기가 실제와 어긋나는 때가 있다.
_normal = [None]
_busy = [False]          # 끌어서 옮기거나 크기를 바꾸는 중 (배율 감시가 끼어들지 않게)


def _restore(h, keep_pos=True):
    _U.ShowWindow(h, SW_RESTORE)
    n = _normal[0]
    if n:
        x, y, w, ht = n
        if not keep_pos:
            x, y = _rect(h)[:2]
        _U.SetWindowPos(h, None, x, y, w, ht, SWP_NOZORDER | SWP_NOACTIVATE)


def _move_loop():
    """제목줄 끌기. pywebview 의 끌기(pywebview-drag-region)는 페이지 좌표로 창
    자리를 셈하는데 화면 배율(ZoomFactor)을 모른다 - 배율이 1 이 아니면 끄는 순간
    창이 튀었고, 최대화(배율 1.8) 상태에서 끌면 최대화 크기 그대로 엉뚱한 자리로
    옮겨져 이상한 창이 됐다. 여기서는 마우스 자리(화면 픽셀)만 본다.

    최대화 중에 끌면 Windows 처럼 먼저 원래 크기로 돌아오고, 누른 자리가 제목줄의
    같은 비율 위치에 오도록 창이 마우스 아래로 온다."""
    h = hwnd()
    if not h:
        return
    p = ctypes.wintypes.POINT()
    if not _U.GetCursorPos(ctypes.byref(p)):
        return
    x0, y0 = p.x, p.y
    L, T, w, ht = _rect(h)
    maxed = bool(_U.IsZoomed(h))
    _busy[0] = True
    try:
        while _U.GetAsyncKeyState(VK_LBUTTON) & 0x8000:
            if _U.GetCursorPos(ctypes.byref(p)):
                dx, dy = p.x - x0, p.y - y0
                if maxed:
                    if abs(dx) + abs(dy) >= 6:              # 두 번 누르기와 구별한다
                        fx = (x0 - L) / float(max(1, w))
                        _restore(h, keep_pos=False)
                        _, _, w, ht = _rect(h)
                        L, T = p.x - int(fx * w), p.y - (y0 - T)
                        x0, y0 = p.x, p.y
                        _U.SetWindowPos(h, None, L, T, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
                        maxed = False
                elif dx or dy:
                    _U.SetWindowPos(h, None, L + dx, T + dy, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
            time.sleep(0.008)
    finally:
        _busy[0] = False
    _fit_dpi(h)


# ── 모니터마다 다른 배율 ──
# 창 프로세스는 모니터별 배율을 안다고 선언한다 (Per-Monitor v2, main 에서). 예전의
# "시스템 배율" 모드에서는 배율이 다른 모니터로 옮기면 Windows 가 원래 배율로 그린
# 그림을 늘려서 보여 줘 곡선 · 글자가 뿌옇게 됐다. 이제 WebView2 가 옮겨 간 모니터의
# 배율로 새로 그린다. 창 크기는 Windows 가 바꿔 주지 않으므로, 배율이 바뀌면 여기서
# 같은 논리 크기가 되도록 맞춘다 (100% 모니터의 1050px 창이 150% 모니터에서도 1050).
_dpi = [0]


def _fit_dpi(h=None):
    h = h or hwnd()
    if not h:
        return
    d = _U.GetDpiForWindow(h) or 96
    old, _dpi[0] = _dpi[0], d
    if not old or old == d or _U.IsZoomed(h):
        return
    x, y, w, ht = _rect(h)
    k = d / float(old)
    nw, nh = int(round(w * k)), int(round(ht * k))
    # 마우스가 있던 자리(보통 제목줄)를 기준으로 줄이고 늘린다 - 창이 손에서 빠져나가지 않게
    p = ctypes.wintypes.POINT()
    if _U.GetCursorPos(ctypes.byref(p)) and x <= p.x <= x + w and y <= p.y <= y + ht:
        x = p.x - int((p.x - x) * k)
        y = p.y - int((p.y - y) * k)
    _U.SetWindowPos(h, None, x, y, nw, nh, SWP_NOZORDER | SWP_NOACTIVATE)
    paths.log("ui: 모니터 배율 %d → %d, 창을 %dx%d 로 맞췄다" % (old, d, nw, nh))


def watch_dpi():
    """Win+Shift+방향키처럼 끌지 않고 모니터를 옮기는 때도 잡는다 (0.5초마다 본다)."""
    while True:
        time.sleep(0.5)
        try:
            if not _busy[0]:
                _fit_dpi()
        except Exception:
            pass


def _resize_loop(edge):
    h = hwnd()
    if not h or _U.IsZoomed(h):
        return
    r, p = ctypes.wintypes.RECT(), ctypes.wintypes.POINT()
    if not (_U.GetWindowRect(h, ctypes.byref(r)) and _U.GetCursorPos(ctypes.byref(p))):
        return
    L, T, R, B, x0, y0 = r.left, r.top, r.right, r.bottom, p.x, p.y
    s = _scale(h)
    mw, mh = int(MIN_W * s), int(MIN_H * s)
    last = None
    _busy[0] = True
    try:
        _resize_drag(h, edge, L, T, R, B, x0, y0, mw, mh, p, last)
    finally:
        _busy[0] = False


def _resize_drag(h, edge, L, T, R, B, x0, y0, mw, mh, p, last):
    while _U.GetAsyncKeyState(VK_LBUTTON) & 0x8000:
        if _U.GetCursorPos(ctypes.byref(p)):
            dx, dy = p.x - x0, p.y - y0
            l, t, rr, b = L, T, R, B
            if "l" in edge:
                l = min(L + dx, R - mw)
            if "r" in edge:
                rr = max(R + dx, L + mw)
            if "t" in edge:
                t = min(T + dy, B - mh)
            if "b" in edge:
                b = max(B + dy, T + mh)
            if (l, t, rr, b) != last:
                last = (l, t, rr, b)
                _U.SetWindowPos(h, None, l, t, rr - l, b - t, SWP_NOZORDER | SWP_NOACTIVATE)
        time.sleep(0.012)


def zoom_for(w, h):
    """창 안쪽 크기(논리 px)에 맞는 화면 배율."""
    return max(ZOOM_MIN, min(ZOOM_MAX, min(w / float(BASE_W), h / float(BASE_H))))


def apply_zoom(w=None, h=None):
    """창 크기에 맞춰 화면 배율을 바꾼다. 거의 같으면 건드리지 않는다."""
    win = _WINDOW[0]
    form = getattr(win, "native", None) if win else None
    if form is None:
        return
    if w is None or h is None:
        hh = hwnd()
        rc = ctypes.wintypes.RECT()
        if not hh or not _U.GetClientRect(hh, ctypes.byref(rc)):
            return
        s = _scale(hh)
        w, h = rc.right / s, rc.bottom / s
    z = round(zoom_for(w, h), 3)
    if abs(z - _zoom[0]) < 0.004:
        return
    _zoom[0] = z
    try:
        from System import Func, Type        # pythonnet - pywebview 가 이미 불러 두었다

        def _set():
            form.browser.webview.ZoomFactor = z
        form.Invoke(Func[Type](_set))
    except Exception:
        paths.log("ui.apply_zoom 실패: " + traceback.format_exc())


def place_once():
    """창을 처음 보일 때 지금 쓰고 있는 모니터 한가운데에 놓는다.

    pywebview 는 핸들이 생긴 뒤에야 StartPosition 을 CenterScreen 으로 바꾼다.
    WinForms 는 그 값을 창을 처음 보일 때 한 번만 보므로 이미 늦었고, 창은
    기본 자리(156,156)에 그대로 남는다. 그래서 직접 놓는다.

    주 모니터가 아니라 마우스가 있는 모니터에 놓는다. 모니터가 둘일 때
    주 모니터에 고정하면 "늘 왼쪽 화면에서 열린다" 가 된다.

    한 번만 한다. 사용자가 옮겨 둔 창을 숨겼다 다시 열 때 제자리로 끌어오면
    옮긴 뜻을 무시하는 것이다.
    """
    if _placed[0]:
        return
    h = hwnd()
    if not h:
        return
    _placed[0] = True
    try:
        if _U.IsZoomed(h):                     # 최대화해 둔 창은 건드리지 않는다
            return
        pt = ctypes.wintypes.POINT()
        mon = None
        if _U.GetCursorPos(ctypes.byref(pt)):
            mon = _U.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
        if not mon:
            mon = _U.MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST)
        mi = win32.monitor_info(mon)
        if mi is None:
            return
        # 크기도 여기서 바로잡는다. pywebview(WinForms)는 배율 125% 에서 요청한 크기보다
        # 6% 가량 작은 창을 만든다 (900×560 을 달라 했는데 885×522 로 떠 있었다).
        s = _scale(h)
        wide, high = int(round(DEFAULT_W * s)), int(round(DEFAULT_H * s))
        work = mi.rcWork
        x = work.left + (work.right - work.left - wide) // 2
        y = work.top + (work.bottom - work.top - high) // 2
        # 창이 모니터보다 크면 가운데로 두었을 때 제목줄이 화면 밖으로 나간다
        x = max(work.left, min(x, work.right - wide))
        y = max(work.top, min(y, work.bottom - high))
        wide, high = min(wide, work.right - work.left), min(high, work.bottom - work.top)
        _U.SetWindowPos(h, None, x, y, wide, high, SWP_NOZORDER | SWP_NOACTIVATE)
        paths.log("ui.place_once: %dx%d 창을 (%d, %d) 에 놓았다" % (wide, high, x, y))
    except Exception:
        paths.log("ui.place_once 실패: " + traceback.format_exc())
_hwnd_cache = None


def hwnd():
    """이 프로세스가 가진 우리 앱의 최상위 창 핸들.

    제목으로 찾는다. 짓는 쪽(아래 create_window)과 찾는 쪽이 같은 값을
    봐야 하므로 둘 다 paths.APP_NAME 을 쓴다 - 예전에는 양쪽에 문자열을
    따로 적어 둬서, 한쪽만 고치면 창을 영영 못 찾는다.
    """
    global _hwnd_cache
    if _hwnd_cache and _U.IsWindow(_hwnd_cache):
        return _hwnd_cache
    from ctypes import wintypes
    me = os.getpid()
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        pid = wintypes.DWORD()
        _U.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value != me:
            return True
        n = _U.GetWindowTextLengthW(h)
        if n:
            b = ctypes.create_unicode_buffer(n + 1)
            _U.GetWindowTextW(h, b, n + 1)
            if b.value == paths.APP_NAME:
                r = wintypes.RECT()
                _U.GetWindowRect(h, ctypes.byref(r))
                found.append((r.right - r.left, h))
        return True

    _U.EnumWindows(cb, 0)
    if not found:
        return None
    _hwnd_cache = max(found)[1]          # 트레이 툴팁 같은 작은 창을 피한다
    return _hwnd_cache


def _tell_hidden():
    """서비스에 "창을 숨겼다" 고 알린다 (안내 카드를 한 번 띄우게)."""
    ipc.post(ipc.SERVICE_PORT, "/api/hidden", body={}, timeout=1.0)


def _tell_page_shown():
    """화면(웹 페이지)에 "다시 보인다" 고 알린다. 숨어 있는 동안 멈춰 둔 새로 읽기를 곧바로 한다.

    Win32 로 직접 숨기고 보이므로 페이지의 visibilitychange 가 오지 않을 수 있다.
    evaluate_js 는 창 스레드의 답을 기다리므로 부른 쪽(HTTP 스레드)을 묶지 않게 따로 돈다.
    """
    w = _WINDOW[0]
    if w is None:
        return

    def run():
        try:
            w.evaluate_js("window.__lsShown && window.__lsShown()")
        except Exception:
            pass                     # 페이지를 다시 읽는 중이면 그쪽이 어차피 새로 읽는다
    threading.Thread(target=run, daemon=True).start()


def hide():
    h = hwnd()
    if h:
        _U.ShowWindow(h, SW_HIDE)
        threading.Thread(target=_tell_hidden, daemon=True).start()


def focus():
    """숨어 있거나 최소화된 창을 다시 보여준다."""
    h = hwnd()
    if not h:
        paths.log("ui.focus: 창 핸들을 찾지 못했다")
        return
    place_once()                 # 보이기 전에 자리를 잡는다 (처음 한 번만)
    _U.ShowWindow(h, SW_SHOW)
    # SW_RESTORE 를 무조건 부르면 최대화해 둔 창이 원래 크기로 줄어든다.
    # 최소화된 것만 되돌린다.
    if _U.IsIconic(h):
        _U.ShowWindow(h, SW_RESTORE)
    _U.SetForegroundWindow(h)
    _U.BringWindowToTop(h)
    _nudge(h)
    apply_zoom()
    _tell_page_shown()


def _nudge(h):
    """숨김·최소화에서 돌아오면 WebView2 가 내용을 다시 그리지 않는 때가 있다.
    창 크기를 1px 흔들어 강제로 다시 그리게 한다."""
    from ctypes import wintypes
    r = wintypes.RECT()
    if not _U.GetWindowRect(h, ctypes.byref(r)):
        return
    w, ht = r.right - r.left, r.bottom - r.top
    SWP_NOZORDER = 0x0004
    _U.SetWindowPos(h, None, r.left, r.top, w - 1, ht - 1, SWP_NOZORDER)
    _U.SetWindowPos(h, None, r.left, r.top, w, ht, SWP_NOZORDER)


def _destroy_all():
    """서비스가 종료를 알려왔을 때 창을 닫는다 → webview.start() 가 반환되며 프로세스 종료."""
    try:
        for w in list(webview.windows):
            w.destroy()
    except Exception:
        pass
    threading.Timer(1.5, lambda: os._exit(0)).start()   # 혹시 안 닫히면 강제


def build_stamp():
    """지금 디스크에 있는 화면 파일들의 지문 (이름 · 크기 · 고친 때)."""
    h = hashlib.sha1()
    seen = 0
    try:
        for root, dirs, files in os.walk(paths.WEB_DIR):
            dirs.sort()
            for name in sorted(files):
                st = os.stat(os.path.join(root, name))
                rel = os.path.relpath(os.path.join(root, name), paths.WEB_DIR)
                h.update(("%s|%d|%d;" % (rel, st.st_size, st.st_mtime_ns)).encode("utf-8", "replace"))
                seen += 1
    except OSError:
        return None
    # 폴더가 없어도 os.walk 는 성을 내지 않고 아무 것도 내놓지 않는다. 업데이트가
    # 지우고 다시 넣는 사이에 부르면 "파일 0개" 라는 멀쩡한 지문이 나오고, 창은
    # 그것을 바뀐 것으로 알고 텅 빈 화면을 읽는다. 하나도 못 봤으면 모른다고 한다.
    return h.hexdigest() if seen else None


_STAMP = [None]
_WINDOW = [None]


def refresh_if_stale():
    """화면 파일이 바뀌었으면 페이지를 다시 읽는다.

    창은 한 번 읽은 페이지를 계속 들고 있다. 그 사이 업데이트가 web/ 를 갈아
    끼우면 서비스는 새 파일을 내보내는데 창만 예전 화면에 머문다. × 를 눌러도
    창 프로세스는 살아 있고, 트레이를 눌러도 app.open_window() 가 focus_ui() 로
    그 창을 앞으로 부를 뿐이다. 결국 창 프로세스를 직접 끝내야만 바뀌었다.

    앞으로 불려 나올 때마다 파일이 바뀐 것을 알아채고 스스로 다시 읽는다.
    """
    now = build_stamp()
    if _WINDOW[0] is None or now is None or _STAMP[0] is None or now == _STAMP[0]:
        return False
    _STAMP[0] = now
    try:
        _WINDOW[0].load_url(SERVICE_URL)
        paths.log("ui: 화면 파일이 바뀌었다 - 페이지를 다시 읽는다")
        return True
    except Exception:
        paths.log("ui: 다시 읽기 실패: " + traceback.format_exc())
        return False


class FocusHandler(BaseHTTPRequestHandler):
    """서비스가 창을 앞으로 부르거나(/focus) 닫을 때(/quit) 쓴다.

    127.0.0.1 포트는 이 PC 의 웹 페이지도 두드릴 수 있으므로 Host 와 비밀값을 확인한다.
    (예전에는 아무 사이트나 이 주소를 불러 창을 닫을 수 있었다)
    """
    def log_message(self, *a):
        pass

    def _reply(self, code, text):
        body = text.encode("ascii")
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_POST(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        if (host not in ("127.0.0.1:%d" % port, "localhost:%d" % port)
                or self.headers.get("Origin") is not None
                or not paths.token_ok(self.headers.get(ipc.TOKEN_HEADER))):
            return self._reply(403, "forbidden")
        path = self.path.split("?")[0]
        if path == "/focus":
            refresh_if_stale()
            focus()
            return self._reply(200, "ok")
        if path == "/reload":
            # 알림 카드에서 완료했다 - 떠 있는 화면이 45초짜리 다음 차례를
            # 기다리는 동안 다 한 일을 안 한 것처럼 보이고 있을 수 있다.
            _tell_page_shown()
            return self._reply(200, "ok")
        if path == "/quit":
            self._reply(200, "ok")
            threading.Timer(0.1, _destroy_all).start()
            return
        self._reply(404, "not found")

    def do_GET(self):
        self._reply(405, "use POST")


# 개발용. LS_DEV 가 켜져 있을 때만 돈다 - 배포본에서는 이 스레드가 아예 뜨지 않는다.
DEV_POLL_S = 1.5


def watch_web():
    """화면 파일이 바뀌면 창이 스스로 다시 읽는다 (고치고 저장하면 그걸로 끝).

    평소에는 앞으로 불려 나올 때(/focus)만 확인한다. 고치는 동안에는 그 한 번을
    사람이 눌러 줘야 해서, 한 줄 고칠 때마다 트레이를 누르게 된다.
    파일 지문만 보므로 바뀐 것이 없으면 아무 일도 하지 않는다.
    """
    paths.log("ui: 개발 모드 - 화면 파일을 %.1f초마다 살핀다" % DEV_POLL_S)
    while True:
        time.sleep(DEV_POLL_S)
        try:
            refresh_if_stale()
        except Exception:
            pass


def watch_service():
    """서비스가 죽었으면 창도 닫는다. 서버 없는 빈 창이 남지 않게."""
    misses = 0
    while True:
        time.sleep(15)
        try:
            with socket.create_connection((HOST, SERVICE_PORT), 1.0):
                misses = 0
        except OSError:
            misses += 1
            if misses >= 3:            # 45초 연속 응답 없음
                _destroy_all()
                return


def already_open():
    """창이 이미 떠 있으면 그 창을 앞으로 불러오고 True."""
    return ipc.post(ipc.UI_PORT, "/focus", timeout=0.4) is not None


def main():
    if already_open():
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("LazyScheduler.App")
    except Exception:
        pass
    # 모니터별 배율을 안다고 먼저 선언한다 (위 "모니터마다 다른 배율"). pywebview 가 나중에
    # 부르는 SetProcessDPIAware(시스템 배율)는 이미 정해졌으므로 아무 일도 하지 않는다.
    try:
        _U.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))     # PER_MONITOR_AWARE_V2
    except Exception:
        pass

    try:
        guard = ThreadingHTTPServer((ipc.HOST, ipc.UI_PORT), FocusHandler)
        threading.Thread(target=guard.serve_forever, daemon=True).start()
        threading.Thread(target=watch_service, daemon=True).start()
        threading.Thread(target=watch_dpi, daemon=True).start()
        if os.environ.get("LS_DEV"):
            threading.Thread(target=watch_web, daemon=True).start()
    except OSError:
        return

    _STAMP[0] = build_stamp()
    _WINDOW[0] = webview.create_window(
        paths.APP_NAME, SERVICE_URL, js_api=Api(),
        # 기준 크기(BASE) 960×592 · 하늘 180. 참고 도안(900×560, 하늘 206)보다 하늘을
        # 위아래로 눌러 낮추고 그만큼을 목록에 준다. 가장자리를 끌어 늘리면 화면이
        # 같은 비율로 커진다 (apply_zoom).
        width=DEFAULT_W, height=DEFAULT_H, min_size=(MIN_W, MIN_H),
        frameless=True, easy_drag=False, background_color="#E9E4DD",
        hidden="--hidden" in sys.argv,      # 자동 실행 때 미리 만들어만 둔다
    )
    # 최대화 · Win+방향키 · 가장자리 끌기 - 어떻게 바뀌든 크기가 바뀌면 배율을 맞춘다.
    # 페이지를 새로 읽어도 배율은 창에 남지만, 처음 한 번은 읽은 뒤에 맞춘다.
    _WINDOW[0].events.resized += lambda width, height: apply_zoom(width, height)
    _WINDOW[0].events.loaded += lambda: apply_zoom()
    if "--hidden" not in sys.argv:
        # 부모 프로세스의 표시 상태가 딸려와 최소화된 채로 뜨는 때가 있다.
        # 창이 만들어진 뒤 한 번 앞으로 불러온다. 창이 생기는 시점이 일정하지
        # 않으므로 잠깐 기다려 준다 (예전엔 너무 일찍 불러 로그만 남았다).
        def _first_focus():
            for _ in range(20):
                if hwnd():
                    focus()
                    return
                time.sleep(0.25)
        threading.Thread(target=_first_focus, daemon=True).start()

    icon = paths.ICON
    try:
        webview.start(icon=icon if os.path.exists(icon) else None)
    except TypeError:
        webview.start()


if __name__ == "__main__":
    main()
