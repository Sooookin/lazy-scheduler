# -*- coding: utf-8 -*-
"""업데이트한 뒤에도 창이 예전 화면을 보여 주던 문제를 막는다.

창은 한 번 읽은 페이지를 계속 들고 있다. × 를 눌러도 창 프로세스는 살아 있고,
트레이를 눌러도 app.open_window() 가 focus_ui() 로 그 창을 앞으로 부를 뿐이라
web/ 를 갈아 끼워도 화면은 그대로였다. 창 프로세스를 직접 끝내야만 바뀌었다.

실제로 겪었다 - 화면 파일 세 개를 바꿔 넣고 트레이로 다시 열었는데 하나도
반영되지 않았다.
"""
import io
import os

import pytest

import ui


@pytest.fixture
def web(tmp_path, monkeypatch):
    d = tmp_path / "web"
    (d / "fonts").mkdir(parents=True)
    (d / "style.css").write_text("a{}", encoding="utf-8")
    (d / "app.js").write_text("1", encoding="utf-8")
    (d / "fonts" / "x.woff2").write_bytes(b"\0\1")
    monkeypatch.setattr(ui.paths, "WEB_DIR", str(d))
    return d


def test_stamp_is_steady_when_nothing_changes(web):
    assert ui.build_stamp() == ui.build_stamp()


def test_stamp_notices_a_changed_file(web):
    before = ui.build_stamp()
    (web / "style.css").write_text("a{color:red}", encoding="utf-8")
    assert ui.build_stamp() != before


def test_stamp_notices_a_file_in_a_subfolder(web):
    """글꼴만 바뀌는 업데이트도 있다."""
    before = ui.build_stamp()
    (web / "fonts" / "x.woff2").write_bytes(b"\0\1\2")
    assert ui.build_stamp() != before


def test_stamp_is_none_when_the_folder_is_missing(tmp_path, monkeypatch):
    """읽지 못하면 섣불리 새로고침하지 않는다 (입력 중이던 것이 날아간다)."""
    monkeypatch.setattr(ui.paths, "WEB_DIR", str(tmp_path / "없음"))
    assert ui.build_stamp() is None


class FakeWindow:
    def __init__(self):
        self.urls = []

    def load_url(self, url):
        self.urls.append(url)


def test_window_reloads_only_when_the_files_changed(web, monkeypatch):
    win = FakeWindow()
    monkeypatch.setattr(ui, "_WINDOW", [win])
    monkeypatch.setattr(ui, "_STAMP", [ui.build_stamp()])

    assert ui.refresh_if_stale() is False
    assert win.urls == []

    # 크기도 바꾼다 - 러너의 디스크는 곧바로 쓰면 고친 때(mtime)가 그대로일 때가 있다
    (web / "app.js").write_text("22", encoding="utf-8")
    assert ui.refresh_if_stale() is True
    assert win.urls == [ui.SERVICE_URL]

    # 다시 부른다고 또 읽지는 않는다
    assert ui.refresh_if_stale() is False
    assert len(win.urls) == 1


def test_missing_folder_does_not_reload(web, monkeypatch):
    win = FakeWindow()
    monkeypatch.setattr(ui, "_WINDOW", [win])
    monkeypatch.setattr(ui, "_STAMP", [ui.build_stamp()])
    monkeypatch.setattr(ui.paths, "WEB_DIR", str(web) + "-없음")
    assert ui.refresh_if_stale() is False
    assert win.urls == []


def test_focus_request_checks_for_a_new_build():
    """/focus 가 refresh_if_stale 을 거치지 않으면 이 문제가 되돌아온다."""
    src = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "ui.py"), encoding="utf-8").read()
    head = src.split('if path == "/focus":')[1].split("return")[0]
    assert "refresh_if_stale()" in head, "/focus 가 새 화면 파일을 살피지 않는다"


# ---------- 창 자리 ----------

def test_the_window_is_placed_before_it_is_shown():
    """pywebview 의 CenterScreen 은 이 조합에서 듣지 않는다 (핸들이 생긴 뒤에
    StartPosition 을 바꾸므로 WinForms 가 이미 자리를 정해 버렸다). 직접 놓는다.
    순서가 뒤집혀 ShowWindow 뒤에 놓으면 창이 한 번 깜빡이며 옮겨간다."""
    src = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "ui.py"), encoding="utf-8").read()
    body = src.split("def focus():")[1].split("def ")[0]
    assert "place_once()" in body, "focus 가 창 자리를 잡지 않는다"
    assert body.index("place_once()") < body.index("ShowWindow"), \
        "보인 뒤에 옮기면 창이 깜빡인다"


def test_the_window_is_only_placed_once():
    """옮겨 둔 창을 숨겼다 열 때 제자리로 끌어오면 옮긴 뜻을 무시하는 것이다."""
    import ui as _ui
    assert _ui._placed == [False] or isinstance(_ui._placed[0], bool)
    _ui._placed[0] = True
    before = list(_ui._placed)
    _ui.place_once()                      # 창이 없어도 조용히 지나가야 한다
    assert _ui._placed == before
    _ui._placed[0] = False


def test_placing_uses_the_monitor_under_the_cursor():
    """주 모니터에 고정하면 모니터가 둘일 때 늘 한쪽에서만 열린다."""
    src = io.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "ui.py"), encoding="utf-8").read()
    body = src.split("def place_once():")[1].split("\ndef ")[0]
    assert "GetCursorPos" in body and "MonitorFromPoint" in body
    assert "rcWork" in body, "작업 영역이 아니라 모니터 전체를 쓰면 작업 표시줄에 가린다"
