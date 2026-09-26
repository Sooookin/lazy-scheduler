# -*- coding: utf-8 -*-
"""앱 창의 Windows 쪽: 테두리 없는 창을 옮기고 · 늘리고 · 숨기고 · 앞으로 부르고 · 확대한다.

창은 pywebview(WinForms + WebView2)가 만든다. 여기서는 그 창을 Win32 로 직접 다룬다.
공통 일(서비스와 이야기하기, 화면 새로 읽기)은 desktop/ui.py, macOS 쪽은 platforms/mac/window.py.
"""
import ctypes
import ctypes.wintypes
import os
import threading
import time
import traceback

from desktop import paths
from platforms.win import win32

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

_EDGES = ("l", "r", "t", "b", "tl", "tr", "bl", "br")
VK_LBUTTON = 0x01
# attach() 가 채운다: pywebview 창, 처음 크기, 가장 작은 크기 (논리 px)
_WIN = [None]
DEFAULT_W, DEFAULT_H = 1050, 648
MIN_W, MIN_H = 720, 480
# 창 테두리를 우리가 그린다 (화면의 .grip · 제목줄) - pywebview 의 끌기는 쓰지 않는다
CREATE_OPTS = dict(frameless=True, easy_drag=False)


def prepare():
    """창을 만들기 전에: 작업표시줄 묶음 이름, 모니터별 배율을 안다고 먼저 선언.

    pywebview 가 나중에 부르는 SetProcessDPIAware(시스템 배율)는 이미 정해졌으므로
    아무 일도 하지 않는다 (아래 "모니터마다 다른 배율").
    """
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("LazyScheduler.App")
    except Exception:
        pass
    try:
        _U.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))     # PER_MONITOR_AWARE_V2
    except Exception:
        pass


def attach(win, size, min_size):
    """pywebview 창이 만들어졌다."""
    global DEFAULT_W, DEFAULT_H, MIN_W, MIN_H
    _WIN[0] = win
    DEFAULT_W, DEFAULT_H = size
    MIN_W, MIN_H = min_size


def watch():
    """뒤에서 도는 감시 (모니터를 옮겨 배율이 바뀌는 것)."""
    threading.Thread(target=watch_dpi, daemon=True).start()


def minimize():
    w = _WIN[0]
    if w is not None:
        w.minimize()


def toggle_max():
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


def is_max():
    h = hwnd()
    return bool(h and _U.IsZoomed(h))


def begin_move():
    """제목줄을 눌렀다. 마우스를 뗄 때까지 창이 따라온다 (최대화 중이면 먼저 복원)."""
    threading.Thread(target=_move_loop, daemon=True).start()


def begin_resize(edge):
    """창 가장자리를 눌렀다 (화면의 .grip). 마우스를 뗄 때까지 창 크기를 따라 바꾼다."""
    if edge in _EDGES:
        threading.Thread(target=_resize_loop, args=(edge,), daemon=True).start()


# ── 창 크기 조절 ──
# 테두리 없는 창(frameless)이라 Windows 가 주는 크기 조절 테두리가 없다. 화면이
# 가장자리에 보이지 않는 손잡이(.grip)를 깔아 두고, 누르면 여기서 마우스를 따라
# 창 크기를 바꾼다. 손을 뗄 때까지만 돈다.
#
# 화면은 창 크기에 비례해서 커지고 작아진다. 기준 크기(BASE)에서 배율 1 이고,
# 가로 · 세로 중 덜 늘어난 쪽을 따른다 - 그래야 어느 쪽으로 늘려도 넘치지 않고,
# 더 늘어난 쪽은 목록 · 달력이 넓어지는 데 쓰인다. 배율은 WebView2 자체의
# 확대(ZoomFactor)라서 글자 · 선 · 하늘이 흐려지지 않고 그 크기로 새로 그려진다.
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


def client_size():
    """창 안쪽 크기 (논리 px). 모르면 None."""
    hh = hwnd()
    rc = ctypes.wintypes.RECT()
    if not hh or not _U.GetClientRect(hh, ctypes.byref(rc)):
        return None
    s = _scale(hh)
    return rc.right / s, rc.bottom / s


def set_zoom(z):
    """화면 배율 = WebView2 자체의 확대(ZoomFactor). 글자 · 선 · 하늘이 흐려지지 않고 그 크기로 새로 그려진다."""
    win = _WIN[0]
    form = getattr(win, "native", None) if win else None
    if form is None:
        return
    try:
        from System import Func, Type        # pythonnet - pywebview 가 이미 불러 두었다

        def _set():
            form.browser.webview.ZoomFactor = z
        form.Invoke(Func[Type](_set))
    except Exception:
        paths.log("ui.set_zoom 실패: " + traceback.format_exc())


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


def hide():
    """숨겼으면 True."""
    h = hwnd()
    if h:
        _U.ShowWindow(h, SW_HIDE)
        return True
    return False


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




def ready():
    """창이 실제로 만들어졌는지 (처음 앞으로 부를 때를 잰다)."""
    return bool(hwnd())
