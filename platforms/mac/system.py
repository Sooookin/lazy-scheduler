# -*- coding: utf-8 -*-
"""macOS 의 프로세스 · 파일 · 비밀 보관 · 배포본 모양. Windows 쪽은 platforms/win/system.py.

배포본은 LazyScheduler.app 하나다. 자동 업데이트는 이 .app 을 통째로 바꿔 끼운다.
서명(Apple 개발자 계정)이 없는 빌드라 PyInstaller 가 붙이는 임시 서명(ad-hoc)만 있다 -
처음 받은 사람은 우클릭 → 열기를 한 번 해야 하고, 그 뒤 앱이 스스로 받은 새 버전은
격리 표시가 붙지 않아 묻지 않고 켜진다.
"""
import fcntl
import hashlib
import hmac
import os
import signal
import subprocess
import time
import traceback
import webbrowser
import zipfile

from desktop import paths

# ---------------- 배포본 모양 (자동 업데이트가 쓴다) ----------------
ASSET = "LazyScheduler-mac.zip"        # 릴리스에서 받을 파일 (ditto 로 묶은 LazyScheduler.app)
APP = "LazyScheduler.app"
PROBE_MODULES = ("objc", "AppKit", "Foundation", "Quartz", "webview", "webview.platforms.cocoa",
                 "platforms.mac.cards", "platforms.mac.tray", "platforms.mac.window")


def install_dir():
    """바꿔 끼울 단위 = .app. 빌드본의 실행 파일은 LazyScheduler.app/Contents/MacOS/ 에 있다."""
    app = os.path.dirname(os.path.dirname(paths.APP_DIR))
    return app if app.endswith(".app") else paths.APP_DIR


def exe_in(folder):
    return os.path.join(folder, "Contents", "MacOS", "LazyScheduler")


def _check_names(z, root):
    """zip 안의 이름 · 심볼릭 링크가 root 밖을 가리키면 멈춘다 (.app 안에는 링크가 많다)."""
    for info in z.infolist():
        out = os.path.abspath(os.path.join(root, info.filename))
        if os.path.commonpath([root, out]) != root:
            raise ValueError("zip 안에 이상한 경로: %s" % info.filename)
        if (info.external_attr >> 16) & 0o170000 == 0o120000:            # 심볼릭 링크
            target = z.read(info).decode("utf-8", "replace")
            dest = os.path.abspath(os.path.join(os.path.dirname(out), target))
            if os.path.isabs(target) or os.path.commonpath([root, dest]) != root:
                raise ValueError("zip 안에 밖을 가리키는 링크: %s -> %s" % (info.filename, target))


