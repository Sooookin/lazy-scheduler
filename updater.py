# -*- coding: utf-8 -*-
"""자동 업데이트 (PC 만). GitHub Releases 의 최신 릴리스가 더 새 버전이면 알아서 바꿔 끼운다.

    확인      켠 지 2분 뒤, 그 뒤로 6시간마다 releases/latest 를 본다 (로그인 없이 읽힌다)
    받기      LazyScheduler.zip 과 LazyScheduler.zip.sha256 (GitHub Actions 가 함께 올린다)
              크기와 SHA-256 이 맞아야 쓴다. 해시 파일이 없는 릴리스는 받지 않는다
    풀기      %APPDATA%\\LazyScheduler\\update\\<버전>\\LazyScheduler
    켜 보기   풀어 둔 새 exe 를 --probe 로 한 번 켠다. 부품을 다 불러오지 못하면 쓰지 않는다
    바꾸기    조용할 때만 (창이 숨은 지 10분 · 떠 있으면 손대지 않은 지 30분, 앞뒤 10분 안에 알림이
              없고, 떠 있는 카드가 없을 때). 창이 떠 있었으면 바꾼 뒤 다시 연다.
              새 exe 가 --apply-update 로 뒤를 맡고 서비스는 내려간다. 새 exe 는 옛 서비스가
              끝나기를 기다렸다가 앱 폴더를 <폴더>.old 로 비켜 두고 새 것을 그 자리에 놓은 뒤
              다시 켠다. 새 서비스가 30초 안에 포트를 열지 않으면 .old 를 되돌리고 옛 것을 켠다
    알리기    다음에 창을 열 때 "새 버전으로 바꿨습니다" 창을 한 번 (닫으면 다시 뜨지 않는다)
    손으로    설정의 [업데이트 확인] 은 기다리지 않고 바로 확인 · 받기, 받아 두었으면 [지금 업데이트] 가
              조용한 때를 기다리지 않고 바꾼 뒤 창을 다시 연다

일정(data.json)은 %APPDATA% 에 있어 앱 폴더를 통째로 바꿔도 그대로다. 바로가기 · 자동 실행도
같은 경로의 exe 를 가리키므로 손댈 것이 없다. 소스로 돌 때(개발)는 아무것도 하지 않는다.
"""
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import zipfile

import paths
import version

REPO = "Sooookin/lazy-scheduler"
LATEST_URL = "https://api.github.com/repos/%s/releases/latest" % REPO
ASSET = "LazyScheduler.zip"
HASH_ASSET = ASSET + ".sha256"
EXE = "LazyScheduler.exe"

FIRST_CHECK_S = 120             # 켜자마자 묻지 않는다 - 켜는 동안은 할 일이 많다
CHECK_EVERY_S = 6 * 3600
QUIET_EVERY_S = 5 * 60          # 받아 둔 것이 있으면 이만큼마다 조용한지 본다
QUIET_UI_S = 10 * 60            # 창이 숨은 뒤 이만큼 지나면 비어 있다고 본다
QUIET_UI_OPEN_S = 30 * 60       # 창이 떠 있으면 이만큼 손대지 않아야 (자리를 비운 것이다)
QUIET_ALERT_MIN = 10            # 앞뒤 이 분 안에 알림이 있으면 미룬다
HTTP_TIMEOUT_S = 30
PROBE_TIMEOUT_S = 90
MAX_ZIP = 200 * 1024 * 1024     # 이보다 큰 것은 우리 zip 이 아니다
START_WAIT_S = 30               # 바꾼 뒤 새 서비스가 포트를 열기를 기다리는 시간

UPDATE_DIR = os.path.join(paths.DATA_DIR, "update")
STATE_FILE = os.path.join(paths.DATA_DIR, "update.json")

_lock = threading.Lock()
_status = {"state": "idle", "latest": "", "checked": "", "error": ""}


def log(msg):
    paths.log(msg, name="update.log")


# ---------------- 버전 ----------------

def parse(tag):
    """'v2.4.0' · '2.4' → (2, 4, 0). 숫자 버전이 아니면 None."""
    m = re.match(r"^v?(\d+)\.(\d+)(?:\.(\d+))?$", (tag or "").strip())
    if not m:
        return None
    return tuple(int(x or 0) for x in m.groups())


def newer(tag, cur=None):
    """tag 가 지금 버전보다 새것인지."""
    a, b = parse(tag), parse(cur or version.VERSION)
    return bool(a and b and a > b)


