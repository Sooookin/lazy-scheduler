# -*- coding: utf-8 -*-
"""알림 카드의 macOS 쪽: 투명 NSPanel · AppKit 이벤트 루프 · 화면 정보.

그림 · 쌓기 · 수명은 desktop/toast.py 가 Windows 와 똑같이 한다. 여기는 그 그림(Pillow RGBA)을
테두리 없는 투명 패널에 그대로 올리고, 마우스를 카드에 알리고, 타이머로 pump 를 부른다.

좌표: toast 는 "화면 픽셀, 왼쪽 위가 0" 으로 셈한다 (Windows 와 같게). Cocoa 는 포인트 단위에
주 화면 왼쪽 아래가 0 이고 위로 갈수록 커진다. 이 파일이 둘 사이를 바꾼다:
    픽셀 x = 포인트 x × 배율,  픽셀 y = (주 화면 높이 − 포인트 y) × 배율
배율(_S)은 켤 때 주 화면의 Retina 배율 하나로 정하고 toast.SCALE 과 같게 둔다 - 카드는 그 배율로
그려지고, 배율이 낮은 외장 화면에서는 macOS 가 줄여 보인다.

카드를 눌러도 앱이 앞으로 나오지 않게 NonactivatingPanel 이고, 다른 앱이 앞에 있어도 마우스를
받도록 추적 영역을 ActiveAlways 로 둔다.
"""
import io
import traceback

import AppKit
import Foundation
import objc
import Quartz
from PyObjCTools import AppHelper

from desktop import paths

_S = [2.0]                       # 그림 픽셀 ÷ 포인트 (run 에서 정한다)
_pump = None
_timer = None
_rate = 0
_target = None


def _log(tag):
    paths.log("cards(mac) %s: %s" % (tag, traceback.format_exc()))


def _app():
    return AppKit.NSApplication.sharedApplication()


def _primary_h():
    """주 화면(메뉴 막대가 있는 화면) 높이 - 모든 화면의 Cocoa 좌표는 이것을 기준으로 뒤집힌다."""
    return AppKit.NSScreen.screens()[0].frame().size.height


def scale():
    try:
        _app()
        scr = AppKit.NSScreen.mainScreen() or AppKit.NSScreen.screens()[0]
        return float(scr.backingScaleFactor())
    except Exception:
        return 2.0


def motion():
    """'동작 줄이기'(손쉬운 사용)를 켜면 카드는 미끄러지지 않고 곧바로 나타난다."""
    try:
        return not AppKit.NSWorkspace.sharedWorkspace().accessibilityDisplayShouldReduceMotion()
    except Exception:
        return True


def _mouse_screen():
    """지금 보고 있는 화면 = 마우스가 있는 화면."""
    m = AppKit.NSEvent.mouseLocation()
    for scr in AppKit.NSScreen.screens():
        if AppKit.NSMouseInRect(m, scr.frame(), False):
            return scr
    return AppKit.NSScreen.mainScreen() or AppKit.NSScreen.screens()[0]


def work_area():
    """메뉴 막대 · Dock 을 뺀 화면 영역 (픽셀, 왼쪽 위 기준)."""
    try:
        vf = _mouse_screen().visibleFrame()
        s, H = _S[0], _primary_h()
        left, right = vf.origin.x * s, (vf.origin.x + vf.size.width) * s
        top, bottom = (H - vf.origin.y - vf.size.height) * s, (H - vf.origin.y) * s
        if right > left and bottom > top:
            return int(left), int(top), int(right), int(bottom)
    except Exception:
        _log("work_area")
    return 0, 0, int(1440 * _S[0]), int(900 * _S[0])


def _front_fullscreen():
    """앞에 있는 앱의 창이 화면 하나를 통째로 덮고 있는가 (발표 · 영상 · 전체 화면 앱).

    창 목록의 크기 · 주인만 본다 (화면 기록 권한 없이도 읽힌다).
    """
    try:
        front = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
        if front is None or front.bundleIdentifier() == "com.apple.finder":
            return False
        pid = front.processIdentifier()
        wins = Quartz.CGWindowListCopyWindowInfo(
            Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
            Quartz.kCGNullWindowID) or []
        sizes = [(f.size.width, f.size.height) for f in (s.frame() for s in AppKit.NSScreen.screens())]
        for w in wins:
            if w.get("kCGWindowOwnerPID") != pid or w.get("kCGWindowLayer", 1) != 0:
                continue
            b = w.get("kCGWindowBounds") or {}
            bw, bh = b.get("Width", 0), b.get("Height", 0)
            if any(bw >= sw and bh >= sh for sw, sh in sizes):
                return True
    except Exception:
        _log("fullscreen")
    return False


