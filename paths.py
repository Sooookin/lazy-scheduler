# -*- coding: utf-8 -*-
"""파일 위치를 한 곳에서 정한다.

- 프로그램 파일(web/, app.ico)은 실행 파일 옆 또는 PyInstaller 임시 폴더
- 내 일정(data.json)은 %APPDATA%\\오늘  ← 프로그램 폴더와 분리해야
  · 배포본에 남의 일정이 섞이지 않고
  · 읽기 전용 공유 폴더에서 실행해도 저장이 되고
  · 프로그램을 새 버전으로 덮어써도 일정이 유지된다
"""
import os
import sys

FROZEN = getattr(sys, "frozen", False)

# 프로그램 자원(읽기 전용)
if FROZEN:
    RES_DIR = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    APP_DIR = os.path.dirname(sys.executable)
else:
    RES_DIR = APP_DIR = os.path.dirname(os.path.abspath(__file__))

WEB_DIR = os.path.join(RES_DIR, "web")
ICON = (os.path.join(RES_DIR, "app.ico") if FROZEN
        else os.path.join(APP_DIR, "assets", "app.ico"))


def font_paths(name):
    """이 글꼴 파일을 찾아볼 자리들. 앞에서부터 있는 것을 쓴다.

    빌드본은 묶을 때 fonts/ 로 넣고, 소스로 돌릴 때는 assets/fonts/ 에 있다.
    마지막은 맑은 고딕 - 글꼴이 없다고 알림이 아예 안 뜨면 안 된다.

    (예전에는 toast.py 와 tray.py 가 이 목록을 각자 적어 뒀다. 글꼴을 옮기면
     한쪽만 고쳐져 트레이 숫자만 시스템 글꼴로 나오는 식이 된다.)
    """
    return [os.path.join(RES_DIR, "fonts", name),
            os.path.join(APP_DIR, "assets", "fonts", name),
            r"C:\Windows\Fonts\malgun.ttf"]

# 사용자 데이터(쓰기 가능)
_base = os.environ.get("APPDATA") or os.path.expanduser("~")
APP_NAME = "lazy scheduler"          # 창 제목 · 트레이 · 바로가기에 그대로 쓰인다
DATA_DIR = os.path.join(_base, APP_NAME)
# 예전 이름들. 가까운 것부터. 이름을 또 바꾸면 여기 앞에 끼워 넣는다.
OLD_DATA_DIRS = [os.path.join(_base, "To-Do Manager"), os.path.join(_base, "오늘")]
DATA_FILE = os.path.join(DATA_DIR, "data.json")      # 내 일정 (나중에 다른 기기와 동기화할 대상)
STATE_FILE = os.path.join(DATA_DIR, "state.json")    # 이 PC 에만 해당하는 상태 (띄운 알림 기록)
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
TOKEN_FILE = os.path.join(DATA_DIR, "ipc.key")


UNBLOCKED = None        # unblock() 이 떼어낸 파일 수 (점검에서 보여주려고 기억한다)


def unblock():
    """묶여 온 DLL 에서 "인터넷에서 받은 파일" 표시를 뗀다.

    zip 을 받아 그냥 풀면 안쪽 파일마다 Zone.Identifier 라는 꼬리표가 붙는다.
    .NET Framework 는 이 표시가 붙은 어셈블리를 아예 읽지 않아서,
    Python.Runtime.dll 을 못 불러 창이 통째로 뜨지 않았다
    ("Failed to resolve Python.Runtime.Loader.Initialize").
    받는 사람이 zip 속성에서 "차단 해제" 를 누르기를 기대할 수는 없으니
    우리가 시작할 때 직접 뗀다. 꼬리표는 부속 스트림이라 파일 내용은 그대로다.
    """
    global UNBLOCKED
    if not FROZEN:
        UNBLOCKED = 0
        return 0
    import ctypes

    kernel32 = ctypes.windll.kernel32
    n = 0
    for root, _, files in os.walk(APP_DIR):
        for f in files:
            if not f.lower().endswith((".dll", ".pyd", ".exe")):
                continue
            tag = os.path.join(root, f) + ":Zone.Identifier"
            if kernel32.DeleteFileW(tag):
                n += 1
    if n:
        log("다운로드 표시를 %d개 파일에서 떼어냈다" % n)
    if UNBLOCKED is None:
        UNBLOCKED = n
    return n


