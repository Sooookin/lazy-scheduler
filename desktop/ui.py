# -*- coding: utf-8 -*-
"""'LazyScheduler' 앱 창 (pywebview: Windows 는 WebView2, macOS 는 WKWebView). 서비스와 별도 프로세스로 뜬다.

창을 옮기고 · 늘리고 · 숨기고 · 확대하는 일은 운영체제마다 달라 platforms/<os>/window.py 가 한다.
"""
import hashlib, os, socket, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import webview

from desktop import ipc
from desktop import paths
from platforms import window

BASE = paths.APP_DIR
HOST, SERVICE_PORT = ipc.HOST, ipc.SERVICE_PORT
SERVICE_URL = f"http://{HOST}:{SERVICE_PORT}/"


class Api:
    """자체 타이틀바 버튼 (화면의 app.js 가 부른다)."""

    def minimize(self):
        window.minimize()

    def toggle_max(self):
        return window.toggle_max()

    def begin_move(self):
        window.begin_move()

    def is_max(self):
        return window.is_max()

    def begin_resize(self, edge):
        window.begin_resize(edge)

    def close(self):
        """창을 없애지 않고 숨긴다.

        창을 파괴하면 프로세스가 끝나고, 다시 열 때 WebView2 초기화를 처음부터
        해야 해서 몇 초가 걸린다. 숨겨두면 다음 열기가 즉시 끝난다.
        완전히 끄는 것은 트레이의 "완전히 종료" 가 담당한다.
        """
        hide()


# ── 화면 배율 ──
# 화면은 창 크기에 비례해서 커지고 작아진다. 기준 크기(BASE)에서 배율 1 이고,
# 가로 · 세로 중 덜 늘어난 쪽을 따른다 - 그래야 어느 쪽으로 늘려도 넘치지 않고,
# 더 늘어난 쪽은 목록 · 달력이 넓어지는 데 쓰인다. 배율은 웹 보기 자체의 확대라서
# 글자 · 선 · 하늘이 흐려지지 않고 그 크기로 새로 그려진다 (window.set_zoom).
BASE_W, BASE_H = 960, 592
# 처음 뜨는 크기. 기준보다 조금 크게 - 화면도 그 비율(가로 · 세로 중 작은 쪽, 1.09)로 커져 뜬다.
# 기준의 가로:세로를 이 크기와 같게 두어야 높이를 줄여도 글자가 함께 작아지지 않는다.
DEFAULT_W, DEFAULT_H = 1050, 648
MIN_W, MIN_H = 720, 480
ZOOM_MIN, ZOOM_MAX = 0.75, 2.0
_zoom = [1.0]


def zoom_for(w, h):
    """창 안쪽 크기(논리 px)에 맞는 화면 배율."""
    return max(ZOOM_MIN, min(ZOOM_MAX, min(w / float(BASE_W), h / float(BASE_H))))


def apply_zoom(w=None, h=None):
    """창 크기에 맞춰 화면 배율을 바꾼다. 거의 같으면 건드리지 않는다."""
    if w is None or h is None:
        size = window.client_size()
        if not size:
            return
        w, h = size
    z = round(zoom_for(w, h), 3)
    if abs(z - _zoom[0]) < 0.004:
        return
    _zoom[0] = z
    window.set_zoom(z)


def _tell_hidden():
    """서비스에 "창을 숨겼다" 고 알린다 (안내 카드를 한 번 띄우게)."""
    ipc.post(ipc.SERVICE_PORT, "/api/hidden", body={}, timeout=1.0)


def _tell_page_shown():
    """화면(웹 페이지)에 "다시 보인다" 고 알린다. 숨어 있는 동안 멈춰 둔 새로 읽기를 곧바로 한다.

    운영체제로 직접 숨기고 보이므로 페이지의 visibilitychange 가 오지 않을 수 있다.
    evaluate_js 는 창 스레드의 답을 기다리므로 부른 쪽(HTTP 스레드)을 묶지 않게 따로 돈다.
    """
    w = _WINDOW[0]
    if w is None:
        return

    def run():
        try:
            w.evaluate_js("window.__lsShown && window.__lsShown()")
        except Exception:
            pass                     # 페이지를 다시 읽는 중이면 그쪽이 어차피 새로 읽는다
    threading.Thread(target=run, daemon=True).start()


