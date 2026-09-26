# -*- coding: utf-8 -*-
"""LazyScheduler - 백그라운드 서비스: API 서버 + 알림 스케줄러 + 알림 카드 루프."""
import ctypes, json, os, socket, subprocess, sys, threading, time, traceback, webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import autostart
import cloudauth
import cloudsync
import ipc
import paths
import recur, store, toast, tray
import updater
import version

BASE = paths.APP_DIR
WEB = os.path.normpath(paths.WEB_DIR)
HOST, PORT = ipc.HOST, ipc.SERVICE_PORT
LATE_GRACE = 90                 # 마감이 지난 뒤에도 이 분 안에는 알린다
URL = f"http://{HOST}:{PORT}/"
NO_WINDOW = 0x08000000
MAX_BODY = 256 * 1024           # 요청 본문 한도. 일정 한 건은 수 KB 를 넘지 않는다
DRAIN_MAX = 64 * 1024           # 거절한 뒤 흘려 버릴 최대 바이트
DRAIN_WAIT = 0.25               # 그때 기다릴 시간(초)
TOKEN_HEADER = ipc.TOKEN_HEADER
TOKEN_SLOT = b"__TM_TOKEN__"    # index.html 에서 비밀값으로 바꿔 끼울 자리
WEEK = "월화수목금토일"
# HTTP API 의 약속 번호. 응답 형식을 깨는 변경(필드를 빼거나 뜻을 바꿈)을 하면 올린다.
# 필드를 더하는 것은 깨는 변경이 아니다. 다른 화면(휴대폰 앱 등)은 /api/ping 으로 확인한다.
API_VERSION = 1
SPAN_MAX = 750                  # 한 번에 펼칠 수 있는 최대 기간(일)

BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def log(msg):
    """빌드본은 콘솔이 없다. 문제를 파일로 남긴다."""
    paths.log(msg)


class Server(ThreadingHTTPServer):
    """allow_reuse_address 를 반드시 꺼야 한다.

    http.server 는 기본값이 1 이고, Windows 의 SO_REUSEADDR 은 리눅스와 달리
    "이미 듣고 있는 주소에 또 bind 하는 것"을 허용한다. 그래서 bind 성공 여부로
    중복 실행을 판단할 수 없었고, 앱을 다시 켤 때마다 서비스가 하나씩 늘어났다.
    (스케줄러도 같이 늘어나 알림이 겹쳐 떴다)
    """
    allow_reuse_address = False
    daemon_threads = True


_lock_handle = None          # 핸들을 살려둬야 잠금이 유지된다


def acquire_single_instance():
    """이미 다른 인스턴스가 돌고 있으면 False."""
    global _lock_handle
    try:
        # use_last_error 가 없으면 ctypes 가 중간에 오류 번호를 덮어써 판단이 흔들린다
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateMutexW.restype = ctypes.c_void_p
        k32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
        h = k32.CreateMutexW(None, False, r"Local\LazyScheduler.Service")
        if h and ctypes.get_last_error() == 183:        # ERROR_ALREADY_EXISTS
            return False
        _lock_handle = h
        return True
    except Exception:
        log("단일 실행 잠금 실패(무시): " + traceback.format_exc())
        return True


def _dpi_aware():
    """화면 배율(125%·150%)에서 알림 카드가 흐리지 않게 한다.

    DPI 를 모른다고 두면 Windows 가 100% 로 그린 카드를 늘려서 뿌옇게 보인다.
    선언하고 나면 카드 크기는 toast.py 가 배율에 맞춰 직접 키워 그린다.
    창을 하나라도 만들기 전에 불러야 한다.
    """
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)      # PROCESS_SYSTEM_DPI_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def focus_ui():
    """이미 떠 있는 창을 앞으로 불러온다. 창이 없으면 False.

    창 프로세스를 새로 띄우는 데 몇 초가 걸리므로, 살아 있는 창이 있으면
    프로세스를 만들지 않고 그 창을 쓴다.
    """
    return ipc.post(ipc.UI_PORT, "/focus", timeout=0.5) == 200