def extract(zip_path, dest):
    """풀고 .app 경로를 돌려준다. zipfile 은 링크 · 실행 권한을 살리지 못해 ditto 로 푼다."""
    root = os.path.abspath(dest)
    os.makedirs(root, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        _check_names(z, root)
    subprocess.run(["ditto", "-x", "-k", zip_path, root], check=True, timeout=300,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    app = os.path.join(root, APP)
    if os.path.isfile(exe_in(app)):
        return app
    raise ValueError("zip 안에 %s 가 없다" % APP)


# ---------------- 프로세스 ----------------

def spawn(args, cwd=None, detach=False, quiet=True):
    """기다리지 않고 띄운다. detach 면 부른 쪽이 끝나도 살아남는다 (새 세션)."""
    null = subprocess.DEVNULL if quiet else None
    return subprocess.Popen(args, cwd=cwd, start_new_session=detach, stdin=null, stdout=null,
                            stderr=null, close_fds=True)


def run_quiet(args, cwd=None, timeout=None):
    return subprocess.run(args, cwd=cwd, timeout=timeout, stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def wait_pid(pid, timeout):
    """그 프로세스가 끝나기를 기다린다."""
    end = time.time() + timeout
    while time.time() < end and _alive(pid):
        time.sleep(0.2)


def kill_others():
    """이 프로세스 말고 우리 앱(…/Contents/MacOS/LazyScheduler)을 모두 끝낸다."""
    try:
        out = subprocess.run(["pgrep", "-f", "Contents/MacOS/LazyScheduler"], capture_output=True,
                             text=True, timeout=10).stdout
    except Exception:
        return
    for line in out.split():
        if line.isdigit() and int(line) != os.getpid():
            try:
                os.kill(int(line), signal.SIGKILL)
            except OSError:
                pass


_lock_file = None            # 열어 둬야 잠금이 유지된다


def single_instance():
    """이미 다른 서비스가 돌고 있으면 False. 데이터 폴더의 파일에 배타 잠금을 건다."""
    global _lock_file
    try:
        from desktop import ipc
        paths.ensure_data_dir()
        name = "service.lock" if ipc.SERVICE_PORT == 8777 else "service-%d.lock" % ipc.SERVICE_PORT
        f = open(os.path.join(paths.DATA_DIR, name), "a")
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            return False
        _lock_file = f
        return True
    except Exception:
        paths.log("단일 실행 잠금 실패(무시): " + traceback.format_exc())
        return True


def prepare_service():
    """macOS 는 창을 만들기 전에 할 일이 없다 (배율은 cards 가 화면마다 읽는다)."""


def open_in_browser(url):
    webbrowser.open(url)


def open_file(path):
    subprocess.Popen(["open", path])


# ---------------- 비밀 보관 (키체인) ----------------
# 로그인 토큰을 암호화할 열쇠를 이 사용자의 로그인 키체인에 둔다. auth.json 만 복사해 가서는
# 풀 수 없다. 암호화는 표준 라이브러리만으로: SHA-256 카운터 흐름 + HMAC-SHA256 (배포본에
# cryptography 를 넣지 않는다 - tools/build.py).
_SERVICE, _ACCOUNT = "LazyScheduler", "auth-key"
_MAGIC = b"LSK1"


def _key():
    try:
        r = subprocess.run(["security", "find-generic-password", "-s", _SERVICE, "-a", _ACCOUNT, "-w"],
                           capture_output=True, text=True, timeout=15)
        k = r.stdout.strip()
        if r.returncode == 0 and len(k) == 64:
            return bytes.fromhex(k)
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    k = os.urandom(32)
    r = subprocess.run(["security", "add-generic-password", "-U", "-s", _SERVICE, "-a", _ACCOUNT,
                        "-w", k.hex()], capture_output=True, timeout=15)
    if r.returncode != 0:
        raise OSError("키체인에 열쇠를 두지 못했다 (%d)" % r.returncode)
    return k


def _stream(key, nonce, n):
    out = bytearray()
    i = 0
    while len(out) < n:
        out += hashlib.sha256(key + nonce + i.to_bytes(8, "big")).digest()
        i += 1
    return bytes(out[:n])


def protect(data):
    """bytes → 이 사용자의 키체인 열쇠로만 풀 수 있는 bytes."""
    key = _key()
    nonce = os.urandom(16)
    ct = bytes(a ^ b for a, b in zip(data, _stream(key, nonce, len(data))))
    tag = hmac.new(key, _MAGIC + nonce + ct, hashlib.sha256).digest()
    return _MAGIC + nonce + tag + ct


def unprotect(blob):
    """protect() 의 반대. 열쇠가 다르거나(다른 Mac · 다른 사용자) 고쳐진 것이면 OSError."""
    if not blob.startswith(_MAGIC) or len(blob) < 4 + 16 + 32:
        raise OSError("알 수 없는 형식")
    nonce, tag, ct = blob[4:20], blob[20:52], blob[52:]
    key = _key()
    if not hmac.compare_digest(tag, hmac.new(key, _MAGIC + nonce + ct, hashlib.sha256).digest()):
        raise OSError("열쇠가 맞지 않는다")
    return bytes(a ^ b for a, b in zip(ct, _stream(key, nonce, len(ct))))

