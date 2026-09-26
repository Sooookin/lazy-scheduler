# -*- coding: utf-8 -*-
"""알림 카드의 Windows 쪽: 레이어드 윈도우(UpdateLayeredWindow) · 메시지 루프 · 화면 정보.

그림 · 쌓기 · 수명은 desktop/toast.py 가 한다. 여기는 그 그림을 화면에 올리고, 마우스를
카드에 알리고, 타이머로 toast 의 pump 를 부르는 일만 한다. macOS 쪽은 platforms/mac/cards.py.

창과 이벤트 루프를 Win32 로 직접 다룬다 - tkinter 를 쓰면 배포본에 tcl/tk 6MB 가 따라 들어온다.
"""
import ctypes
import traceback
from ctypes import wintypes

from desktop import paths
from platforms.win import win32

# ---------------- 레이어드 윈도우 (GDI) ----------------
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080     # Alt+Tab · 작업표시줄에 안 잡히게
ULW_ALPHA = 0x00000002
AC_SRC_OVER, AC_SRC_ALPHA = 0x00, 0x01
BI_RGB, DIB_RGB_COLORS = 0, 0
PVOID = ctypes.c_void_p


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_byte), ("BlendFlags", ctypes.c_byte),
                ("SourceConstantAlpha", ctypes.c_byte), ("AlphaFormat", ctypes.c_byte)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
                ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


# 이 모듈 전용 핸들을 쓴다. ctypes.windll.user32 는 프로세스 전체가 같이 쓰는 객체라
# 여기서 argtypes 를 바꾸면 pystray 같은 다른 코드의 호출까지 바뀐다.
# use_last_error 를 켜야 ctypes.get_last_error() 가 실제 오류 번호를 돌려준다.
U32 = ctypes.WinDLL("user32", use_last_error=True)
G32 = ctypes.WinDLL("gdi32", use_last_error=True)

# 핸들은 64비트다. restype 을 지정하지 않으면 c_long(32비트)으로 잘려서 실패한다.
U32.GetDC.restype = PVOID
U32.GetDC.argtypes = [PVOID]
U32.ReleaseDC.argtypes = [PVOID, PVOID]
U32.GetParent.restype = PVOID
U32.GetParent.argtypes = [PVOID]
U32.GetWindowLongW.restype = ctypes.c_long
U32.GetWindowLongW.argtypes = [PVOID, ctypes.c_int]
U32.SetWindowLongW.restype = ctypes.c_long
U32.SetWindowLongW.argtypes = [PVOID, ctypes.c_int, ctypes.c_long]
U32.UpdateLayeredWindow.restype = wintypes.BOOL
U32.UpdateLayeredWindow.argtypes = [
    PVOID, PVOID, ctypes.POINTER(wintypes.POINT), ctypes.POINTER(wintypes.SIZE),
    PVOID, ctypes.POINTER(wintypes.POINT), wintypes.DWORD,
    ctypes.POINTER(BLENDFUNCTION), wintypes.DWORD]
G32.CreateCompatibleDC.restype = PVOID
G32.CreateCompatibleDC.argtypes = [PVOID]
G32.CreateDIBSection.restype = PVOID
G32.CreateDIBSection.argtypes = [PVOID, PVOID, wintypes.UINT,
                                 ctypes.POINTER(PVOID), PVOID, wintypes.DWORD]
G32.SelectObject.restype = PVOID
G32.SelectObject.argtypes = [PVOID, PVOID]
G32.DeleteObject.argtypes = [PVOID]
G32.DeleteDC.argtypes = [PVOID]

