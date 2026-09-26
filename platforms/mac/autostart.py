# -*- coding: utf-8 -*-
"""로그인할 때 켜기 (macOS): ~/Library/LaunchAgents 에 LaunchAgent 하나. Windows 쪽은 레지스트리.

파일을 두기만 하면 다음 로그인부터 켜진다 (launchctl 로 지금 올리지 않는다 - 이미 돌고 있다).
.app 을 자동 업데이트로 바꿔 끼워도 경로가 같아 손댈 것이 없다.
"""
import os
import plistlib
import sys

from desktop import paths

NAME = "LazyScheduler"
OLD_NAMES = ()
LABEL = "com.lazyscheduler.app"
PLIST = os.path.expanduser("~/Library/LaunchAgents/%s.plist" % LABEL)


def _args():
    """로그인할 때 실행할 명령. --silent: 창 없이 조용히 시작하고 창은 숨긴 채 미리 만들어 둔다."""
    if paths.FROZEN:
        return [sys.executable, "--silent"]
    return [paths.python_runner(), os.path.join(paths.APP_DIR, "main.py"), "--silent"]


def is_enabled():
    return os.path.exists(PLIST)


def set_enabled(on):
    try:
        if on:
            os.makedirs(os.path.dirname(PLIST), exist_ok=True)
            tmp = PLIST + ".tmp"
            with open(tmp, "wb") as f:
                plistlib.dump({"Label": LABEL, "ProgramArguments": _args(), "RunAtLoad": True,
                               "ProcessType": "Interactive"}, f)
            os.replace(tmp, PLIST)
        elif os.path.exists(PLIST):
            os.remove(PLIST)
    except OSError as e:
        paths.log("자동 실행 설정 실패: %s" % e)
    return is_enabled()


def make_desktop_shortcut():
    """macOS 는 바로가기 대신 .app 을 응용 프로그램 폴더 · Dock 에 두면 된다 (설정 창에서 단추를 숨긴다)."""
    return None