def os_busy():
    """지금은 알리지 말아야 하는가: 화면이 잠겼거나, 앞의 앱이 전체 화면이다.

    macOS 의 방해 금지(집중 모드)는 앱이 읽을 수 있는 공개된 방법이 없어 보지 못한다.
    """
    try:
        d = Quartz.CGSessionCopyCurrentDictionary()
        if d and d.get("CGSSessionScreenIsLocked"):
            return True
    except Exception:
        pass
    return _front_fullscreen()


def _nsimage(img):
    """Pillow RGBA → NSImage. 픽셀은 그대로 두고 크기만 포인트로 적어 Retina 에서 또렷하게."""
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=1)
    raw = buf.getvalue()
    rep = AppKit.NSBitmapImageRep.imageRepWithData_(Foundation.NSData.dataWithBytes_length_(raw, len(raw)))
    size = Foundation.NSMakeSize(img.width / _S[0], img.height / _S[0])
    rep.setSize_(size)
    out = AppKit.NSImage.alloc().initWithSize_(size)
    out.addRepresentation_(rep)
    return out


def _safe(fn):
    try:
        fn()
    except Exception:
        _log("event")


def _cursor(owner):
    try:
        (AppKit.NSCursor.pointingHandCursor() if owner is not None and owner.hover
         else AppKit.NSCursor.arrowCursor()).set()
    except Exception:
        pass


class LSCardView(AppKit.NSView):
    """카드 그림을 그리고 마우스를 toast.Card 에 넘긴다. 좌표는 위가 0 (isFlipped)."""

    def initWithFrame_(self, frame):
        self = objc.super(LSCardView, self).initWithFrame_(frame)
        if self is None:
            return None
        self._img = None
        self._owner = None
        self._area = None
        return self

    def isFlipped(self):
        return True

    def acceptsFirstMouse_(self, event):
        return True                               # 다른 앱이 앞에 있어도 한 번에 눌린다

    def drawRect_(self, rect):
        if self._img is not None:
            self._img.drawInRect_fromRect_operation_fraction_respectFlipped_hints_(
                self.bounds(), Foundation.NSZeroRect, AppKit.NSCompositingOperationSourceOver,
                1.0, True, None)

    def updateTrackingAreas(self):
        if self._area is not None:
            self.removeTrackingArea_(self._area)
        opts = (AppKit.NSTrackingMouseEnteredAndExited | AppKit.NSTrackingMouseMoved
                | AppKit.NSTrackingActiveAlways | AppKit.NSTrackingInVisibleRect
                | AppKit.NSTrackingCursorUpdate)
        self._area = AppKit.NSTrackingArea.alloc().initWithRect_options_owner_userInfo_(
            self.bounds(), opts, self, None)
        self.addTrackingArea_(self._area)
        objc.super(LSCardView, self).updateTrackingAreas()

    @objc.python_method                           # 파이썬 쪽 도우미 - Objective-C 메서드로 올리지 않는다
    def _px(self, event):
        p = self.convertPoint_fromView_(event.locationInWindow(), None)
        return int(p.x * _S[0]), int(p.y * _S[0])

    def mouseMoved_(self, event):
        o = self._owner
        if o is not None:
            x, y = self._px(event)
            _safe(lambda: o.on_move(x, y))
            _cursor(o)

    def mouseEntered_(self, event):
        self.mouseMoved_(event)

    def mouseExited_(self, event):
        o = self._owner
        if o is not None:
            _safe(o.on_leave)
        _cursor(None)

    def cursorUpdate_(self, event):
        _cursor(self._owner)

    def mouseDown_(self, event):
        o = self._owner
        if o is not None:
            x, y = self._px(event)
            _safe(lambda: o.on_click(x, y))