# ---------------- 창 (순수 Win32) ----------------
# 예전에는 tkinter 를 창 껍데기와 타이머로만 썼는데, 그 하나 때문에 배포본에
# tcl/tk 가 6MB 들어갔다. 카드는 어차피 UpdateLayeredWindow 로 직접 그리므로
# 창과 이벤트 루프도 Win32 로 직접 다룬다.
WM_DESTROY, WM_TIMER = 0x0002, 0x0113
WM_WAKE = 0x8000 + 1                 # WM_APP + 1: 새 알림이 왔다
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_MOUSELEAVE = 0x0200, 0x0201, 0x02A3
WM_SETCURSOR = 0x0020
WS_POPUP = 0x80000000
WS_EX_TOPMOST, WS_EX_NOACTIVATE = 0x00000008, 0x08000000
SW_SHOWNOACTIVATE, SW_HIDE = 4, 0
SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER = 0x0010, 0x0001, 0x0004
IDC_ARROW, IDC_HAND = 32512, 32649
TME_LEAVE = 0x00000002

LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, PVOID, ctypes.c_uint, WPARAM, LPARAM)


class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", PVOID), ("hIcon", PVOID), ("hCursor", PVOID),
                ("hbrBackground", PVOID), ("lpszMenuName", ctypes.c_wchar_p),
                ("lpszClassName", ctypes.c_wchar_p)]


class TRACKMOUSEEVENT(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("hwndTrack", PVOID), ("dwHoverTime", wintypes.DWORD)]


class MSG(ctypes.Structure):
    _fields_ = [("hwnd", PVOID), ("message", wintypes.UINT), ("wParam", WPARAM),
                ("lParam", LPARAM), ("time", wintypes.DWORD),
                ("pt_x", ctypes.c_long), ("pt_y", ctypes.c_long)]


U32.DefWindowProcW.restype = LRESULT
U32.DefWindowProcW.argtypes = [PVOID, ctypes.c_uint, WPARAM, LPARAM]
U32.CreateWindowExW.restype = PVOID
U32.CreateWindowExW.argtypes = [wintypes.DWORD, ctypes.c_wchar_p, ctypes.c_wchar_p,
                                wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, PVOID, PVOID, PVOID, PVOID]
U32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASS)]
U32.SetWindowPos.argtypes = [PVOID, PVOID, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, ctypes.c_int, wintypes.UINT]
U32.SetTimer.restype = PVOID
U32.SetTimer.argtypes = [PVOID, PVOID, wintypes.UINT, PVOID]
U32.KillTimer.argtypes = [PVOID, PVOID]
U32.PostMessageW.argtypes = [PVOID, ctypes.c_uint, WPARAM, LPARAM]
U32.DestroyWindow.argtypes = [PVOID]
U32.ShowWindow.argtypes = [PVOID, ctypes.c_int]
U32.LoadCursorW.restype = PVOID
U32.LoadCursorW.argtypes = [PVOID, ctypes.c_wchar_p]
U32.SetCursor.restype = PVOID
U32.SetCursor.argtypes = [PVOID]
U32.GetMessageW.argtypes = [ctypes.POINTER(MSG), PVOID, wintypes.UINT, wintypes.UINT]
U32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
U32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
U32.TrackMouseEvent.argtypes = [ctypes.POINTER(TRACKMOUSEEVENT)]

_cursors = {}


def _cursor(which):
    if which not in _cursors:
        _cursors[which] = U32.LoadCursorW(None, ctypes.c_wchar_p(which))
    return _cursors[which]


def _lo(v):
    v &= 0xFFFF
    return v - 0x10000 if v > 0x7FFF else v

def _premultiplied_bgra(img):
    """PIL RGBA → 알파 미리곱한 BGRA 바이트."""
    from PIL import Image, ImageChops
    r, g, b, a = img.split()
    r = ImageChops.multiply(r, a)
    g = ImageChops.multiply(g, a)
    b = ImageChops.multiply(b, a)
    return Image.merge("RGBA", (b, g, r, a)).tobytes()