def hide():
    if window.hide():
        threading.Thread(target=_tell_hidden, daemon=True).start()


def focus():
    """숨어 있거나 최소화된 창을 다시 보여준다."""
    window.focus()
    apply_zoom()
    _tell_page_shown()


def _destroy_all():
    """서비스가 종료를 알려왔을 때 창을 닫는다 → webview.start() 가 반환되며 프로세스 종료."""
    try:
        for w in list(webview.windows):
            w.destroy()
    except Exception:
        pass
    threading.Timer(1.5, lambda: os._exit(0)).start()   # 혹시 안 닫히면 강제


def build_stamp():
    """지금 디스크에 있는 화면 파일들의 지문 (이름 · 크기 · 고친 때)."""
    h = hashlib.sha1()
    seen = 0
    try:
        for root, dirs, files in os.walk(paths.WEB_DIR):
            dirs.sort()
            for name in sorted(files):
                st = os.stat(os.path.join(root, name))
                rel = os.path.relpath(os.path.join(root, name), paths.WEB_DIR)
                h.update(("%s|%d|%d;" % (rel, st.st_size, st.st_mtime_ns)).encode("utf-8", "replace"))
                seen += 1
    except OSError:
        return None
    # 폴더가 없어도 os.walk 는 성을 내지 않고 아무 것도 내놓지 않는다. 업데이트가
    # 지우고 다시 넣는 사이에 부르면 "파일 0개" 라는 멀쩡한 지문이 나오고, 창은
    # 그것을 바뀐 것으로 알고 텅 빈 화면을 읽는다. 하나도 못 봤으면 모른다고 한다.
    return h.hexdigest() if seen else None


_STAMP = [None]
_WINDOW = [None]


def refresh_if_stale():
    """화면 파일이 바뀌었으면 페이지를 다시 읽는다.

    창은 한 번 읽은 페이지를 계속 들고 있다. 그 사이 업데이트가 web/ 를 갈아
    끼우면 서비스는 새 파일을 내보내는데 창만 예전 화면에 머문다. × 를 눌러도
    창 프로세스는 살아 있고, 트레이를 눌러도 app.open_window() 가 focus_ui() 로
    그 창을 앞으로 부를 뿐이다. 결국 창 프로세스를 직접 끝내야만 바뀌었다.

    앞으로 불려 나올 때마다 파일이 바뀐 것을 알아채고 스스로 다시 읽는다.
    """
    now = build_stamp()
    if _WINDOW[0] is None or now is None or _STAMP[0] is None or now == _STAMP[0]:
        return False
    _STAMP[0] = now
    try:
        _WINDOW[0].load_url(SERVICE_URL)
        paths.log("ui: 화면 파일이 바뀌었다 - 페이지를 다시 읽는다")
        return True
    except Exception:
        paths.log("ui: 다시 읽기 실패: " + traceback.format_exc())
        return False


class FocusHandler(BaseHTTPRequestHandler):
    """서비스가 창을 앞으로 부르거나(/focus) 닫을 때(/quit) 쓴다.

    127.0.0.1 포트는 이 PC 의 웹 페이지도 두드릴 수 있으므로 Host 와 비밀값을 확인한다.
    (예전에는 아무 사이트나 이 주소를 불러 창을 닫을 수 있었다)
    """
    def log_message(self, *a):
        pass

    def _reply(self, code, text):
        body = text.encode("ascii")
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def do_POST(self):
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").lower()
        if (host not in ("127.0.0.1:%d" % port, "localhost:%d" % port)
                or self.headers.get("Origin") is not None
                or not paths.token_ok(self.headers.get(ipc.TOKEN_HEADER))):
            return self._reply(403, "forbidden")
        path = self.path.split("?")[0]
        if path == "/focus":
            refresh_if_stale()
            focus()
            return self._reply(200, "ok")
        if path == "/reload":
            # 알림 카드에서 완료했다 - 떠 있는 화면이 45초짜리 다음 차례를
            # 기다리는 동안 다 한 일을 안 한 것처럼 보이고 있을 수 있다.
            _tell_page_shown()
            return self._reply(200, "ok")
        if path == "/quit":
            self._reply(200, "ok")
            threading.Timer(0.1, _destroy_all).start()
            return
        self._reply(404, "not found")

    def do_GET(self):
        self._reply(405, "use POST")


