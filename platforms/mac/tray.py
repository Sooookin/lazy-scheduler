# -*- coding: utf-8 -*-
"""메뉴 막대 아이콘 (macOS). 창을 닫아도 여기서 바로 다시 열 수 있다. Windows 쪽은 platforms/win/tray.py.

NSStatusItem 은 메인 스레드의 AppKit 루프(platforms/mac/cards.run)에서만 만들고 바꿀 수 있다.
start() 는 그 루프가 돌기 전에 불리므로 할 일을 루프에 맡겨 둔다 (AppHelper.callAfter).
"""
import os
import threading
import traceback

import AppKit
import Foundation
from PyObjCTools import AppHelper

from desktop import paths

_item = None
_target = None
_cb = {}
_title = None
_badge = 0


def _log(tag):
    paths.log("tray(mac) %s: %s" % (tag, traceback.format_exc()))


def _fire(name):
    """메뉴를 눌렀다. 창 프로세스를 띄우는 일 등이 AppKit 루프를 막지 않게 따로 돈다."""
    fn = _cb.get(name)
    if fn is None:
        return

    def run():
        try:
            fn()
        except Exception:
            _log(name)
    threading.Thread(target=run, daemon=True).start()


class LSTrayTarget(Foundation.NSObject):
    def open_(self, sender):
        _fire("open")

    def test_(self, sender):
        _fire("test")

    def quit_(self, sender):
        _fire("quit")


def _icon():
    """메뉴 막대 높이(18pt)에 맞춘 앱 아이콘. 32px 그림을 쓰면 Retina 에서도 또렷하다."""
    for name in ("icon-32.png", "icon.png"):
        p = os.path.join(paths.WEB_DIR, name)
        if os.path.exists(p):
            img = AppKit.NSImage.alloc().initWithContentsOfFile_(p)
            if img is not None:
                img.setSize_(Foundation.NSMakeSize(18, 18))
                return img
    return None


def _build():
    global _item, _target
    try:
        _item = AppKit.NSStatusBar.systemStatusBar().statusItemWithLength_(AppKit.NSVariableStatusItemLength)
        btn = _item.button()
        img = _icon()
        if img is not None:
            btn.setImage_(img)
            btn.setImagePosition_(AppKit.NSImageLeft)
        else:
            btn.setTitle_("LS")
        btn.setToolTip_(_title or paths.APP_NAME)
        _target = LSTrayTarget.alloc().init()
        menu = AppKit.NSMenu.alloc().init()
        for entry in (("열기", "open:"), None, ("알림 미리보기", "test:"), None, ("완전히 종료", "quit:")):
            if entry is None:
                menu.addItem_(AppKit.NSMenuItem.separatorItem())
                continue
            it = AppKit.NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(entry[0], entry[1], "")
            it.setTarget_(_target)
            menu.addItem_(it)
        _item.setMenu_(menu)
        _apply_badge()
        paths.log("tray(mac): 메뉴 막대 아이콘을 올렸다")
    except Exception:
        # 아이콘이 없으면 창을 닫았을 때 살아 있다는 표시가 아무것도 남지 않는다 - 흔적은 남긴다
        _log("build")


def start(on_open, on_test, on_quit, subtitle=None):
    _cb.update(open=on_open, test=on_test, quit=on_quit)
    AppHelper.callAfter(_build)


def _apply_badge():
    if _item is None:
        return
    try:
        _item.button().setTitle_((" %s" % ("9+" if _badge > 9 else _badge)) if _badge else "")
    except Exception:
        _log("badge")


def set_badge(n):
    """보류 중인 알림 수를 아이콘 옆에 숫자로. 0 이면 아이콘만."""
    global _badge
    if n == _badge:
        return
    _badge = n
    AppHelper.callAfter(_apply_badge)


def set_title(text):
    global _title
    _title = text

    def run():
        if _item is not None:
            _item.button().setToolTip_(text)
    AppHelper.callAfter(run)


def stop():
    def run():
        global _item
        if _item is not None:
            AppKit.NSStatusBar.systemStatusBar().removeStatusItem_(_item)
            _item = None
    AppHelper.callAfter(run)