# ---------------- 상태 파일 (이 PC 에만. 동기화하지 않는다) ----------------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(d):
    paths.ensure_data_dir()
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_FILE)


def _edit_state(fn):
    with _lock:
        d = load_state()
        fn(d)
        save_state(d)
        return d


# ---------------- 릴리스 고르기 · 받기 ----------------

def pick(release):
    """releases/latest 응답에서 쓸 것만. 초안 · 시험판이거나 zip · 해시가 없으면 None."""
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        return None
    tag = release.get("tag_name") or ""
    if not parse(tag):
        return None
    assets = {a.get("name"): a for a in release.get("assets") or [] if isinstance(a, dict)}
    z, h = assets.get(ASSET), assets.get(HASH_ASSET)
    if not z or not h or not z.get("browser_download_url") or not h.get("browser_download_url"):
        return None
    return {"tag": tag, "version": tag.lstrip("v"), "zip_url": z["browser_download_url"],
            "zip_size": int(z.get("size") or 0), "hash_url": h["browser_download_url"],
            "notes": (release.get("body") or "").strip()}


def _open(url, accept=None):
    req = urllib.request.Request(url, headers={
        "User-Agent": "LazyScheduler/%s" % version.VERSION,
        "Accept": accept or "application/octet-stream"})
    return urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S)


def fetch_latest():
    with _open(LATEST_URL, "application/vnd.github+json") as r:
        return json.loads(r.read().decode("utf-8"))


def read_hash(text):
    """'<64자리 16진수>  LazyScheduler.zip' 에서 해시만. 없으면 ''."""
    m = re.search(r"\b([0-9a-fA-F]{64})\b", text or "")
    return m.group(1).lower() if m else ""


def download(url, dest, size):
    """dest 로 받고 SHA-256 을 돌려준다. 크기가 다르거나 너무 크면 멈춘다."""
    h = hashlib.sha256()
    got = 0
    tmp = dest + ".part"
    with _open(url) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            got += len(chunk)
            if got > MAX_ZIP:
                raise ValueError("파일이 너무 크다")
            h.update(chunk)
            f.write(chunk)
    if size and got != size:
        raise ValueError("크기가 다르다 (%d / %d)" % (got, size))
    os.replace(tmp, dest)
    return h.hexdigest()


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


def probe(exe):
    """새 exe 를 --probe 로 켜 본다. 부품을 다 불러오면 'ok <버전>' 을 파일에 남긴다."""
    out = os.path.join(os.path.dirname(exe), "probe.txt")
    try:
        os.remove(out)
    except OSError:
        pass
    try:
        subprocess.run([exe, "--probe", out], cwd=os.path.dirname(exe), timeout=PROBE_TIMEOUT_S,
                       creationflags=0x08000000, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(out, encoding="utf-8") as f:
            text = f.read()
    except (OSError, subprocess.SubprocessError) as e:
        return False, str(e)
    return text.startswith("ok "), text.strip()[:400]


def prepare(rel):
    """받아서 · 맞춰 보고 · 풀고 · 켜 본다. 끝나면 상태 파일에 pending 으로 남긴다."""
    ver = rel["version"]
    base = os.path.join(UPDATE_DIR, ver)
    shutil.rmtree(base, ignore_errors=True)
    os.makedirs(base, exist_ok=True)
    with _open(rel["hash_url"]) as r:
        want = read_hash(r.read(4096).decode("utf-8", "replace"))
    if not want:
        raise ValueError("해시 파일을 읽지 못했다")
    zpath = os.path.join(base, ASSET)
    got = download(rel["zip_url"], zpath, rel["zip_size"])
    if got != want:
        raise ValueError("해시가 다르다")
    staged = extract(zpath, os.path.join(base, "files"))
    os.remove(zpath)
    ok, why = probe(os.path.join(staged, EXE))
    if not ok:
        raise ValueError("새 버전을 켜 보지 못했다: " + why)
    _edit_state(lambda d: d.update(pending={"version": ver, "dir": staged, "notes": rel["notes"]}))
    log("받아 둠: %s (%s)" % (ver, staged))


# ---------------- 조용한 때 ----------------

def quiet(ui_idle_s, alert_near, cards_busy, window_open=False):
    """지금 바꿔 끼워도 되는지. (bool, 이유)"""
    if ui_idle_s < (QUIET_UI_OPEN_S if window_open else QUIET_UI_S):
        return False, "창을 쓰는 중"
    if alert_near:
        return False, "곧 알림이 있다"
    if cards_busy:
        return False, "알림 카드가 떠 있다"
    return True, ""


# ---------------- 바꿔 끼우기 (새 exe 가 한다) ----------------

def swap(target, staged, tries=60, wait=0.5):
    """target 을 target.old 로 비키고 staged 를 target 에 놓는다. .old 경로를 돌려준다.

    옛 프로세스가 막 끝난 참이라 파일이 잠깐 잠겨 있을 수 있어 이름 바꾸기를 몇 번 되풀이한다.
    놓다가 실패하면 되돌리고 다시 올린다.
    """
    target = os.path.abspath(target).rstrip("\\/")
    old = target + ".old"
    shutil.rmtree(old, ignore_errors=True)
    for k in range(tries):
        try:
            os.rename(target, old)
            break
        except OSError:
            if k == tries - 1:
                raise
            time.sleep(wait)
    try:
        shutil.copytree(staged, target)
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        os.rename(old, target)
        raise
    return old


def rollback(target, old):
    target = os.path.abspath(target).rstrip("\\/")
    shutil.rmtree(target, ignore_errors=True)
    os.rename(old, target)


def _wait_pid(pid, timeout):
    """옛 서비스가 끝나기를 기다린다."""
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x00100000, False, int(pid))          # SYNCHRONIZE
        if h:
            k32.WaitForSingleObject(h, int(timeout * 1000))
            k32.CloseHandle(h)
    except Exception:
        time.sleep(3)


