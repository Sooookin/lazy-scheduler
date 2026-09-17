# -*- coding: utf-8 -*-
"""PC 의 Google 로그인. 진짜 Google 대신 가짜 답을 주고, 약속만 확인한다.

  · 브라우저가 돌아올 때 state 가 맞아야만 믿는다 (다른 페이지가 끼어들 수 없게)
  · 코드를 토큰으로 바꿀 때 PKCE 검증값이 처음 보낸 challenge 와 맞는다
  · refresh token 은 파일에 그대로 적지 않는다 (Windows 사용자 열쇠로 잠근다)
  · 화면으로 가는 상태에는 토큰이 없다
"""
import base64
import hashlib
import json
import threading
import time
import urllib.parse
import urllib.request

import pytest

import cloudauth
import paths
import store
from test_api import call

CONF = {"project_id": "demo", "api_key": "AIzaTEST", "client_id": "cid.apps.googleusercontent.com",
        "client_secret": "GOCSPX-test"}


@pytest.fixture
def configured(tmp_path, monkeypatch):
    p = tmp_path / "config.local.json"
    p.write_text(json.dumps(CONF), encoding="utf-8")
    monkeypatch.setattr(paths, "cloud_config_paths", lambda: [str(p)])
    cloudauth._cache.update(token=None, until=0.0, uid=None)
    cloudauth._job.update(state="idle", error="")


@pytest.fixture
def google(monkeypatch):
    """가짜 Google · Firebase. 받은 요청을 기록하고 정해 둔 답을 준다."""
    calls = []
    answers = {
        cloudauth.GOOGLE_TOKEN: {"id_token": "google-id-token"},
        cloudauth.SIGN_IN_WITH_IDP: {"localId": "uid-1", "email": "me@example.com",
                                     "refreshToken": "refresh-1", "idToken": "fb-id-1", "expiresIn": "3600"},
        cloudauth.REFRESH: {"id_token": "fb-id-2", "refresh_token": "refresh-2", "expires_in": "3600"},
    }

    def fake_post(url, data, form=False):
        base = url.split("?")[0]
        calls.append((base, url, data))
        return dict(answers[base])

    monkeypatch.setattr(cloudauth, "_post", fake_post)
    return calls


def browser_that_signs_in(code="the-code", state_override=None, error=None):
    """Google 로그인 페이지 대신: 받은 주소를 살피고 곧바로 127.0.0.1 로 돌아간다."""
    seen = {}

    def open_url(url):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        seen.update({k: v[0] for k, v in q.items()})
        back = {"state": state_override or seen["state"]}
        back.update({"error": error} if error else {"code": code})
        target = seen["redirect_uri"] + "/?" + urllib.parse.urlencode(back)

        def go():
            try:
                urllib.request.urlopen(target, timeout=5).read()
            except Exception:
                pass
        threading.Thread(target=go, daemon=True).start()
    return open_url, seen


# ---------- 로그인 ----------

def test_sign_in_uses_pkce_and_saves_an_encrypted_session(configured, google):
    open_url, seen = browser_that_signs_in()
    who = cloudauth.sign_in(open_url=open_url, wait_s=5)

    assert who == {"uid": "uid-1", "email": "me@example.com"}
    assert seen["client_id"] == CONF["client_id"] and seen["redirect_uri"].startswith("http://127.0.0.1:")
    assert seen["code_challenge_method"] == "S256" and seen["response_type"] == "code"

    (_, _, token_req), (_, idp_url, idp_req) = google
    verifier = token_req["code_verifier"]
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert expected == seen["code_challenge"], "PKCE 검증값이 challenge 와 맞지 않는다"
    assert token_req["code"] == "the-code" and token_req["redirect_uri"] == seen["redirect_uri"]
    assert "id_token=google-id-token" in idp_req["postBody"] and "key=AIzaTEST" in idp_url

    raw = open(paths.AUTH_FILE, encoding="utf-8").read()
    assert "refresh-1" not in raw, "refresh token 이 파일에 그대로 적혔다"
    assert store.sync_enabled() and store.sync_state()["uid"] == "uid-1"
    assert cloudauth.id_token() == "fb-id-1"                     # 방금 받은 것을 그대로 쓴다