def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)
    return DATA_DIR


def _copy(src, dst):
    try:
        with open(src, "rb") as a, open(dst, "wb") as b:
            b.write(a.read())
        return True
    except OSError:
        return False


def migrate_legacy():
    """예전 위치(프로그램 폴더 / 예전 이름의 APPDATA 폴더)에 있던 일정을 한 번만 옮겨온다.

    일정만 옮기면 안 된다. 되살릴 백업이 예전 폴더에 남아 있으면, 이름을 바꾼
    뒤 data.json 이 깨졌을 때 _backups() 가 텅 빈 새 폴더만 본다. 안전망이
    통째로 끊긴다. state.json(띄운 알림 기록)도 없으면 오늘 알림이 다시 뜬다.

    옮기는 것이 아니라 베껴 온다. 예전 폴더는 그대로 남아 한 벌 더인 셈이 된다.
    """
    if os.path.exists(DATA_FILE):
        return
    for old_dir in OLD_DATA_DIRS:
        old = os.path.join(old_dir, "data.json")
        if not os.path.exists(old):
            continue
        ensure_data_dir()
        if not _copy(old, DATA_FILE):
            return
        _copy(os.path.join(old_dir, "state.json"), STATE_FILE)
        old_backups = os.path.join(old_dir, "backups")
        if os.path.isdir(old_backups):
            try:
                os.makedirs(BACKUP_DIR, exist_ok=True)
                for n in os.listdir(old_backups):
                    _copy(os.path.join(old_backups, n), os.path.join(BACKUP_DIR, n))
            except OSError:
                pass            # 백업을 못 옮겨도 일정은 이미 옮겼다
        return
    legacy = os.path.join(APP_DIR, "data.json")
    if os.path.exists(legacy):
        ensure_data_dir()
        if _copy(legacy, DATA_FILE):
            try:
                os.replace(legacy, legacy + ".migrated")
            except OSError:
                pass


def log(msg, name="app.log"):
    """빌드본은 콘솔이 없다(sys.stderr is None). 무슨 일이 있어도 파일로 남긴다."""
    try:
        ensure_data_dir()
        import datetime as _dt
        path = os.path.join(DATA_DIR, name)
        if os.path.exists(path) and os.path.getsize(path) > 128 * 1024:
            os.replace(path, path + ".1")          # 무한히 커지지 않게 한 번만 보관
        with open(path, "a", encoding="utf-8") as f:
            f.write(_dt.datetime.now().strftime("%m-%d %H:%M:%S") + "  " + str(msg) + chr(10))
    except Exception:
        pass


def exe_path():
    """자동 실행 등록에 쓸 실행 명령."""
    if FROZEN:
        return sys.executable
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    runner = pyw if os.path.exists(pyw) else sys.executable
    return f'"{runner}" "{os.path.join(APP_DIR, "main.py")}"'


_token = None


def ipc_token():
    """서비스 · 앱 창 · 화면(웹 페이지)이 서로를 확인하는 비밀값.

    127.0.0.1 에서 듣는 서버에는 이 PC 의 모든 웹 페이지가 요청을 보낼 수 있다.
    예전에는 브라우저에 열린 아무 사이트나 일정을 지우고 자동 실행을 켤 수 있었다.
    이 값을 모르는 요청은 받지 않는다. 사용자 폴더에 두므로 창 프로세스도 같은 값을 읽는다.
    """
    global _token
    if _token:
        return _token
    ensure_data_dir()
    try:
        with open(TOKEN_FILE, "r", encoding="ascii") as f:
            t = f.read().strip()
        if len(t) >= 32:
            _token = t
            return t
    except (OSError, UnicodeDecodeError):
        pass
    t = os.urandom(32).hex()
    tmp = TOKEN_FILE + ".tmp"
    with open(tmp, "w", encoding="ascii") as f:
        f.write(t)
    os.replace(tmp, TOKEN_FILE)
    _token = t
    return t


def token_ok(value):
    """요청에 실려 온 비밀값이 맞는지. 글자마다 걸리는 시간이 같게 비교한다."""
    if not isinstance(value, str) or not value:
        return False
    try:
        from _operator import _compare_digest
    except ImportError:
        return value == ipc_token()
    return _compare_digest(value.encode("ascii", "replace"), ipc_token().encode("ascii"))