def _port_open(timeout):
    import ipc
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection((ipc.HOST, ipc.SERVICE_PORT), 1):
                return True
        except OSError:
            time.sleep(1)
    return False


def _launch(exe, open_window=False):
    """다시 켠다. 손으로 [지금 업데이트] 를 눌렀으면 창까지 연다 (보던 사람이 있다)."""
    subprocess.Popen([exe] if open_window else [exe, "--silent"], cwd=os.path.dirname(exe),
                     creationflags=0x00000008 | 0x00000200,            # DETACHED · 새 프로세스 묶음
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True)


def apply_main(argv):
    """main.py --apply-update <앱 폴더> <풀어 둔 폴더> <옛 서비스 pid> <옛 버전> [open]"""
    try:
        target, staged, pid, was = argv[:4]
    except ValueError:
        return 2
    show = len(argv) > 4 and argv[4] == "open"
    log("바꾸기 시작: %s → %s (옛 %s)" % (staged, target, was))
    _wait_pid(pid, 30)
    try:
        old = swap(target, staged)
    except Exception:
        log("바꾸기 실패, 옛 것 그대로: " + traceback.format_exc())
        _edit_state(lambda d: d.update(failed=version.VERSION, pending=None))
        _launch(os.path.join(target, EXE), show)
        return 1
    _launch(os.path.join(target, EXE), show)
    if not _port_open(START_WAIT_S):
        log("새 버전이 뜨지 않아 되돌림")
        try:
            subprocess.run(["taskkill", "/F", "/IM", EXE, "/FI", "PID ne %d" % os.getpid()],
                           creationflags=0x08000000, timeout=15,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1)
            rollback(target, old)
        except Exception:
            log("되돌리기 실패: " + traceback.format_exc())
        _edit_state(lambda d: d.update(failed=version.VERSION, pending=None))
        _launch(os.path.join(target, EXE), show)
        return 1
    _edit_state(lambda d: d.update(pending=None, failed=None, cleanup=old,
                                   just_updated={"from": was, "to": version.VERSION,
                                                 "notes": (d.get("pending") or {}).get("notes", "")}))
    log("바꿈: %s → %s" % (was, version.VERSION))
    return 0


def probe_main(argv):
    """main.py --probe <결과 파일>: 새 버전이 제 부품을 다 불러오는지 (창 · 서버는 띄우지 않는다)."""
    out = argv[0] if argv else None
    try:
        for mod in ("store", "recur", "syncdoc", "tokens", "toast", "tray", "cloudsync",
                    "PIL.Image", "PIL.ImageDraw", "pystray._win32", "clr", "webview",
                    "webview.platforms.edgechromium", "ssl", "app"):
            __import__(mod)
        text = "ok %s" % version.VERSION
        code = 0
    except Exception:
        text = "fail " + traceback.format_exc()
        code = 1
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
    return code


# ---------------- 서비스 쪽 ----------------