def test_a_redirect_with_the_wrong_state_is_ignored(configured, google):
    open_url, _ = browser_that_signs_in(state_override="someone-else")
    with pytest.raises(cloudauth.AuthError, match="시간이 지났습니다"):
        cloudauth.sign_in(open_url=open_url, wait_s=1)
    assert google == [] and cloudauth.account() is None and not store.sync_enabled()


def test_cancelling_in_the_browser_says_so(configured, google):
    open_url, _ = browser_that_signs_in(error="access_denied")
    with pytest.raises(cloudauth.AuthError, match="취소"):
        cloudauth.sign_in(open_url=open_url, wait_s=5)
    assert google == []


# ---------- 세션 이어 가기 ----------

def test_expired_id_token_is_refreshed_and_the_new_refresh_token_kept(configured, google):
    open_url, _ = browser_that_signs_in()
    cloudauth.sign_in(open_url=open_url, wait_s=5)
    cloudauth._cache["until"] = time.time() - 1                  # 끝났다
    assert cloudauth.id_token() == "fb-id-2"
    base, _, data = google[-1]
    assert base == cloudauth.REFRESH and data["refresh_token"] == "refresh-1"
    cloudauth._cache["until"] = time.time() - 1
    cloudauth.id_token()
    assert google[-1][2]["refresh_token"] == "refresh-2", "새로 받은 refresh token 을 저장하지 않았다"


def test_an_unreadable_saved_session_asks_to_sign_in_again(configured, google):
    store._write_json(paths.AUTH_FILE, {"uid": "uid-1", "email": "", "refresh": "bm90LWVuY3J5cHRlZA=="})
    with pytest.raises(cloudauth.AuthError, match="다시 로그인"):
        cloudauth.id_token()


def test_sign_out_forgets_the_session_but_keeps_the_schedule(configured, google):
    store.add({"title": "보고서", "kind": "floating"})
    open_url, _ = browser_that_signs_in()
    cloudauth.sign_in(open_url=open_url, wait_s=5)
    cloudauth.sign_out()
    assert cloudauth.account() is None and not store.sync_enabled()
    assert len(store.tasks()) == 1
    with pytest.raises(cloudauth.AuthError):
        cloudauth.id_token()


def test_google_errors_become_readable_sentences():
    assert "다시 로그인" in cloudauth._explain({"error": "invalid_grant"}, 400)
    assert "다시 로그인" in cloudauth._explain({"error": {"message": "TOKEN_EXPIRED"}}, 400)
    assert "설정" in cloudauth._explain({"error": "invalid_client"}, 401)


# ---------- 화면과의 약속 ----------

def test_status_never_carries_tokens(configured, google, server):
    open_url, _ = browser_that_signs_in()
    cloudauth.sign_in(open_url=open_url, wait_s=5)
    store.add({"title": "보고서", "kind": "floating"})
    status, body = call(server, "GET", "/api/sync")
    assert status == 200 and body["signed_in"] and body["email"] == "me@example.com"
    assert body["pending"] == 1
    text = json.dumps(body)
    for secret in ("refresh-1", "fb-id-1", "GOCSPX", "AIzaTEST"):
        assert secret not in text


def test_without_a_config_sign_in_is_refused_with_a_reason(server, monkeypatch, tmp_path):
    monkeypatch.setattr(paths, "cloud_config_paths", lambda: [str(tmp_path / "없음.json")])
    cloudauth._job.update(state="idle", error="")
    assert call(server, "GET", "/api/sync")[1]["configured"] is False
    status, body = call(server, "POST", "/api/sync/signin", {})
    assert status == 400 and "설정" in body["error"]


def test_sync_endpoints_need_the_token(server):
    assert call(server, "GET", "/api/sync", token=False)[0] == 403
    assert call(server, "POST", "/api/sync/signin", {}, token=False)[0] == 403
    assert call(server, "POST", "/api/sync/signout", {}, token=False)[0] == 403
