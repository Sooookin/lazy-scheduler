# -*- coding: utf-8 -*-
"""Google 계정으로 로그인해 Firebase 세션을 얻고 이어 간다 (PC). 설계: docs/sync.md 6장.

  1. 기본 브라우저로 Google 로그인 (OAuth 2.0 데스크톱 앱 · 127.0.0.1 로 돌아오기 · PKCE)
  2. 받은 Google ID 토큰을 Firebase 세션으로 바꾼다 (accounts:signInWithIdp)
  3. Firebase refresh token 을 이 Windows 사용자만 풀 수 있게 잠가 둔다 (DPAPI)
  4. Firestore 에 요청할 때 1시간짜리 ID 토큰을 꺼내 쓰고, 끝나 가면 새로 받는다

비밀번호는 이 앱을 거치지 않는다. 사용자는 Google 의 페이지에서만 로그인한다.
"""
import base64
import hashlib
import json
import os
import secrets
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import paths
import store

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
SIGN_IN_WITH_IDP = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp"
REFRESH = "https://securetoken.googleapis.com/v1/token"
DELETE_ACCOUNT = "https://identitytoolkit.googleapis.com/v1/accounts:delete"
SCOPES = "openid email profile"
CONFIG_KEYS = ("project_id", "api_key", "client_id", "client_secret")
WAIT_S = 300                    # 브라우저에서 로그인을 마칠 때까지 기다리는 시간
HTTP_TIMEOUT_S = 20
EARLY_S = 120                   # ID 토큰이 이만큼 남으면 미리 새로 받는다


class AuthError(Exception):
    """로그인하지 못했다. 메시지는 화면에 그대로 보여줄 수 있는 문장이다."""


def config():
    """Firebase 설정 {project_id, api_key, client_id, client_secret}. 없으면 None."""
    for p in paths.cloud_config_paths():
        try:
            with open(p, encoding="utf-8") as f:
                c = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(c, dict) and all(isinstance(c.get(k), str) and c[k] for k in CONFIG_KEYS):
            return c
    return None


def _need_config():
    c = config()
    if c is None:
        raise AuthError("동기화 설정 파일이 없습니다 (firebase/config.local.json)")
    return c


# ---------------- HTTP ----------------

def _post(url, data, form=False):
    """POST 하고 JSON 답을 돌려준다. 실패하면 화면에 보여줄 문장으로 AuthError."""
    if form:
        body, ctype = urllib.parse.urlencode(data).encode(), "application/x-www-form-urlencoded"
    else:
        body, ctype = json.dumps(data).encode(), "application/json"
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError, OSError):
            detail = {}
        raise AuthError(_explain(detail, e.code)) from None
    except (urllib.error.URLError, OSError, ValueError):
        raise AuthError("인터넷에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요.") from None


def _explain(detail, status):
    """Google · Firebase 의 오류 답 → 사람이 읽을 문장. 원문은 로그에 남긴다."""
    paths.log("cloudauth: HTTP %s %s" % (status, json.dumps(detail, ensure_ascii=False)[:500]))
    err = detail.get("error")
    code = (err.get("message") if isinstance(err, dict) else err) or ""
    if code in ("invalid_grant", "TOKEN_EXPIRED", "INVALID_REFRESH_TOKEN", "USER_NOT_FOUND",
                "USER_DISABLED", "INVALID_IDP_RESPONSE"):
        return "로그인이 만료되었습니다. 다시 로그인하세요."
    if code in ("invalid_client", "unauthorized_client") or str(code).startswith("API key not valid"):
        return "동기화 설정 값이 올바르지 않습니다 (firebase/config.local.json)."
    return "로그인하지 못했습니다 (%s %s)" % (status, code or "알 수 없는 오류")


# ---------------- 저장해 둔 계정 ----------------
_lock = threading.RLock()
_cache = {"token": None, "until": 0.0, "uid": None}


def _protect(data):
    import win32                                    # Windows 에만 있다 (휴대폰은 자기 보관소를 쓴다)
    return win32.protect(data)


def _unprotect(blob):
    import win32
    return win32.unprotect(blob)