class _Surface:
    """카드 그림 한 장을 담아 두는 GDI 비트맵.

    예전에는 틀마다 그림을 다시 곱하고 복사해서 넘겼다. 이제 그림은 바뀔 때(처음 ·
    마우스 올림)만 올리고, 움직이는 동안에는 위치와 투명도만 넘긴다.
    """

    def __init__(self):
        self.mem_dc = self.hbmp = self.old = None
        self.size = (0, 0)

    def load(self, img):
        self.free()
        screen = U32.GetDC(None)
        try:
            self.mem_dc = G32.CreateCompatibleDC(screen)
            bi = BITMAPINFOHEADER()
            bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bi.biWidth, bi.biHeight = img.width, -img.height        # 음수 = 위에서 아래로
            bi.biPlanes, bi.biBitCount, bi.biCompression = 1, 32, BI_RGB
            bits = PVOID()
            self.hbmp = G32.CreateDIBSection(self.mem_dc, ctypes.byref(bi), DIB_RGB_COLORS,
                                             ctypes.byref(bits), None, 0)
            if not self.hbmp:
                raise OSError("CreateDIBSection failed")
            data = _premultiplied_bgra(img)
            ctypes.memmove(bits, data, len(data))
            self.old = G32.SelectObject(self.mem_dc, self.hbmp)
            self.size = img.size
        finally:
            U32.ReleaseDC(None, screen)

    def present(self, hwnd, x, y, alpha):
        a = max(0, min(255, int(round(alpha))))
        screen = U32.GetDC(None)
        try:
            pt = wintypes.POINT(int(round(x)), int(round(y)))
            size = wintypes.SIZE(*self.size)
            src = wintypes.POINT(0, 0)
            blend = BLENDFUNCTION(AC_SRC_OVER, 0, a - 256 if a > 127 else a, AC_SRC_ALPHA)
            if not U32.UpdateLayeredWindow(hwnd, screen, ctypes.byref(pt), ctypes.byref(size),
                                           self.mem_dc, ctypes.byref(src), 0,
                                           ctypes.byref(blend), ULW_ALPHA):
                raise OSError("UpdateLayeredWindow failed (%d)" % ctypes.get_last_error())
        finally:
            U32.ReleaseDC(None, screen)

    def free(self):
        if self.mem_dc:
            if self.old:
                G32.SelectObject(self.mem_dc, self.old)
            if self.hbmp:
                G32.DeleteObject(self.hbmp)
            G32.DeleteDC(self.mem_dc)
        self.mem_dc = self.hbmp = self.old = None



class Window:
    """카드 한 장이 올라갈 창. 마우스 일은 owner(toast.Card)의 on_move · on_click · on_leave 로,
    커서 모양은 owner.hover 로 정한다. 좌표는 모두 화면 픽셀."""

    def __init__(self, owner, w, h):
        self.owner = owner
        self.over = False
        self.surface = _Surface()
        self.hwnd = U32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            _CLASS_NAME, paths.APP_NAME + " 알림", WS_POPUP,
            0, 0, w, h, None, None, None, None)
        if not self.hwnd:
            raise OSError("CreateWindowEx 실패 (%d)" % ctypes.get_last_error())
        _windows[self.hwnd] = self

    def load(self, img):
        self.surface.load(img)

    def present(self, x, y, alpha):
        self.surface.present(self.hwnd, x, y, alpha)

    def show(self):
        U32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)

    def _track_leave(self):
        if not self.over:
            self.over = True
            tme = TRACKMOUSEEVENT(ctypes.sizeof(TRACKMOUSEEVENT), TME_LEAVE, self.hwnd, 0)
            U32.TrackMouseEvent(ctypes.byref(tme))

    def destroy(self):
        _windows.pop(self.hwnd, None)
        self.surface.free()
        try:
            U32.DestroyWindow(self.hwnd)
        except Exception:
            pass


_windows = {}                   # hwnd -> Window
_ctrl = None                    # 타이머만 받는 숨은 창
_rate = 0                       # 지금 타이머 간격
_pump = None                    # toast 가 run() 에 넘겨 준 한 틀 처리