class Window:
    """카드 한 장이 올라갈 투명 패널. 좌표 · 크기는 toast 가 쓰는 픽셀로 받는다."""

    def __init__(self, owner, w, h):
        s = _S[0]
        rect = Foundation.NSMakeRect(0, 0, w / s, h / s)
        p = AppKit.NSPanel.alloc().initWithContentRect_styleMask_backing_defer_(
            rect, AppKit.NSWindowStyleMaskBorderless | AppKit.NSWindowStyleMaskNonactivatingPanel,
            AppKit.NSBackingStoreBuffered, False)
        p.setOpaque_(False)
        p.setBackgroundColor_(AppKit.NSColor.clearColor())
        p.setHasShadow_(False)                    # 그림자는 그림에 들어 있다
        p.setLevel_(AppKit.NSStatusWindowLevel)
        p.setCollectionBehavior_(AppKit.NSWindowCollectionBehaviorCanJoinAllSpaces
                                 | AppKit.NSWindowCollectionBehaviorStationary
                                 | AppKit.NSWindowCollectionBehaviorFullScreenAuxiliary
                                 | AppKit.NSWindowCollectionBehaviorIgnoresCycle)
        p.setHidesOnDeactivate_(False)
        p.setFloatingPanel_(True)
        p.setBecomesKeyOnlyIfNeeded_(True)
        p.setReleasedWhenClosed_(False)
        p.setAcceptsMouseMovedEvents_(True)
        p.setAlphaValue_(0.0)
        v = LSCardView.alloc().initWithFrame_(rect)
        v._owner = owner
        p.setContentView_(v)
        self.panel, self.view = p, v
        self.h = h

    def load(self, img):
        s = _S[0]
        self.h = img.height
        size = Foundation.NSMakeSize(img.width / s, img.height / s)
        fr = self.panel.frame()
        if abs(fr.size.width - size.width) > 0.5 or abs(fr.size.height - size.height) > 0.5:
            self.panel.setContentSize_(size)
        self.view._img = _nsimage(img)
        self.view.setNeedsDisplay_(True)

    def present(self, x, y, alpha):
        s = _S[0]
        self.panel.setFrameOrigin_(Foundation.NSMakePoint(x / s, _primary_h() - y / s - self.h / s))
        self.panel.setAlphaValue_(max(0.0, min(1.0, alpha / 255.0)))

    def show(self):
        self.panel.orderFrontRegardless()

    def destroy(self):
        self.view._owner = None
        self.panel.orderOut_(None)
        self.panel.close()


# ---------------- 타이머 · 이벤트 루프 ----------------

def _call_pump():
    if _pump is not None:
        try:
            _pump()
        except Exception:
            _log("pump")


class LSTimerTarget(Foundation.NSObject):
    def tick_(self, timer):
        _call_pump()


def wake():
    """쉬고 있는 이벤트 루프를 깨운다. 어느 스레드에서 불러도 된다."""
    AppHelper.callAfter(_call_pump)


def set_rate(ms):
    """타이머 간격. 0 이면 멈춘다. 메인 스레드에서만 부른다 (pump 안에서)."""
    global _timer, _rate
    if ms == _rate:
        return
    if _timer is not None:
        _timer.invalidate()
        _timer = None
    if ms:
        _timer = Foundation.NSTimer.timerWithTimeInterval_target_selector_userInfo_repeats_(
            ms / 1000.0, _target, "tick:", None, True)
        # 메뉴 막대 메뉴를 펼쳐 둔 동안에도 카드가 움직이게 (기본 모드만이면 멈춘다)
        Foundation.NSRunLoop.mainRunLoop().addTimer_forMode_(_timer, Foundation.NSRunLoopCommonModes)
    _rate = ms


def run(pump, idle_ms, on_ready=None):
    """메인 스레드에서 호출. Dock 에 나오지 않는 앱(메뉴 막대 아이콘만)으로 AppKit 루프를 돈다."""
    global _pump, _target
    _pump = pump
    app = _app()
    app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
    _S[0] = scale()
    _target = LSTimerTarget.alloc().init()
    set_rate(idle_ms)
    if on_ready:
        try:
            on_ready()
        except Exception:
            _log("on_ready")
    paths.log("toast: AppKit 루프 진입 (배율 %.1f)" % _S[0])
    app.run()