def _load():
    try:
        with open(paths.AUTH_FILE, encoding="utf-8") as f:
            a = json.load(f)
    except (OSError, ValueError):
        return None
    ok = isinstance(a, dict) and all(isinstance(a.get(k), str) and a[k] for k in ("uid", "refresh"))
    return a if ok else None


def _save(uid, email, refresh):
    locked = base64.b64encode(_protect(refresh.encode("utf-8"))).decode("ascii")
    store._write_json(paths.AUTH_FILE, {"uid": uid, "email": email or "", "refresh": locked})


def account():
    """로그인한 계정 {uid, email}. 로그인하지 않았으면 None. 토큰은 내주지 않는다."""
    a = _load()
    return {"uid": a["uid"], "email": a.get("email", "")} if a else None


def id_token():
    """Firestore 요청에 쓸 Firebase ID 토큰. 끝나 가면 새로 받는다.

    새로 받지 못하면 AuthError. "만료되었습니다" 면 다시 로그인해야 한다.
    """
    with _lock:
        a = _load()
        if a is None:
            raise AuthError("로그인하지 않았습니다")
        if _cache["token"] and _cache["uid"] == a["uid"] and time.time() < _cache["until"]:
            return _cache["token"]
        c = _need_config()
        try:
            refresh = _unprotect(base64.b64decode(a["refresh"])).decode("utf-8")
        except (OSError, ValueError):
            # 다른 사용자 계정 · 다른 PC 로 옮겨 온 파일이다. 여기서는 풀 수 없다.
            raise AuthError("로그인 정보를 읽을 수 없습니다. 다시 로그인하세요.") from None
        r = _post(REFRESH + "?key=" + urllib.parse.quote(c["api_key"]),
                  {"grant_type": "refresh_token", "refresh_token": refresh}, form=True)
        if r.get("refresh_token") and r["refresh_token"] != refresh:
            _save(a["uid"], a.get("email", ""), r["refresh_token"])
        _remember(a["uid"], r["id_token"], r.get("expires_in"))
        return r["id_token"]


def _remember(uid, token, expires_in):
    try:
        life = int(expires_in)
    except (TypeError, ValueError):
        life = 3600
    _cache.update(token=token, uid=uid, until=time.time() + max(0, life - EARLY_S))


# ---------------- 로그인 ----------------

def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


_DONE_PAGE = """<!doctype html><meta charset="utf-8"><title>LazyScheduler</title>
<body style="font-family:system-ui,sans-serif;background:#e7ebea;color:#2b2620;display:grid;place-items:center;height:90vh">
<div style="text-align:center"><h2 style="font-weight:500">%s</h2><p>%s</p></div>"""