def _spawn_ui(*flags):
    """창 프로세스(main.py --ui)를 띄운다. 기다리지 않는다."""
    if paths.FROZEN:
        # --windowed 빌드는 표준 입출력 핸들이 없다. 명시하지 않으면
        # Popen 이 부모 핸들을 복제하려다 실패할 수 있다.
        subprocess.Popen([sys.executable, "--ui", *flags], cwd=BASE,
                         creationflags=NO_WINDOW,
                         stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen([paths.python_runner(), os.path.join(BASE, "main.py"), "--ui", *flags],
                         cwd=BASE, creationflags=NO_WINDOW)


def open_window():
    """앱 창을 새 프로세스로 띄운다. pywebview 를 못 쓰면 Edge 앱 창으로 폴백."""
    if focus_ui():
        log("open_window: 이미 떠 있는 창을 앞으로 불러왔다")
        return
    log(f"open_window: frozen={paths.FROZEN} exe={sys.executable!r}")
    try:
        __import__("webview")        # 네이티브 창을 쓸 수 있는지 확인만 한다
        _spawn_ui()
        log("open_window: 창 프로세스 생성 요청 완료")
        return
    except Exception:
        log("네이티브 창 실패 -> Edge 폴백: " + traceback.format_exc())
    profile = os.path.join(os.environ.get("LOCALAPPDATA", BASE), "LazyScheduler", "browser")
    for exe in BROWSERS:
        if os.path.exists(exe):
            subprocess.Popen([exe, f"--app={URL}", f"--user-data-dir={profile}",
                              "--window-size=1020,880", "--no-first-run"],
                             creationflags=NO_WINDOW)
            return
    webbrowser.open(URL)


_hinted = False


def _hint_hidden():
    """창을 닫았을 때 한 번만: 프로그램이 살아 있다는 것을 알려 준다.

    Windows 11 은 새 알림영역 아이콘을 기본으로 숨긴다(^ 안쪽). 그래서 창을
    닫으면 살아 있다는 표시가 화면에 하나도 남지 않아 "그냥 꺼졌다" 로 보인다.
    """
    global _hinted
    if _hinted:
        return
    _hinted = True
    # 한 줄이면 된다. 긴 설명은 창을 닫자마자 읽게 할 것이 아니고, 어차피 읽지도 않는다.
    # 스쳐 지나가는 안내라 1.6초 뒤 저절로 사라지고, 눌러도 창이 다시 열리지 않는다.
    toast.notify("창만 닫았습니다", "알림은 계속 동작합니다", accent="#85bdb3",
                 key="hint:hidden", can_open=False, extra={"life": 1.6})


def close_ui():
    """창 프로세스에 종료를 알린다. 창이 없으면 그냥 넘어간다."""
    ipc.post(ipc.UI_PORT, "/quit", timeout=0.6)


def shutdown():
    """앱 전체 종료: 창 프로세스를 먼저 닫고 서비스를 내린다.
    서비스와 창은 별도 프로세스라, 서비스만 죽이면 창이 남는다."""
    close_ui()
    tray.stop()          # 아이콘을 먼저 치운다. 그냥 끝내면 알림영역에 잔상이 남았다
    threading.Timer(0.4, lambda: os._exit(0)).start()


# ---------------- HTTP ----------------
class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


STATIC_TYPES = {"html": "text/html; charset=utf-8", "css": "text/css; charset=utf-8",
                "js": "text/javascript; charset=utf-8", "png": "image/png",
                "svg": "image/svg+xml", "ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    """이 PC 의 모든 웹 페이지가 127.0.0.1 로 요청을 보낼 수 있다는 전제로 막는다.

      · Host 가 우리 주소가 아니면 거절한다. (DNS rebinding: 남의 도메인을
        127.0.0.1 로 돌려 두고 그 사이트 이름으로 우리 데이터를 읽는 수법)
      · 다른 출처(Origin)에서 온 요청은 거절한다.
      · /api/ 는 비밀값(X-TM-Token)이 있어야 한다. 화면은 index.html 에 심어 준 값을 쓴다.
        다른 사이트는 동일 출처 정책 때문에 index.html 을 읽을 수 없어 값을 모른다.
      · POST 는 application/json 만 받는다. 다른 사이트가 폼이나 no-cors fetch 로
        보낼 수 있는 형식(text/plain 등)을 막는다.
    """
    server_version = "LazyScheduler"
    sys_version = ""

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        try:
            self.wfile.write(data)
        except Exception:
            pass

    def finish(self):
        """응답을 보낸 뒤 곱게 닫는다.

        읽지 않은 요청 본문을 남긴 채 소켓을 닫으면 윈도가 RST 를 보낸다.
        그러면 보낸 쪽은 우리가 적어 보낸 403 · 413 · 415 대신 "연결이 끊겼다"
        만 보게 되어, 왜 막혔는지 알 수 없다. 창이 띄우는 문구도 실제 이유
        대신 "프로그램에 연결할 수 없습니다" 가 된다.

        본문이 한도를 넘는 요청은 일부러 읽지 않으므로(읽어 주는 것이 바로
        공격이 노리는 바다) 이 경우가 드물지 않다. 그래서 보내는 쪽을 먼저
        닫아 응답이 확실히 건너가게 하고, 남은 요청 바이트는 잠깐만, 그것도
        정해진 양까지만 흘려 버린 뒤 닫는다.
        """
        left = self._unread()
        if left:
            try:
                self.wfile.flush()
                self.connection.shutdown(socket.SHUT_WR)
                self.connection.settimeout(DRAIN_WAIT)
                todo = min(left, DRAIN_MAX)
                while todo > 0:
                    chunk = self.rfile.read(min(todo, 16384))
                    if not chunk:
                        break
                    todo -= len(chunk)
            except Exception:
                pass
        BaseHTTPRequestHandler.finish(self)

    def _unread(self):
        """알려 온 길이 중 아직 읽지 않은 바이트 수."""
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except (AttributeError, TypeError, ValueError):
            return 0
        return max(0, n - getattr(self, "_read_bytes", 0))

    def _guard(self, api):
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        if (self.headers.get("Host") or "").lower() not in hosts:
            raise ApiError(403, "허용되지 않은 주소입니다")
        origin = self.headers.get("Origin")
        if origin is not None and origin.lower() not in {"http://" + h for h in hosts}:
            raise ApiError(403, "허용되지 않은 출처입니다")
        if api and not paths.token_ok(self.headers.get(TOKEN_HEADER)):
            raise ApiError(403, "인증되지 않은 요청입니다")

    def _overview(self):
        o = store.overview()
        o["settings"] = dict(o["settings"], autostart=autostart.is_enabled())
        o["version"] = version.VERSION
        o["update"] = updater.notice()            # 바꾼 뒤 처음 여는 창에 한 번 보여 줄 것
        return o

    def _query(self, name):
        q = parse_qs(urlparse(self.path).query).get(name)
        return q[0] if q else None

    def _span(self, name, default):
        """/api/all 의 기간(일). 너무 긴 기간은 반복 규칙을 그만큼 펼쳐야 해서 막는다."""
        raw = self._query(name)
        if raw is None:
            return default
        try:
            v = int(raw)
        except (TypeError, ValueError):
            raise ApiError(400, "기간이 올바르지 않습니다") from None
        if not (0 <= v <= SPAN_MAX):
            raise ApiError(400, "기간은 0~%d일 사이여야 합니다" % SPAN_MAX)
        return v

    def _range(self):
        """from · to (YYYY-MM-DD, 둘 다 포함). 너무 길거나 거꾸로면 400."""
        try:
            lo = date.fromisoformat(self._query("from") or "")
            hi = date.fromisoformat(self._query("to") or "")
        except ValueError:
            raise ApiError(400, "from · to 는 YYYY-MM-DD 날짜여야 합니다") from None
        if hi < lo:
            raise ApiError(400, "to 가 from 보다 앞섭니다")
        if (hi - lo).days > SPAN_MAX:
            raise ApiError(400, "기간은 %d일을 넘을 수 없습니다" % SPAN_MAX)
        return lo, hi

    def _kinds(self):
        raw = self._query("kind")
        if not raw:
            return None
        kinds = tuple(k for k in raw.split(",") if k)
        if not kinds or any(k not in store.KINDS for k in kinds):
            raise ApiError(400, "kind 는 %s 중에서 고릅니다" % ", ".join(store.KINDS))
        return kinds

    def _body(self):
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise ApiError(415, "JSON 요청만 받습니다")
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "요청 길이가 올바르지 않습니다") from None
        if n < 0 or n > MAX_BODY:
            raise ApiError(413, "요청이 너무 큽니다")
        raw = self.rfile.read(n) if n else b"{}"
        self._read_bytes = len(raw)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(400, "요청 형식이 올바르지 않습니다") from None
        if not isinstance(body, dict):
            raise ApiError(400, "요청 형식이 올바르지 않습니다")
        return body

    def _handle(self, fn):
        """어떤 요청도 연결을 그냥 끊지 않고, 화면에 보여줄 수 있는 문장으로 답한다.

        예전에는 GET 에서 예외가 나면 응답 없이 연결이 끊겨 화면이 통째로 비었다.
        """
        try:
            fn()
        except ApiError as e:
            self._send(e.code, {"error": str(e)})
        except store.ValidationError as e:
            self._send(400, {"error": str(e)})
        except store.NotFoundError as e:
            self._send(404, {"error": str(e)})
        except store.StoreError as e:
            log("저장소 오류: %s" % e)
            self._send(503, {"error": str(e)})
        except cloudauth.AuthError as e:
            self._send(400, {"error": str(e)})
        except Exception:
            log("요청 처리 실패 %s %s\n%s" % (self.command, self.path, traceback.format_exc()))
            self._send(500, {"error": "처리 중 오류가 발생했습니다. 로그를 확인하세요."})

    def do_GET(self):
        self._handle(self._get)

    def do_POST(self):
        self._handle(self._post)

    def _get(self):
        p = self.path.split("?")[0]
        if not p.startswith("/api/"):
            self._guard(api=False)
            return self._static(p)
        self._guard(api=True)
        if p == "/api/overview":
            return self._send(200, self._overview())
        if p == "/api/notify-plan":
            return self._send(200, notify_plan())
        if p == "/api/suggest":
            # 루틴 편집기의 뼈대: 예시 날짜 + 단위(+간격) → 그 날에 도는 규칙들.
            # 사람이 고르는 것은 "그 주기 안에서 언제" 하나뿐이다 (recur.suggest).
            try:
                day = date.fromisoformat(self._query("date") or "")
            except ValueError:
                raise ApiError(400, "date 는 YYYY-MM-DD 날짜여야 합니다") from None
            unit = self._query("unit") or "month"
            if unit not in recur.UNITS:
                raise ApiError(400, "unit 은 day · week · month · year 중 하나여야 합니다")
            try:
                every = int(self._query("every") or 1)
            except ValueError:
                raise ApiError(400, "every 는 숫자여야 합니다") from None
            if not 1 <= every <= 52:
                raise ApiError(400, "every 는 1~52 사이여야 합니다")
            # 규칙마다 앞으로의 날짜 셋을 함께 준다. 화면은 눌러 보기 전에
            # 그 규칙이 언제 도는지 보여 준다 (자리를 더 쓰지 않으려고).
            items = []
            for it in recur.suggest(day, unit, every):
                ds = recur.occurrences(it["rule"], day, day + timedelta(days=430))[:3]
                items.append(dict(it, dates=[f"{d.month}/{d.day}({WEEK[d.weekday()]})" for d in ds]))
            return self._send(200, {"items": items})
        if p == "/api/sync":
            return self._send(200, sync_status())
        if p == "/api/update":
            return self._send(200, updater.status())
        if p == "/api/ping":
            # 화면이 자기가 아는 약속으로 이야기하고 있는지 확인할 때 쓴다
            return self._send(200, {"ok": True, "api": API_VERSION, "schema": store.SCHEMA_VERSION})
        if p == "/api/occurrences":
            # 기간 안의 회차만: 누가 · 언제 · 했는지. 제목 · 규칙 같은 항목 내용은
            # overview 에 한 번만 실려 있으니 여기서 회차마다 되풀이하지 않는다.
            # 기간은 날짜로 받는다 - "오늘부터 며칠" 은 묻는 쪽과 서버의 오늘이
            # 다르면(시간대 · 자정 무렵) 엉뚱한 달을 준다.
            lo, hi = self._range()
            return self._send(200, store.occurrences(lo, hi, kinds=self._kinds()))
        if p == "/api/all":
            # 달력은 보고 있는 달만 물어본다. 기간을 안 주면 예전처럼 -60 / +120.
            back = self._span("back", 60)
            ahead = self._span("ahead", 120)
            return self._send(200, {"items": store.instances(back=back, ahead=ahead)})
        raise ApiError(404, "없는 경로입니다")

    def _static(self, p):
        rel = "index.html" if p == "/" else unquote(p).lstrip("/")
        path = os.path.normpath(os.path.join(WEB, rel))
        try:
            inside = os.path.commonpath([WEB, path]) == WEB
        except ValueError:                       # 다른 드라이브
            inside = False
        if not inside or not os.path.isfile(path):
            raise ApiError(404, "not found")
        ext = path.rsplit(".", 1)[-1].lower()
        with open(path, "rb") as f:
            data = f.read()
        if ext == "html":
            data = data.replace(TOKEN_SLOT, paths.ipc_token().encode("ascii"))
        # 화면 파일(html·css·js)은 no-store 여야 업데이트가 바로 보인다. 글꼴은
        # 한 벌에 160KB 짜리 한글 세 벌이라 창을 열 때마다 480KB 를 다시 받고
        # 다시 해석하고 있었다. 글꼴은 좀처럼 바뀌지 않으므로 하루 동안 들고 있게 한다
        # (바꿔야 하면 tools/build_fonts.py 의 파일 이름을 바꾸면 곧바로 반영된다).
        cache = "public, max-age=86400" if ext == "woff2" else "no-store"
        return self._send(200, data, STATIC_TYPES.get(ext, "application/octet-stream"), cache)

    def _post(self):
        p = self.path.split("?")[0]
        self._guard(api=True)
        body = self._body()
        if p == "/api/task" or p.startswith("/api/task/") or p == "/api/settings":
            out = self._change(p, body)
            _WAKE.set()
            # ?ov=1 이면 바뀐 뒤의 개요를 함께 싣는다. 창은 무언가 누를 때마다 "바꿔 줘" 를
            # 보내고 곧이어 개요를 또 물었다 - 왕복 두 번이 한 번이 된다.
            if self._query("ov"):
                out = dict(out, overview=self._overview())
            return self._send(200, out)
        self._command(p, body)

    def _change(self, p, body):
        """일정 · 설정을 바꾸는 요청. 보낼 본문을 돌려준다 (보내는 것은 _post)."""
        if p == "/api/task":
            return store.add(body)
        if p.startswith("/api/task/"):
            parts = p.split("/")                 # ['', 'api', 'task', <id>, <동작>]
            if len(parts) > 5:
                raise ApiError(404, "없는 경로입니다")
            tid = unquote(parts[3])
            act = parts[4] if len(parts) == 5 else ""
            if act == "":
                return store.update(tid, body)
            if act == "done":
                return store.set_done(tid, body.get("date"), body.get("done", True))
            if act == "skip":
                return store.skip(tid, body.get("date"))
            if act == "unskip":
                return store.unskip(tid, body.get("date"))
            if act == "delete":
                store.remove(tid)
                return {"ok": True}
            raise ApiError(404, "없는 경로입니다")
        if p == "/api/settings":
            auto = body.pop("autostart", None)
            if auto is not None and not isinstance(auto, bool):
                raise store.ValidationError("요청 형식이 올바르지 않습니다")
            st = store.update_settings(body)     # 확인이 끝난 뒤에만 레지스트리를 건드린다
            if auto is not None:
                autostart.set_enabled(auto)
            return dict(st, autostart=autostart.is_enabled())
        raise ApiError(404, "없는 경로입니다")

    def _command(self, p, body):
        """그 밖의 요청: 미리보기 · 동기화 · 창 · 종료."""
        if p == "/api/preview":
            return self._send(200, preview(body.get("rule")))
        if p == "/api/sync/signin":
            # 브라우저가 열리고, 사람이 로그인을 마칠 때까지 뒤에서 기다린다.
            # 화면은 GET /api/sync 로 진행을 본다.
            cloudauth.start_sign_in()
            return self._send(200, sync_status())
        if p == "/api/sync/signout":
            cloudauth.sign_out()
            return self._send(200, sync_status())
        if p == "/api/sync/now":
            cloudsync.kick()
            return self._send(200, sync_status())
        if p == "/api/sync/delete-account":
            # 되돌릴 수 없다. 창에서 한 번 더 묻고 나서 부른다.
            local = bool(body.get("local")) if isinstance(body, dict) else False
            done = cloudsync.delete_account(local=local)
            return self._send(200, dict(sync_status(), **done))
        if p == "/api/update/seen":
            updater.mark_seen()
            return self._send(200, {"ok": True})
        if p == "/api/ui":
            if isinstance(body, dict):
                now = time.time()
                if isinstance(body.get("visible"), bool) and body["visible"] != _UI["visible"]:
                    _UI.update(visible=body["visible"], changed=now)
                if body.get("input") is True:
                    _UI["input"] = now
            return self._send(200, {"ok": True})
        if p == "/api/update/check":
            updater.check_now()
            return self._send(200, updater.status())
        if p == "/api/update/apply":
            # 사람이 [지금 업데이트] 를 눌렀다 - 조용한 때를 기다리지 않는다. 바꾼 뒤 창을 다시 연다
            if updater.status().get("state") != "ready":
                raise ApiError(409, "받아 둔 새 버전이 없습니다")
            threading.Thread(target=lambda: updater.apply_pending(shutdown, open_window=True),
                             daemon=True).start()
            return self._send(200, {"ok": True})
        if p == "/api/hidden":
            _hint_hidden()
            return self._send(200, {"ok": True})
        if p == "/api/open":
            open_window()
            return self._send(200, {"ok": True})
        if p == "/api/shortcut":
            link = autostart.make_desktop_shortcut()
            return self._send(200, {"ok": bool(link), "path": link or ""})
        if p == "/api/test-toast":
            _preview_toast()
            return self._send(200, {"ok": True})
        if p == "/api/quit":
            threading.Thread(target=shutdown, daemon=True).start()
            return self._send(200, {"ok": True})
        raise ApiError(404, "없는 경로입니다")


def sync_status():
    """설정 창의 동기화 칸: 로그인 상태 + 마지막으로 맞춘 때. 토큰 같은 비밀은 없다."""
    return dict(cloudauth.status(), **cloudsync.status())


def _preview_toast():
    """설정 · 트레이의 [알림 미리보기]. 실제 카드와 같은 모양, 버튼은 아무 일도 하지 않는다."""
    # 실제 알림과 같은 자리 · 같은 칸을 채운다. 시각을 비우면 미리보기만
    # 다른 모양으로 떠서, 정작 진짜 카드가 어떻게 생겼는지 알 수 없다.
    toast.notify("알림 미리보기", "이런 모양으로 떠올랐다 사라집니다 · 10:00",
                 on_done=lambda: None, on_snooze=lambda: None,
                 extra={"when": "10:00", "rel": "10분 뒤",
                        "meta": "이런 모양으로 떠올랐다 사라집니다"},
                 key="preview:%d" % int(time.time()))


def preview(rule):
    """새 항목 창의 '다음 실행 날짜'. 저장할 때와 같은 확인을 거친다."""
    try:
        r = recur.validate_rule(rule)
    except recur.RuleError as e:
        return {"text": "", "dates": [], "error": str(e)}
    today = date.today()
    if r["period"] == "week":
        r.setdefault("anchor", today.isoformat())   # 저장하면 오늘이 기준 주가 된다
    ds = recur.occurrences(r, today, today + timedelta(days=430))[:5]
    return {"text": recur.describe(r),
            "dates": [f"{d.month}/{d.day}({WEEK[d.weekday()]})" for d in ds] or ["해당 날짜 없음"]}


# ---------------- 알림 스케줄러 ----------------
# 창에서 무언가 바꾸면 다음 분을 기다리지 않고 한 번 돈다 (트레이의 "N건 남음" 이 곧바로 맞게)
_WAKE = threading.Event()


def scheduler():
    fails = 0
    while True:
        try:
            tick()
            fails = 0
        except Exception:
            # 예전에는 여기서 그냥 넘어갔다. 알림이 왜 안 뜨는지 알 방법이 없었다.
            # 같은 오류가 1분마다 로그를 채우지 않게 처음 몇 번과 이후 한 시간에 한 번만 남긴다.
            fails += 1
            if fails <= 3 or fails % 60 == 0:
                log("scheduler tick 실패 (%d회째)" % fails + chr(10) + traceback.format_exc())
        # 알림 시각은 분 단위다. 예전처럼 20초마다 돌면 세 번에 두 번은 할 일이 없고,
        # 그러면서도 최대 20초 늦게 떴다. 분이 바뀐 직후에 한 번씩 돌면 덜 깨고 더 정확하다.
        _WAKE.wait(60.5 - time.time() % 60)
        _WAKE.clear()


def _plus(hhmm, minutes):
    """'08:30' + 120분 -> '10:30'. 자정을 넘으면 23:59 로 자른다."""
    try:
        h, m = int(hhmm[:2]), int(hhmm[3:5])
    except (ValueError, IndexError):
        return "23:59"
    total = h * 60 + m + minutes
    return "23:59" if total >= 24 * 60 else "%02d:%02d" % (total // 60, total % 60)


def nudge_ui():
    """창이 떠 있으면 지금 다시 읽으라고 한다. 창이 없으면 조용히 넘어간다.

    부르는 쪽은 알림 창의 메시지 루프다 - 거기서 소켓을 기다리면 그동안 카드가
    멈춘다. 따로 돌린다.
    """
    threading.Thread(target=lambda: ipc.post(ipc.UI_PORT, "/reload", timeout=0.5),
                     daemon=True).start()


def _complete(tid, day):
    """알림 카드의 [완료]. 이미 완료했으면 그대로, 그 사이 지워졌으면 조용히 넘어간다."""
    try:
        store.set_done(tid, day, True)
    except store.NotFoundError:
        return
    nudge_ui()


SNOOZE_MIN = 10
_SNOOZED = set()                # 미뤄 둔 알림 (프로그램을 내리면 사라지므로 이때는 업데이트하지 않는다)
# 창이 알려 오는 사정 (POST /api/ui). 창은 떠 있는 동안 45초마다 스스로 목록을 다시 읽으므로 요청이
# 왔다는 것만으로는 사람이 쓰는지 알 수 없다 - 실제 입력과 보이는지를 따로 받는다.
_UI = {"visible": False, "changed": 0.0, "input": 0.0}


def ui_idle_s(now=None):
    """사람이 창에서 손을 뗀 지 몇 초. 숨어 있으면 숨은 때부터 센다."""
    now = now or time.time()
    last = _UI["input"] if _UI["visible"] else max(_UI["input"], _UI["changed"])
    return now - last


def _snooze(i):
    """알림 카드의 [10분 뒤]. 10분 뒤에 같은 알림을 한 번 더 띄운다.

    그 사이 완료했거나 지웠으면 띄우지 않는다. 프로그램을 끄면 미룬 알림도 사라진다.
    """
    tid, day, title, at = i["id"], i["date"], i["title"], i.get("time") or ""

    def again():
        try:
            for cur in store.instances(back=1, ahead=1):
                if cur["id"] == tid and cur["date"] == day:
                    if cur["done"]:
                        return
                    break
            else:
                return
        except Exception:
            log("미룬 알림 확인 실패: " + traceback.format_exc())
            return
        toast.notify(title, "10분 전에 미룬 알림" + (" · %s" % at if at else ""), late=True,
                     on_done=lambda: _complete(tid, day), on_snooze=lambda: _snooze(i),
                     key="snooze:%s:%s:%d" % (tid, day, int(time.time())))

    def fire():
        _SNOOZED.discard(t)
        again()

    t = threading.Timer(SNOOZE_MIN * 60, fire)
    t.daemon = True
    _SNOOZED.add(t)
    t.start()


def tick(now=None):
    now = now or datetime.now()
    hm = now.strftime("%H:%M")
    d, rev = store.snapshot()
    st = store.settings(d)
    default_lead = timedelta(minutes=st["notify_min"])
    # 발표 중 알림을 미룰지는 설정에서 바꿀 수 있다. 매 틱 반영한다.
    toast.HOLD_WHEN_BUSY = st.get("hold_when_busy", True)

    first_tick = not getattr(tick, "_ran", False)
    tick._ran = True

    o = store.overview(data=d, now=now, rev=rev)      # 파일이 그대로면 지난번 계산을 다시 쓴다
    left = o["stats"]["left"]
    tray.set_title(f"{paths.APP_NAME} · {left}건 남음" if left
                   else f"{paths.APP_NAME} · 급한 일 없음")
    tray.set_badge(toast.held_count())      # 발표 중 보류한 알림 수

    # 브리핑은 시각이 지난 뒤 2시간 안에만. 그러지 않으면 저녁에 프로그램을 켰을 때
    # 아침 브리핑이 그제서야 떠오른다.
    brief = st["brief_time"]
    if brief and brief <= hm <= _plus(brief, 120):
        if (left or o["overdue"]) and store.mark_fired("brief:%s" % now.date(), now):
            _brief(now, o)

    missed = []
    for i in store.instances(back=1, ahead=1, data=d, today=now.date()):
        # 항목 하나에서 터져도 나머지 알림은 계속 떠야 한다
        try:
            if _maybe_notify(i, now, default_lead, first_tick) == "missed":
                missed.append(i)
        except Exception:
            log("알림 처리 실패 (%s)" % i.get("id") + chr(10) + traceback.format_exc())

    # 프로그램을 늦게 켰을 때: 지나간 알림을 한 장으로 모아 보여준다.
    # 예전에는 조용히 버려서 "오늘 알림이 안 떴다" 가 됐고, 그렇다고 다 띄우면
    # 카드가 무더기로 겹쳐 떴다.
    if missed:
        missed.sort(key=lambda x: (x["date"], x["time"]))
        head = missed[0]
        if len(missed) == 1:
            tid, day = head["id"], head["date"]
            toast.notify(head["title"], "마감 시간 지남 · %s" % head["time"], late=True,
                         on_done=lambda tid=tid, day=day: _complete(tid, day),
                         on_snooze=lambda head=head: _snooze(head),
                         key="missed:%s:%s" % (tid, day))
        else:
            rows = [(i["time"] or "", i["title"], True) for i in missed]
            toast.notify_list("놓친 알림", "지나간 알림 %d건" % len(missed),
                              rows[:toast.LIST_MAX],
                              max(0, len(rows) - toast.LIST_MAX),
                              accent="#08202b", key="missed:%s" % now.date())
        log("놓친 알림 %d건을 한 장으로 알림" % len(missed))


def _brief(now, o):
    """아침 브리핑. 밀린 것을 앞에, 오늘 것을 시각 순으로 뒤에 붙인다.

    예전에는 "첫 항목 외 N건" 이라 나머지 이름을 알려주지 않았다. 그러면 결국
    창을 열어야 해서 알림이 한 단계를 더 만드는 셈이었다.
    """
    rows = []
    for i in o["overdue"]:
        when = i["date"][5:].replace("-", "/") if i["date"] else ""
        rows.append((when, i["title"], True))
    for i in o["todays"]:
        if not i["done"]:
            rows.append((i["time"] or "", i["title"], False))
    if not rows:
        return
    d = now.date()
    title = "%d월 %d일 %s요일" % (d.month, d.day, WEEK[d.weekday()])
    toast.notify_list("아침 브리핑", title, rows[:toast.LIST_MAX],
                      max(0, len(rows) - toast.LIST_MAX),
                      accent="#85bdb3", key="brief:%s" % d)


def _plan(i, now, default_lead):
    """이 항목의 알림 계획. (알림 시각, 마감 시각, 건너뛸 이유) 를 돌려준다.

    점검할 때 이 함수만 보면 "왜 안 떴는지" 를 알 수 있다.
    """
    if not i["due"]:
        return None, None, "마감 날짜 없음"
    if not i["time"]:
        # 시각이 없는 일은 아침 브리핑에서 알린다. 예전에는 23:59 마감으로 보고
        # 밤 23:29 에 "24분 뒤 마감 · " 처럼 시각이 빈 알림을 띄웠다.
        return None, None, "마감 시각 없음 (브리핑에 포함)"
    due = datetime.fromisoformat(i["due"])
    lead = timedelta(minutes=i["notify_min"]) if i["notify_min"] is not None else default_lead
    at = due - lead
    if i["done"]:
        return at, due, "이미 완료"
    if i.get("muted"):
        return at, due, "알림 끔"
    if now < at:
        return at, due, "아직 이르다"
    if now > due + timedelta(minutes=LATE_GRACE):
        return at, due, "시간이 너무 지났다"
    return at, due, None


def _maybe_notify(i, now, default_lead, first_tick):
    at, due, skip = _plan(i, now, default_lead)
    if skip:
        return None
    key = "%s:%s:%s" % (i["id"], i["date"], i["time"])
    mins = int((due - now).total_seconds() // 60)
    if first_tick and mins <= 0:
        # 프로그램을 켠 첫 순간에 이미 지난 것은 각각 띄우지 않고 모아서 한 장으로
        # 보여준다 (tick 의 missed 처리). 이미 띄웠던 것은 다시 모으지 않는다 -
        # 예전에는 프로그램을 켤 때마다 같은 알림이 또 떴다.
        return "missed" if store.mark_fired(key, now) else None
    if not store.mark_fired(key, now):
        return None
    # 카드는 시각을 가장 크게 보여준다. 그래서 "언제" 를 따로 넘긴다 -
    # 한 문장으로 뭉쳐 보내면 카드가 다시 쪼개야 한다.
    sub = ("%d분 뒤 마감 · %s" % (mins, i["time"])) if mins > 0 else ("마감 시간 지남 · %s" % i["time"])
    rel = ("%d분 뒤" % mins) if mins > 0 else "지남"
    kind = {"routine": "루틴", "deadline": "마감", "floating": "메모"}.get(i.get("kind"), "")
    detail = i.get("rule_text") or ""
    meta = (kind + " · " + detail) if (kind and detail) else (kind or detail)
    tid, day = i["id"], i["date"]
    toast.notify(i["title"], sub, late=mins <= 0,
                 on_done=lambda tid=tid, day=day: _complete(tid, day),
                 on_snooze=lambda i=i: _snooze(i),
                 extra={"when": i["time"], "rel": rel, "meta": meta},
                 key="%s:%s" % (tid, day))
    log("알림 띄움: %s (%s)" % (key, sub))
    return "shown"


def alert_near(now=None, minutes=None):
    """앞뒤 minutes 분 안에 알림(또는 아침 브리핑)이 있는지. 자동 업데이트는 이때 바꾸지 않는다 -
    다시 켜지는 몇 초 사이에 알림이 빠지면 안 된다."""
    now = now or datetime.now()
    win = timedelta(minutes=updater.QUIET_ALERT_MIN if minutes is None else minutes)
    d = store.load()
    st = store.settings(d)
    brief = st.get("brief_time")
    if brief:
        bt = datetime.combine(now.date(), datetime.strptime(brief, "%H:%M").time())
        if abs(now - bt) <= win:
            return True
    default_lead = timedelta(minutes=st["notify_min"])
    for i in store.instances(back=1, ahead=1, data=d, today=now.date()):
        if not i["due"] or not i["time"] or i["done"] or i.get("muted"):
            continue
        due = datetime.fromisoformat(i["due"])
        lead = timedelta(minutes=i["notify_min"]) if i["notify_min"] is not None else default_lead
        if abs(due - lead - now) <= win:
            return True
    return False


def update_quiet():
    """지금 새 버전으로 바꿔 끼워도 되는지 (updater.quiet 에 이 서비스의 사정을 넘긴다)."""
    if _SNOOZED:
        return False, "미뤄 둔 알림이 있다"
    return updater.quiet(ui_idle_s(), alert_near(), toast.busy(), window_open=_UI["visible"])


def notify_plan():
    """알림 점검용. 어제~내일의 각 회차가 언제 알려질 예정인지, 안 알려지면 왜인지.

    "왜 안 떴지" 를 추측하지 않고 확인할 수 있어야 한다.
    """
    now = datetime.now()
    d = store.load()
    default_lead = timedelta(minutes=store.settings(d)["notify_min"])
    fired = store.fired_keys()
    out = []
    for i in store.instances(back=1, ahead=1, data=d):
        at, due, skip = _plan(i, now, default_lead)
        key = "%s:%s:%s" % (i["id"], i["date"], i["time"])
        out.append({
            "title": i["title"],
            "date": i["date"],
            "time": i["time"],
            "kind": i["kind"],
            "notify_at": at.strftime("%m-%d %H:%M") if at else "",
            "due_at": due.strftime("%m-%d %H:%M") if due else "",
            "already_fired": key in fired,
            "skip": skip or "",
            "will_notify": bool(not skip and key not in fired),
        })
    out.sort(key=lambda r: (r["notify_at"] or "9"))
    return {"now": now.strftime("%m-%d %H:%M"),
            "default_lead_min": int(default_lead.total_seconds() // 60),
            "rows": out}


def main():
    paths.log("main: 시작 (frozen=%s)" % paths.FROZEN)
    silent = "--silent" in sys.argv
    _dpi_aware()

    # 이미 백그라운드에 돌고 있으면 서비스를 또 띄우지 않는다.
    # 바탕화면 아이콘을 다시 눌렀을 때 기대하는 동작은 "그 창을 열어라" 이다.
    if not acquire_single_instance():
        paths.log("main: 이미 실행 중 → 기존 창만 열고 종료")
        if not silent:
            open_window()
        return
    paths.ipc_token()                # 창 프로세스가 읽기 전에 만들어 둔다
    try:
        srv = Server((HOST, PORT), Handler)
    except OSError:
        paths.log("main: 포트 사용 중 → 기존 창만 열고 종료")
        open_window()
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=scheduler, daemon=True).start()
    cloudsync.start()                # 로그인하지 않았으면 조용히 기다린다
    # 새 버전은 알아서 받아 두었다가 조용할 때 바꿔 끼운다 (빌드본에서만)
    updater.start(enabled=lambda: store.settings(store.load()).get("auto_update", True),
                  is_quiet=update_quiet, shutdown=shutdown, window_open=lambda: _UI["visible"])
    paths.log("main: 서버·스케줄러 시작, tray 진입")
    tray.start(on_open=open_window,
               on_test=_preview_toast,
               on_quit=shutdown)
    toast.set_open_handler(open_window)
    paths.log("main: tray 완료, toast.run_forever 진입")
    toast.run_forever(on_ready=(prewarm_window if silent else open_window))


def prewarm_window():
    """창을 숨긴 채로 미리 만들어 둔다.

    창 프로세스는 WebView2 초기화까지 몇 초가 걸린다. 자동 실행으로 조용히
    떠 있을 때 미리 만들어 두면, 트레이나 바로가기로 열 때 곧바로 나타난다.
    """
    if focus_ui():
        return
    try:
        _spawn_ui("--hidden")
        log("prewarm_window: 숨긴 창 미리 생성")
    except Exception:
        log("prewarm_window 실패(무시): " + traceback.format_exc())


if __name__ == "__main__":
    main()