def _wndproc(hwnd, msg, wp, lp):
    if msg == WM_TIMER or msg == WM_WAKE:
        if hwnd == _ctrl and _pump is not None:
            _pump()
        return 0
    win = _windows.get(hwnd)
    if win is not None:
        card = win.owner
        if msg == WM_MOUSEMOVE:
            win._track_leave()
            card.on_move(_lo(lp), _lo(lp >> 16))
            return 0
        if msg == WM_LBUTTONDOWN:
            card.on_click(_lo(lp), _lo(lp >> 16))
            return 0
        if msg == WM_MOUSELEAVE:
            win.over = False
            card.on_leave()
            return 0
        if msg == WM_SETCURSOR:
            U32.SetCursor(_cursor(IDC_HAND if card.hover else IDC_ARROW))
            return 1
        if msg == WM_DESTROY:
            _windows.pop(hwnd, None)
            return 0
    return U32.DefWindowProcW(hwnd, msg, wp, lp)


_WNDPROC_REF = WNDPROC(_wndproc)      # 살려 둬야 한다. 가비지가 되면 즉시 죽는다
_CLASS_NAME = "LazySchedulerToast"


def _register():
    wc = WNDCLASS()
    wc.style = 0x0020                  # CS_OWNDC 아님: CS_HREDRAW/VREDRAW 불필요
    wc.lpfnWndProc = _WNDPROC_REF
    wc.hInstance = None
    wc.hCursor = _cursor(IDC_ARROW)
    wc.lpszClassName = _CLASS_NAME
    if not U32.RegisterClassW(ctypes.byref(wc)):
        err = ctypes.get_last_error()
        if err != 1410:                # ERROR_CLASS_ALREADY_EXISTS
            raise OSError("RegisterClass 실패 (%d)" % err)



# ---------------- 어느 화면에 · 지금 띄워도 되는가 ----------------

MONITOR_DEFAULTTONEAREST = 2
QUNS_ACCEPTS_NOTIFICATIONS = 5     # 이 값일 때만 "지금 알려도 된다"

# 핸들을 돌려주는 함수는 restype 을 밝혀 둬야 한다.
# 기본값(c_int)이면 64비트에서 핸들 위쪽 절반이 잘려 엉뚱한 값이 된다.
try:
    U32.GetForegroundWindow.restype = wintypes.HWND
    U32.GetShellWindow.restype = wintypes.HWND
    U32.MonitorFromWindow.restype = ctypes.c_void_p
    U32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    U32.MonitorFromPoint.restype = ctypes.c_void_p
except AttributeError:
    pass


_monitor_info = win32.monitor_info


def _active_monitor():
    """지금 보고 있는 화면. 앞에 있는 창의 모니터, 없으면 마우스가 있는 모니터."""
    try:
        h = U32.GetForegroundWindow()
        if h:
            return U32.MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST)
        pt = wintypes.POINT()
        if U32.GetCursorPos(ctypes.byref(pt)):
            return U32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
    except Exception:
        pass
    return None


def work_area():
    """작업표시줄을 뺀 화면 영역. 화면 크기로 계산하면 카드가 작업표시줄에 가린다.

    예전에는 SPI_GETWORKAREA 로 주 모니터만 봤다. 노트북에 외장 모니터를 붙이면
    지금 보고 있는 화면이 아니라 늘 주 모니터에 카드가 떠서, 다른 화면을 보고
    있으면 알림을 통째로 놓쳤다. 이제는 활성 창이 있는 모니터에 띄운다.
    """
    try:
        mi = _monitor_info(_active_monitor())
        if mi is not None:
            w = mi.rcWork
            if w.right > w.left and w.bottom > w.top:
                return w.left, w.top, w.right, w.bottom
    except Exception:
        pass
    try:
        r = wintypes.RECT()
        if U32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0):   # SPI_GETWORKAREA
            return r.left, r.top, r.right, r.bottom
    except Exception:
        pass
    return 0, 0, U32.GetSystemMetrics(0), U32.GetSystemMetrics(1)


