# -*- coding: utf-8 -*-
"""Windows 에만 있는 것을 모아 두는 자리 (모니터 정보).

앱의 핵심(store · recur · tokens · HTTP API)은 운영체제를 모른다. 휴대폰 앱을
붙일 때 그대로 가져갈 수 있어야 하기 때문이다. Windows 에 기대는 코드는
toast · tray · ui · autostart 와 이 파일에만 둔다.

(예전에는 같은 MONITORINFO 구조체를 ui.py 와 toast.py 가 각자 정의했다.)
"""
import ctypes
from ctypes import wintypes

MONITOR_DEFAULTTONEAREST = 2


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD),
                ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT),
                ("dwFlags", wintypes.DWORD)]


# 이 모듈 전용 핸들. ctypes.windll.user32 는 프로세스 전체가 같이 쓰는 객체라
# 여기서 argtypes 를 바꾸면 pystray 같은 다른 코드의 호출까지 바뀐다.
_U = ctypes.WinDLL("user32", use_last_error=True)
_U.GetMonitorInfoW.restype = wintypes.BOOL
_U.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFO)]


def monitor_info(hmon):
    """모니터 핸들의 MONITORINFO (rcMonitor · rcWork). 핸들이 없거나 실패하면 None."""
    if not hmon:
        return None
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    return mi if _U.GetMonitorInfoW(ctypes.c_void_p(hmon), ctypes.byref(mi)) else None
