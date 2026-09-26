# -*- coding: utf-8 -*-
"""자동 업데이트: 무엇을 받고 · 언제 바꾸고 · 실패하면 어떻게 되돌리는지."""
import hashlib
import io
import json
import os
import zipfile
from datetime import datetime, timedelta

import pytest

import updater
import version


def release(tag="v9.9.9", assets=("LazyScheduler.zip", "LazyScheduler.zip.sha256"), **kw):
    r = {"tag_name": tag, "draft": False, "prerelease": False, "body": "- 첫째\n- 둘째",
         "assets": [{"name": n, "size": 10, "browser_download_url": "https://x/" + n} for n in assets]}
    r.update(kw)
    return r


def test_versions_compare_as_numbers():
    assert updater.parse("v2.10.0") > updater.parse("v2.9.9")
    assert updater.parse("2.4") == (2, 4, 0)
    assert updater.parse("v2.4.0-beta") is None
    assert updater.newer("v2.4.1", "2.4.0") and not updater.newer("v2.4.0", "2.4.0")
    assert not updater.newer("v2.3.9", "2.4.0") and not updater.newer("nightly", "2.4.0")


def test_the_version_is_a_plain_number():
    assert updater.parse(version.VERSION), "version.py 는 2.4.0 같은 숫자 버전이어야 한다"


def test_release_tag_must_match_version_py():
    import subprocess
    import sys
    tool = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "check_version.py")
    ok = subprocess.run([sys.executable, tool, "v" + version.VERSION], capture_output=True)
    bad = subprocess.run([sys.executable, tool, "v0.0.1"], capture_output=True)
    assert ok.returncode == 0 and bad.returncode == 1


def test_only_complete_final_releases_are_used():
    got = updater.pick(release())
    assert got["version"] == "9.9.9" and got["zip_url"].endswith(".zip") and got["notes"].startswith("- 첫째")
    assert updater.pick(release(draft=True)) is None
    assert updater.pick(release(prerelease=True)) is None
    assert updater.pick(release(assets=("LazyScheduler.zip",))) is None      # 해시가 없으면 받지 않는다
    assert updater.pick(release(tag="latest")) is None


def test_hash_file_is_read_leniently():
    h = "ab" * 32
    assert updater.read_hash(h.upper() + "  LazyScheduler.zip\n") == h
    assert updater.read_hash("nothing here") == ""