def _foreground_is_fullscreen():
    """앞에 있는 창이 모니터를 통째로 덮고 있는가 (발표 · 영상 · 게임)."""
    try:
        h = U32.GetForegroundWindow()
        if not h or h == U32.GetShellWindow():
            return False
        cls = ctypes.create_unicode_buffer(64)
        U32.GetClassNameW(h, cls, 64)
        # 바탕화면 · 작업표시줄은 전체 화면이어도 방해가 아니다
        if cls.value in ("Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow"):
            return False
        r = wintypes.RECT()
        if not U32.GetWindowRect(h, ctypes.byref(r)):
            return False
        mi = _monitor_info(U32.MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST))
        if mi is None:
            return False
        m = mi.rcMonitor
        return (r.left <= m.left and r.top <= m.top
                and r.right >= m.right and r.bottom >= m.bottom)
    except Exception:
        return False


def os_busy():
    """Windows 가 "지금은 알리지 마라" 고 하는가 (화면 공유 · 전체 화면 발표 · 집중 지원 · 잠금 화면).

    Windows 가 알려주는 상태를 먼저 믿고, 그것이 없으면 직접 전체 화면을 본다.
    """
    try:
        st = ctypes.c_int()
        if ctypes.windll.shell32.SHQueryUserNotificationState(ctypes.byref(st)) == 0:
            return st.value != QUNS_ACCEPTS_NOTIFICATIONS
    except Exception:
        pass
    return _foreground_is_fullscreen()


def scale():
    """시스템 화면 배율. 프로세스가 DPI 를 안다고 선언했을 때만 실제 값이 나온다."""
    try:
        dpi = U32.GetDpiForSystem()               # Windows 10 1607+
        if dpi:
            return dpi / 96.0
    except (AttributeError, OSError):
        pass
    return 1.0


def motion():
    """Windows '애니메이션 효과' 설정. 끄면 카드는 미끄러지지 않고 곧바로 나타난다."""
    try:
        v = wintypes.BOOL()
        if U32.SystemParametersInfoW(0x1042, 0, ctypes.byref(v), 0):   # SPI_GETCLIENTAREAANIMATION
            return bool(v.value)
    except Exception:
        pass
    return True


def wake():
    """쉬고 있는 메시지 루프를 깨운다. 어느 스레드에서 불러도 된다 (PostMessage)."""
    if _ctrl:
        U32.PostMessageW(_ctrl, WM_WAKE, 0, 0)


def set_rate(ms):
    """타이머 간격. 0 이면 타이머를 멈춘다."""
    global _rate
    if ms == _rate:
        return
    if _rate:
        U32.KillTimer(_ctrl, PVOID(1))
    if ms:
        U32.SetTimer(_ctrl, PVOID(1), ms, None)
    _rate = ms


def run(pump, idle_ms, on_ready=None):
    """메인 스레드에서 호출. 창 클래스를 등록하고 Win32 메시지 루프를 돈다."""
    global _ctrl, _pump
    _pump = pump
    _register()
    _ctrl = U32.CreateWindowExW(0, _CLASS_NAME, paths.APP_NAME, WS_POPUP,
                                0, 0, 0, 0, None, None, None, None)
    if not _ctrl:
        raise OSError("타이머용 창 생성 실패 (%d)" % ctypes.get_last_error())
    set_rate(idle_ms)
    if on_ready:
        try:
            on_ready()
        except Exception:
            paths.log("toast on_ready 실패: " + traceback.format_exc())
    paths.log("toast: 메시지 루프 진입")
    msg = MSG()
    while U32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        U32.TranslateMessage(ctypes.byref(msg))
        U32.DispatchMessageW(ctypes.byref(msg))