# 개발용. LS_DEV 가 켜져 있을 때만 돈다 - 배포본에서는 이 스레드가 아예 뜨지 않는다.
DEV_POLL_S = 1.5


def watch_web():
    """화면 파일이 바뀌면 창이 스스로 다시 읽는다 (고치고 저장하면 그걸로 끝).

    평소에는 앞으로 불려 나올 때(/focus)만 확인한다. 고치는 동안에는 그 한 번을
    사람이 눌러 줘야 해서, 한 줄 고칠 때마다 트레이를 누르게 된다.
    파일 지문만 보므로 바뀐 것이 없으면 아무 일도 하지 않는다.
    """
    paths.log("ui: 개발 모드 - 화면 파일을 %.1f초마다 살핀다" % DEV_POLL_S)
    while True:
        time.sleep(DEV_POLL_S)
        try:
            refresh_if_stale()
        except Exception:
            pass


def watch_service():
    """서비스가 죽었으면 창도 닫는다. 서버 없는 빈 창이 남지 않게."""
    misses = 0
    while True:
        time.sleep(15)
        try:
            with socket.create_connection((HOST, SERVICE_PORT), 1.0):
                misses = 0
        except OSError:
            misses += 1
            if misses >= 3:            # 45초 연속 응답 없음
                _destroy_all()
                return


def already_open():
    """창이 이미 떠 있으면 그 창을 앞으로 불러오고 True."""
    return ipc.post(ipc.UI_PORT, "/focus", timeout=0.4) is not None


def main():
    if already_open():
        return
    window.prepare()

    try:
        guard = ThreadingHTTPServer((ipc.HOST, ipc.UI_PORT), FocusHandler)
        threading.Thread(target=guard.serve_forever, daemon=True).start()
        threading.Thread(target=watch_service, daemon=True).start()
        window.watch()
        if os.environ.get("LS_DEV"):
            threading.Thread(target=watch_web, daemon=True).start()
    except OSError:
        return

    _STAMP[0] = build_stamp()
    _WINDOW[0] = webview.create_window(
        paths.APP_NAME, SERVICE_URL, js_api=Api(),
        # 기준 크기(BASE) 960×592 · 하늘 180. 참고 도안(900×560, 하늘 206)보다 하늘을
        # 위아래로 눌러 낮추고 그만큼을 목록에 준다. 가장자리를 끌어 늘리면 화면이
        # 같은 비율로 커진다 (apply_zoom).
        width=DEFAULT_W, height=DEFAULT_H, min_size=(MIN_W, MIN_H),
        background_color="#E9E4DD",
        hidden="--hidden" in sys.argv,      # 자동 실행 때 미리 만들어만 둔다
        **window.CREATE_OPTS,
    )
    window.attach(_WINDOW[0], (DEFAULT_W, DEFAULT_H), (MIN_W, MIN_H))
    # 최대화 · Win+방향키 · 가장자리 끌기 - 어떻게 바뀌든 크기가 바뀌면 배율을 맞춘다.
    # 페이지를 새로 읽어도 배율은 창에 남지만, 처음 한 번은 읽은 뒤에 맞춘다.
    _WINDOW[0].events.resized += lambda width, height: apply_zoom(width, height)
    _WINDOW[0].events.loaded += lambda: apply_zoom()
    if "--hidden" not in sys.argv:
        # 부모 프로세스의 표시 상태가 딸려와 최소화된 채로 뜨는 때가 있다.
        # 창이 만들어진 뒤 한 번 앞으로 불러온다. 창이 생기는 시점이 일정하지
        # 않으므로 잠깐 기다려 준다 (예전엔 너무 일찍 불러 로그만 남았다).
        def _first_focus():
            for _ in range(20):
                if window.ready():
                    focus()
                    return
                time.sleep(0.25)
        threading.Thread(target=_first_focus, daemon=True).start()

    icon = paths.ICON
    try:
        webview.start(icon=icon if os.path.exists(icon) else None)
    except TypeError:
        webview.start()


if __name__ == "__main__":
    main()
