# -*- coding: utf-8 -*-
"""앱 창의 macOS 쪽. Windows 쪽은 platforms/win/window.py.

창은 pywebview(cocoa, WKWebView)가 만든다. pywebview 의 frameless 는 제목줄을 투명하게 하고
신호등 단추를 숨긴 보통 창이라, 가장자리를 끌어 크기를 바꾸는 것은 macOS 가 해 준다
(화면의 .grip 은 macOS 에서 숨긴다 - style.css). 옮기기 · 최대화 · 숨기기 · 확대는 여기서 한다.

AppKit 은 메인 스레드에서만 만질 수 있다. 부르는 쪽은 HTTP · JS 다리 스레드라 할 일을
메인 스레드에 맡긴다 (AppHelper.callAfter).

창을 숨기면 Dock 아이콘도 치운다 (Accessory). 창 프로세스는 숨은 채 살아 있다가 다음에
곧바로 열리는데, 그동안 Dock 에 아이콘이 남아 있으면 앱이 "떠 있는" 것처럼 보인다.
"""
import threading
import time
import traceback

import AppKit
import Foundation
from PyObjCTools import AppHelper

from desktop import paths

_WIN = [None]
DEFAULT_W, DEFAULT_H = 1050, 712
MIN_W, MIN_H = 720, 480
CREATE_OPTS = dict(frameless=True, easy_drag=False)
_placed = [False]


def _log(tag):
    paths.log("window(mac) %s: %s" % (tag, traceback.format_exc()))


def _main(fn, tag="main"):
    def run():
        try:
            fn()
        except Exception:
            _log(tag)
    AppHelper.callAfter(run)


def _native():
    w = _WIN[0]
    return getattr(w, "native", None) if w is not None else None


def _app():
    return AppKit.NSApplication.sharedApplication()


def prepare():
    """macOS 는 창을 만들기 전에 할 일이 없다."""


def attach(win, size, min_size):
    global DEFAULT_W, DEFAULT_H, MIN_W, MIN_H
    _WIN[0] = win
    DEFAULT_W, DEFAULT_H = size
    MIN_W, MIN_H = min_size


def ready():
    return _native() is not None


def watch():
    """숨긴 채 만든 창(자동 실행 --hidden)이면 Dock 에도 나오지 않게 한다.

    pywebview 는 불러오는 순간 앱을 보통 앱(Dock 아이콘 있음)으로 정한다.
    """
    def run():
        for _ in range(80):
            n = _native()
            if n is not None:
                time.sleep(0.5)
                _main(lambda: None if n.isVisible() else _app().setActivationPolicy_(
                    AppKit.NSApplicationActivationPolicyAccessory), "hidden-start")
                return
            time.sleep(0.25)
    threading.Thread(target=run, daemon=True).start()


def minimize():
    n = _native()
    if n is not None:
        _main(lambda: n.miniaturize_(None), "minimize")


def is_max():
    n = _native()
    return bool(n is not None and n.isZoomed())


def toggle_max():
    """macOS 의 '확대/축소'(초록 단추와 같다): 화면에 꽉 차게 ↔ 원래 크기."""
    n = _native()
    if n is None:
        return False
    was = bool(n.isZoomed())
    _main(lambda: n.zoom_(None), "zoom")
    return not was


def begin_move():
    """제목줄을 눌렀다. 마우스를 뗄 때까지 창이 따라온다 (Windows 와 같은 방법: 마우스 자리만 본다)."""
    threading.Thread(target=_move_loop, daemon=True).start()


def _move_loop():
    n = _native()
    if n is None:
        return
    start = AppKit.NSEvent.mouseLocation()
    fr = n.frame()
    ox, oy = fr.origin.x, fr.origin.y
    last = None
    while AppKit.NSEvent.pressedMouseButtons() & 1:
        m = AppKit.NSEvent.mouseLocation()
        pos = (ox + m.x - start.x, oy + m.y - start.y)
        if pos != last:
            last = pos
            _main(lambda p=pos: n.setFrameOrigin_(Foundation.NSMakePoint(p[0], p[1])), "move")
        time.sleep(0.008)


def begin_resize(edge):
    """macOS 는 창 가장자리 크기 조절을 운영체제가 한다 - 할 일이 없다."""


def client_size():
    n = _native()
    if n is None:
        return None
    try:
        size = n.contentView().frame().size
        return size.width, size.height
    except Exception:
        return None


def _find_webview(view):
    if view is None:
        return None
    if view.respondsToSelector_("setPageZoom:"):
        return view
    for sub in view.subviews() or []:
        found = _find_webview(sub)
        if found is not None:
            return found
    return None


def set_zoom(z):
    """화면 배율 = WKWebView 의 pageZoom (브라우저의 확대와 같다 - 흐려지지 않고 그 크기로 다시 그린다)."""
    n = _native()
    if n is None:
        return

    def run():
        v = _find_webview(n.contentView())
        if v is not None:
            v.setPageZoom_(z)
    _main(run, "zoom")


def _place_once(n):
    """처음 보일 때 마우스가 있는 화면 한가운데에. 한 번만 (옮겨 둔 자리를 존중한다)."""
    if _placed[0]:
        return
    _placed[0] = True
    m = AppKit.NSEvent.mouseLocation()
    scr = next((s for s in AppKit.NSScreen.screens() if AppKit.NSMouseInRect(m, s.frame(), False)),
               AppKit.NSScreen.mainScreen())
    if scr is None:
        return
    vf = scr.visibleFrame()
    w, h = min(DEFAULT_W, vf.size.width), min(DEFAULT_H, vf.size.height)
    x = vf.origin.x + (vf.size.width - w) / 2
    y = vf.origin.y + (vf.size.height - h) / 2
    n.setFrame_display_(Foundation.NSMakeRect(x, y, w, h), True)


def place_once():
    n = _native()
    if n is not None:
        _main(lambda: _place_once(n), "place")


def hide():
    """숨겼으면 True. Dock 아이콘도 치운다."""
    n = _native()
    if n is None:
        return False

    def run():
        n.orderOut_(None)
        _app().setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
    _main(run, "hide")
    return True


def focus():
    """숨어 있거나 Dock 으로 내려간 창을 다시 앞으로."""
    n = _native()
    if n is None:
        paths.log("window(mac).focus: 창이 아직 없다")
        return

    def run():
        app = _app()
        app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyRegular)
        _place_once(n)
        if n.isMiniaturized():
            n.deminiaturize_(None)
        n.makeKeyAndOrderFront_(None)
        app.activateIgnoringOtherApps_(True)
    _main(run, "focus")