def test_zip_cannot_write_outside_its_folder(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("../../escape.txt", "x")
    with pytest.raises(ValueError):
        updater.extract(str(z), str(tmp_path / "out"))
    assert not (tmp_path / "escape.txt").exists()


def test_zip_without_the_exe_is_refused(tmp_path):
    z = tmp_path / "empty.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("LazyScheduler/readme.txt", "x")
    with pytest.raises(ValueError):
        updater.extract(str(z), str(tmp_path / "out"))


def test_quiet_only_when_nobody_needs_the_app():
    assert updater.quiet(3600, False, False) == (True, "")
    assert not updater.quiet(60, False, False)[0]           # 창을 쓰는 중
    assert not updater.quiet(15 * 60, False, False, window_open=True)[0]   # 떠 있으면 더 오래 기다린다
    assert updater.quiet(31 * 60, False, False, window_open=True)[0]
    assert not updater.quiet(3600, True, False)[0]          # 곧 알림
    assert not updater.quiet(3600, False, True)[0]          # 카드가 떠 있다


def test_alert_near_sees_the_next_reminder():
    import app
    import store
    now = datetime.now().replace(second=0, microsecond=0)
    store.update_settings({"brief_time": ""})
    assert not app.alert_near(now)
    at = now + timedelta(minutes=35)                        # 기본 30분 전 알림 → 5분 뒤에 뜬다
    store.add({"title": "보고", "kind": "deadline", "due_date": at.date().isoformat(),
               "due_time": at.strftime("%H:%M")})
    if at.date() == now.date():
        assert app.alert_near(now)
    far = now + timedelta(hours=3)
    assert not app.alert_near(far + timedelta(minutes=40)) or far.date() != now.date()


def _tree(root, files):
    for rel, text in files.items():
        p = os.path.join(root, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)


def test_swap_moves_the_old_folder_aside_and_rolls_back(tmp_path):
    target, staged = str(tmp_path / "LazyScheduler"), str(tmp_path / "new")
    _tree(target, {"LazyScheduler.exe": "old", "_internal/a.txt": "old"})
    _tree(staged, {"LazyScheduler.exe": "new", "_internal/b.txt": "new"})
    old = updater.swap(target, staged)
    assert open(os.path.join(target, "LazyScheduler.exe")).read() == "new"
    assert not os.path.exists(os.path.join(target, "_internal", "a.txt"))   # 옛 부품이 섞이지 않는다
    assert open(os.path.join(old, "LazyScheduler.exe")).read() == "old"
    updater.rollback(target, old)
    assert open(os.path.join(target, "LazyScheduler.exe")).read() == "old"
    assert not os.path.exists(old)


def test_swap_puts_the_old_one_back_when_copying_fails(tmp_path):
    target = str(tmp_path / "LazyScheduler")
    _tree(target, {"LazyScheduler.exe": "old"})
    with pytest.raises(Exception):
        updater.swap(target, str(tmp_path / "missing"), tries=1)
    assert open(os.path.join(target, "LazyScheduler.exe")).read() == "old"


def test_prepare_downloads_checks_and_stages(tmp_path, monkeypatch):
    """받기 → 해시 → 풀기 → 켜 보기. 해시가 다르면 아무것도 남기지 않는다."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("LazyScheduler/LazyScheduler.exe", "exe")
        z.writestr("LazyScheduler/_internal/x.txt", "x")
    blob = buf.getvalue()
    good = hashlib.sha256(blob).hexdigest()

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    served = {"zip": blob, "sha": (good + "  LazyScheduler.zip\n").encode()}
    monkeypatch.setattr(updater, "_open", lambda url, accept=None: R(served["sha" if url.endswith(".sha256") else "zip"]))
    monkeypatch.setattr(updater, "probe", lambda exe: (os.path.isfile(exe), "ok"))
    monkeypatch.setattr(updater, "UPDATE_DIR", str(tmp_path / "update"))
    rel = dict(updater.pick(release()), zip_size=len(blob))
    updater.prepare(rel)
    p = updater.load_state()["pending"]
    assert p["version"] == "9.9.9" and os.path.isfile(os.path.join(p["dir"], "LazyScheduler.exe"))
    assert updater.status()["state"] == "ready"

    updater.save_state({})
    served["sha"] = ("00" * 32).encode()
    with pytest.raises(ValueError):
        updater.prepare(rel)
    assert not updater.load_state().get("pending")


def test_notice_is_shown_once():
    updater.save_state({"just_updated": {"from": "2.4.0", "to": "2.4.1", "notes": "- 고침"}})
    assert updater.notice()["to"] == "2.4.1"
    updater.mark_seen()
    assert updater.notice() is None


def test_overview_carries_version_and_notice(server):
    import http.client
    import paths
    updater.save_state({"just_updated": {"from": "2.4.0", "to": version.VERSION, "notes": ""}})
    c = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    c.request("GET", "/api/overview", headers={"X-TM-Token": paths.ipc_token()})
    o = json.loads(c.getresponse().read())
    assert o["version"] == version.VERSION and o["update"]["to"] == version.VERSION
    c.request("POST", "/api/update/seen", body="{}",
              headers={"X-TM-Token": paths.ipc_token(), "Content-Type": "application/json"})
    assert c.getresponse().status == 200
    assert updater.notice() is None


def test_auto_update_setting_is_per_device():
    import store
    import syncdoc
    assert store.update_settings({"auto_update": False})["auto_update"] is False
    assert "auto_update" not in syncdoc.SHARED_SETTINGS


def test_manual_check_reports_a_newer_release(monkeypatch):
    """[업데이트 확인]: 소스로 돌 때는 받지 않고 새것이 있다는 것만 알린다."""
    import time
    monkeypatch.setattr(updater, "fetch_latest", lambda: release(tag="v99.0.0"))
    updater.check_now()
    for _ in range(50):
        if updater.status()["state"] != "checking":
            break
        time.sleep(0.05)
    s = updater.status()
    assert s["state"] == "available" and s["latest"] == "99.0.0" and s["dev"] is True


def test_apply_now_needs_a_staged_version(server):
    import http.client
    import paths
    updater.save_state({})
    updater._status.update(state="idle")
    c = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    c.request("POST", "/api/update/apply", body="{}",
              headers={"X-TM-Token": paths.ipc_token(), "Content-Type": "application/json"})
    assert c.getresponse().status == 409


def test_window_tells_when_it_is_used(server):
    """목록을 다시 읽는 요청이 아니라, 창이 알려 준 입력 · 보임으로 판단한다."""
    import http.client
    import time
    import app
    import paths

    def tell(body):
        c = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
        c.request("POST", "/api/ui", body=json.dumps(body),
                  headers={"X-TM-Token": paths.ipc_token(), "Content-Type": "application/json"})
        assert c.getresponse().status == 200

    tell({"visible": True, "input": True})
    assert app._UI["visible"] and app.ui_idle_s() < 5
    c = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    c.request("GET", "/api/overview", headers={"X-TM-Token": paths.ipc_token()})
    c.getresponse().read()
    app._UI["input"] = time.time() - 3600                   # 한 시간 전에 마지막으로 만졌다
    assert app.ui_idle_s() > 3000                            # 스스로 다시 읽은 요청은 세지 않는다
    tell({"visible": False})
    assert app.ui_idle_s() < 5                               # 숨긴 때부터 센다
    app._UI.update(visible=False, changed=0.0, input=0.0)
