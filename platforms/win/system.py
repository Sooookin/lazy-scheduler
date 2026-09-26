# -*- coding: utf-8 -*-
"""Windows 의 프로세스 · 파일 · 비밀 보관 · 배포본 모양. macOS 쪽은 platforms/mac/system.py.

화면을 띄우지 않는 일만 둔다 (알림 카드 창은 cards, 앱 창은 window, 트레이는 tray).
"""
import ctypes
import os
import subprocess
import time
import traceback
import webbrowser
import zipfile

from desktop import paths

NO_WINDOW = 0x08000000                 # CREATE_NO_WINDOW: 콘솔 창이 번쩍이지 않게
DETACHED = 0x00000008 | 0x00000200     # DETACHED_PROCESS · CREATE_NEW_PROCESS_GROUP

# ---------------- 배포본 모양 (자동 업데이트가 쓴다) ----------------
ASSET = "LazyScheduler-win.zip"        # 릴리스에서 받을 파일 (홈페이지도 이것을 가리킨다)
# (2.5.0 까지는 LazyScheduler.zip 이었다. 그 설치본은 2.5.1 에서 옛 이름으로 한 번 받아 넘어왔다)
EXE = "LazyScheduler.exe"
# 새 버전이 제 부품을 다 불러오는지 --probe 로 볼 모듈
PROBE_MODULES = ("PIL.Image", "PIL.ImageDraw", "pystray._win32", "clr", "webview",
                 "webview.platforms.edgechromium", "platforms.win.cards", "platforms.win.tray",
                 "platforms.win.window")


def install_dir():
    """바꿔 끼울 단위 = exe 가 든 폴더."""
    return paths.APP_DIR


def exe_in(folder):
    return os.path.join(folder, EXE)


def extract(zip_path, dest):
    """풀고 exe 가 든 폴더를 돌려준다. 폴더 밖으로 나가는 이름이 하나라도 있으면 멈춘다."""
    root = os.path.abspath(dest)
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            out = os.path.abspath(os.path.join(root, name))
            if os.path.commonpath([root, out]) != root:
                raise ValueError("zip 안에 이상한 경로: %s" % name)
        z.extractall(root)
    for cand in (os.path.join(root, "LazyScheduler"), root):
        if os.path.isfile(os.path.join(cand, EXE)):
            return cand
    raise ValueError("zip 안에 %s 가 없다" % EXE)


# ---------------- 프로세스 ----------------

def spawn(args, cwd=None, detach=False, quiet=True):
    """기다리지 않고 띄운다. detach 면 부른 쪽이 끝나도 살아남는다.

    --windowed 빌드는 표준 입출력 핸들이 없다. 명시하지 않으면 Popen 이 부모 핸들을
    복제하려다 실패할 수 있어 늘 DEVNULL 로 잇는다.
    """
    flags = NO_WINDOW | (DETACHED if detach else 0)
    null = subprocess.DEVNULL if quiet else None
    return subprocess.Popen(args, cwd=cwd, creationflags=flags, stdin=null, stdout=null,
                            stderr=null, close_fds=detach)


def run_quiet(args, cwd=None, timeout=None):
    """끝날 때까지 기다린다 (콘솔 창 없이)."""
    return subprocess.run(args, cwd=cwd, timeout=timeout, creationflags=NO_WINDOW,
                          stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL)


def wait_pid(pid, timeout):
    """그 프로세스가 끝나기를 기다린다."""
    try:
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x00100000, False, int(pid))          # SYNCHRONIZE
        if h:
            k32.WaitForSingleObject(h, int(timeout * 1000))
            k32.CloseHandle(h)
    except Exception:
        time.sleep(3)


def kill_others():
    """이 프로세스 말고 우리 exe 를 모두 끝낸다 (새 버전이 뜨지 않아 되돌릴 때)."""
    run_quiet(["taskkill", "/F", "/IM", EXE, "/FI", "PID ne %d" % os.getpid()], timeout=15)


_lock_handle = None          # 핸들을 살려둬야 잠금이 유지된다


def single_instance():
    """이미 다른 서비스가 돌고 있으면 False."""
    global _lock_handle
    try:
        # use_last_error 가 없으면 ctypes 가 중간에 오류 번호를 덮어써 판단이 흔들린다
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateMutexW.restype = ctypes.c_void_p
        k32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        # 이름에 포트를 넣는다 - 점검용으로 다른 포트에 나란히 켠 것(ipc.LS_PORT_BASE)은 따로 센다
        from desktop import ipc
        name = r"Local\LazyScheduler.Service" + ("" if ipc.SERVICE_PORT == 8777 else ".%d" % ipc.SERVICE_PORT)
        h = k32.CreateMutexW(None, False, name)
        if h and ctypes.get_last_error() == 183:        # ERROR_ALREADY_EXISTS
            return False
        _lock_handle = h
        return True
    except Exception:
        paths.log("단일 실행 잠금 실패(무시): " + traceback.format_exc())
        return True


def prepare_service():
    """서비스가 창을 하나라도 만들기 전에: 화면 배율(125%·150%)에서 알림 카드가 흐리지 않게.

    DPI 를 모른다고 두면 Windows 가 100% 로 그린 카드를 늘려서 뿌옇게 보인다.
    선언하고 나면 카드 크기는 toast.py 가 배율에 맞춰 직접 키워 그린다.
    """
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)      # PROCESS_SYSTEM_DPI_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def open_in_browser(url):
    """네이티브 창을 못 쓸 때: Edge 앱 창으로, 그것도 없으면 기본 브라우저로."""
    profile = os.path.join(os.environ.get("LOCALAPPDATA", paths.APP_DIR), "LazyScheduler", "browser")
    for exe in BROWSERS:
        if os.path.exists(exe):
            subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}",
                              "--window-size=1020,880", "--no-first-run"],
                             creationflags=NO_WINDOW)
            return
    webbrowser.open(url)


def open_file(path):
    """파일을 기본 프로그램으로 연다 (점검 결과 보여 주기)."""
    os.startfile(path)


# ---------------- 비밀 보관 (DPAPI) ----------------

def protect(data):
    """bytes → 이 Windows 사용자만 풀 수 있는 bytes."""
    from platforms.win import win32
    return win32.protect(data)


def unprotect(blob):
    """protect() 의 반대. 다른 사용자 · 다른 PC 의 것이면 OSError."""
    from platforms.win import win32
    return win32.unprotect(blob)