def status():
    """설정 창에 보일 것."""
    d = load_state()
    s = dict(_status, version=version.VERSION, dev=not paths.FROZEN)
    if d.get("pending"):
        s["state"] = "ready"
        s["latest"] = d["pending"].get("version", "")
    return s


def notice():
    """다음에 창을 열 때 한 번 보여 줄 것. 없으면 None."""
    j = load_state().get("just_updated")
    return j if isinstance(j, dict) and not j.get("seen") else None


def mark_seen():
    def f(d):
        if isinstance(d.get("just_updated"), dict):
            d["just_updated"]["seen"] = True
    _edit_state(f)


def cleanup():
    """바꾼 뒤 처음 켰을 때: 비켜 둔 옛 폴더 · 받아 둔 파일을 치운다."""
    d = load_state()
    old = d.get("cleanup")
    if old and os.path.abspath(old) != os.path.abspath(paths.APP_DIR):
        shutil.rmtree(old, ignore_errors=True)
    if not d.get("pending"):
        shutil.rmtree(UPDATE_DIR, ignore_errors=True)
    if old:
        _edit_state(lambda d: d.pop("cleanup", None))


def check_once():
    """한 번 확인하고, 새것이면 받아 둔다."""
    _status.update(state="checking", error="")
    try:
        rel = pick(fetch_latest())
        _status["checked"] = time.strftime("%m-%d %H:%M")
        if not rel:
            _status.update(state="idle")
            return
        _status["latest"] = rel["version"]
        st = load_state()
        if not newer(rel["tag"]) or st.get("failed") == rel["version"]:
            _status.update(state="idle")
            return
        if (st.get("pending") or {}).get("version") == rel["version"]:
            _status.update(state="ready")
            return
        if not paths.FROZEN:                     # 소스로 도는 중: 새것이 있다는 것만 알린다
            _status.update(state="available")
            return
        _status.update(state="downloading")
        prepare(rel)
        _status.update(state="ready")
    except Exception as e:
        _status.update(state="error", error=str(e)[:200])
        log("확인 · 받기 실패: " + traceback.format_exc())


_checking = threading.Lock()


def check_now():
    """설정의 [업데이트 확인]. 뒤에서 한 번 돈다 (이미 도는 중이면 그대로). 화면은 status() 로 본다."""
    def run():
        if _checking.acquire(blocking=False):
            try:
                check_once()
            finally:
                _checking.release()
    _status.update(state="checking", error="")
    threading.Thread(target=run, daemon=True, name="update-check").start()


def apply_pending(shutdown, open_window=False):
    """받아 둔 새 버전으로 바꾼다: 새 exe 에게 뒤를 맡기고 서비스를 내린다."""
    p = load_state().get("pending") or {}
    staged = p.get("dir")
    exe = os.path.join(staged or "", EXE)
    if not staged or not os.path.isfile(exe):
        _edit_state(lambda d: d.update(pending=None))
        return False
    log("조용함 → %s 로 바꾸러 감" % p.get("version"))
    subprocess.Popen([exe, "--apply-update", paths.APP_DIR, staged, str(os.getpid()), version.VERSION]
                     + (["open"] if open_window else []),
                     cwd=staged, creationflags=0x00000008 | 0x00000200 | 0x08000000,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     close_fds=True)
    shutdown()
    return True


def start(enabled, is_quiet, shutdown, window_open=lambda: False):
    """서비스가 켤 때 부른다. enabled() 는 설정의 '자동 업데이트', is_quiet() 는 (bool, 이유),
    window_open() 은 지금 창이 보이는지 (보였으면 바꾼 뒤 다시 연다)."""
    if not paths.FROZEN:
        return

    def loop():
        time.sleep(90)
        try:
            cleanup()
        except Exception:
            log("정리 실패: " + traceback.format_exc())
        time.sleep(max(0, FIRST_CHECK_S - 90))
        last = 0
        while True:
            try:
                if enabled():
                    if time.time() - last >= CHECK_EVERY_S and _checking.acquire(blocking=False):
                        last = time.time()
                        try:
                            check_once()
                        finally:
                            _checking.release()
                    if load_state().get("pending"):
                        ok, why = is_quiet()
                        if ok and apply_pending(shutdown, open_window=window_open()):
                            return
            except Exception:
                log("업데이트 고리 오류: " + traceback.format_exc())
            time.sleep(QUIET_EVERY_S)

    threading.Thread(target=loop, daemon=True, name="updater").start()