def sign_in(open_url=webbrowser.open, wait_s=WAIT_S):
    """브라우저에서 Google 로그인 → Firebase 세션 → 저장 → 동기화 켜기. {uid, email} 을 돌려준다."""
    c = _need_config()
    verifier = _b64url(secrets.token_bytes(48))                      # 64자 (43~128)
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = secrets.token_urlsafe(24)
    got, done = {}, threading.Event()

    class Back(BaseHTTPRequestHandler):
        """Google 이 브라우저를 127.0.0.1:<포트>/?code=... 로 돌려보낸다."""

        def log_message(self, *a):
            pass

        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] != state:
                # 파비콘 요청 · 엉뚱한 요청. 로그인 결과가 아니다 (state 가 맞아야만 믿는다)
                self.send_response(404)
                self.end_headers()
                return
            got["code"] = q.get("code", [""])[0]
            got["error"] = q.get("error", [""])[0]
            ok = bool(got["code"]) and not got["error"]
            page = _DONE_PAGE % (("로그인했습니다", "이 창을 닫고 LazyScheduler 로 돌아가세요.") if ok
                                 else ("로그인하지 않았습니다", "LazyScheduler 에서 다시 시도할 수 있습니다."))
            data = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            done.set()

    srv = HTTPServer(("127.0.0.1", 0), Back)
    redirect = "http://127.0.0.1:%d" % srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        open_url(GOOGLE_AUTH + "?" + urllib.parse.urlencode({
            "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code",
            "scope": SCOPES, "code_challenge": challenge, "code_challenge_method": "S256",
            "state": state, "prompt": "select_account",
        }))
        if not done.wait(wait_s):
            raise AuthError("로그인을 기다리다 시간이 지났습니다. 다시 시도하세요.")
    finally:
        srv.shutdown()
        srv.server_close()

    if got.get("error") == "access_denied":
        raise AuthError("로그인을 취소했습니다.")
    if got.get("error") or not got.get("code"):
        raise AuthError("로그인하지 못했습니다 (%s)" % (got.get("error") or "코드 없음"))

    google = _post(GOOGLE_TOKEN, {
        "code": got["code"], "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier,
    }, form=True)
    if not google.get("id_token"):
        raise AuthError("Google 이 로그인 정보를 주지 않았습니다. 다시 시도하세요.")
    fb = _post(SIGN_IN_WITH_IDP + "?key=" + urllib.parse.quote(c["api_key"]), {
        "postBody": urllib.parse.urlencode({"id_token": google["id_token"], "providerId": "google.com"}),
        "requestUri": redirect, "returnSecureToken": True, "returnIdpCredential": True,
    })
    uid, refresh = fb.get("localId"), fb.get("refreshToken")
    if not uid or not refresh:
        raise AuthError("Firebase 가 로그인 정보를 주지 않았습니다. 다시 시도하세요.")
    with _lock:
        _save(uid, fb.get("email", ""), refresh)
        _remember(uid, fb.get("idToken"), fb.get("expiresIn"))
        store.sync_enable(uid)
    paths.log("cloudauth: 로그인 (%s)" % (fb.get("email") or uid))
    return account()


def delete_account():
    """이 앱이 만든 계정 자체를 지운다 (Firebase Auth).

    클라우드에 올라간 문서를 먼저 지운 뒤에 불러야 한다. 계정을 먼저 지우면 토큰이
    죽어서 남은 문서를 지울 길이 사라진다 - 규칙이 본인만 지울 수 있게 해 두었다.

    지운 뒤에는 로그아웃까지 한다. 같은 구글 계정으로 다시 로그인하면 새 계정이
    만들어지므로, 그때는 이 기기에 남은 일정이 그 새 계정으로 올라간다.
    """
    c = _need_config()
    token = id_token()                   # 아직 살아 있는 동안에
    _post(DELETE_ACCOUNT + "?key=" + urllib.parse.quote(c["api_key"]), {"idToken": token})
    paths.log("cloudauth: 계정을 지웠다")
    sign_out()


def sign_out():
    """이 PC 에서 로그아웃. 일정(data.json)은 그대로, 동기화 기록과 토큰은 지운다."""
    with _lock:
        _cache.update(token=None, until=0.0, uid=None)
        try:
            os.remove(paths.AUTH_FILE)
        except FileNotFoundError:
            pass
        store.sync_disable()
    paths.log("cloudauth: 로그아웃")


# ---------------- 화면에서 부르는 것 ----------------
# 로그인은 브라우저에서 사람이 끝내기를 기다리므로 요청 하나로 끝나지 않는다.
# 뒤에서 돌리고, 화면은 status() 를 물어본다.
_job = {"state": "idle", "error": ""}          # idle · waiting · error


def start_sign_in():
    """로그인을 뒤에서 시작한다. 이미 진행 중이면 그대로 둔다."""
    with _lock:
        if _job["state"] == "waiting":
            return
        _need_config()
        _job.update(state="waiting", error="")

    def run():
        try:
            sign_in()
            _job.update(state="idle", error="")
        except AuthError as e:
            _job.update(state="error", error=str(e))
        except Exception:
            paths.log("cloudauth: 로그인 실패" + chr(10) + traceback.format_exc())
            _job.update(state="error", error="로그인하지 못했습니다. 로그를 확인하세요.")

    threading.Thread(target=run, daemon=True).start()


def status():
    """화면용 요약. 토큰 같은 비밀은 담지 않는다."""
    a = account()
    return {
        "configured": config() is not None,
        "signed_in": a is not None,
        "email": a["email"] if a else "",
        "state": _job["state"],
        "error": _job["error"],
        "pending": len(store.outbox_pending()) if a else 0,
    }
