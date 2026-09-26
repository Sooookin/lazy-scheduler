# -*- coding: utf-8 -*-
"""자원 파일이 코드가 찾는 자리에 실제로 있는지.

글꼴이 없으면 프로그램은 죽지 않는다 - 조용히 맑은 고딕으로 물러선다.
알림 카드만 다른 글꼴로 뜨고, 아무도 모른 채 배포된다. 여기서 잡는다.
"""
import io
import os

import pytest

import paths
import toast
import tray

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "assets", "fonts")


def _shipped():
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import build_fonts
    return build_fonts.FACES


def test_every_font_we_convert_is_actually_there():
    for src, _out, _w in _shipped():
        assert os.path.exists(os.path.join(FONTS, src)), "assets/fonts/%s 가 없다" % src


def test_the_app_icon_is_where_paths_says():
    assert os.path.exists(paths.ICON), "paths.ICON 이 가리키는 자리에 아이콘이 없다: %s" % paths.ICON


def test_toast_finds_a_real_font_for_every_weight():
    """물러선 자리(맑은 고딕)가 아니라 우리 글꼴을 찾아야 한다."""
    for weight in (300, 400, 500):
        first = toast._font_paths(weight)[0:2]
        assert any(os.path.exists(p) for p in first), \
            "weight %d 에서 Paperlogy 를 못 찾고 시스템 글꼴로 물러선다" % weight


def test_tray_and_toast_look_in_the_same_places():
    """목록을 각자 들고 있으면 글꼴을 옮길 때 한쪽만 고쳐진다."""
    assert toast._font_paths(500) == paths.font_paths("Paperlogy-5Medium.ttf")
    src = io.open(os.path.join(ROOT, "tray.py"), encoding="utf-8").read()
    assert "paths.font_paths(" in src, "tray 가 제 목록을 다시 들고 있다"


def test_build_ships_the_fonts_and_the_icon():
    """빌드 명령이 옮긴 자리를 가리키는지. 여기가 어긋나면 빌드본에만 글꼴이 빠진다."""
    src = io.open(os.path.join(ROOT, "tools", "build.py"), encoding="utf-8").read()
    for name, _out, _w in _shipped():
        assert "assets/fonts/%s" % name in src, "build.py 가 %s 를 싣지 않는다" % name
    assert "assets/app.ico" in src


def test_no_leftover_copies_at_the_repo_root():
    """옮긴 뒤 뿌리에 사본이 남아 있으면 어느 쪽이 진짜인지 알 수 없게 된다."""
    strays = [n for n in os.listdir(ROOT) if n.endswith(".ttf") or n == "app.ico"]
    assert not strays, "뿌리에 남은 자원 파일: %s" % strays


def test_web_icons_are_all_referenced():
    """쓰지 않는 그림을 들고 있으면 창을 열 때마다 같이 묶여 나간다."""
    web = os.path.join(ROOT, "web")
    text = ""
    for name in ("index.html", "app.js", "sky.js", "pebble.js", "style.css"):
        text += io.open(os.path.join(web, name), encoding="utf-8").read()
    for name in ("tray.py", "main.py"):
        text += io.open(os.path.join(ROOT, name), encoding="utf-8").read()
    unused = [n for n in os.listdir(web)
              if n.endswith(".png") and n not in text]
    assert not unused, "아무도 부르지 않는 그림: %s" % unused


# ---------- 이름을 바꿀 때 ----------

def test_the_old_data_folder_is_still_remembered():
    """새 이름으로 바꿨으면 예전 폴더가 목록에 남아 있어야 한다.

    빠지면 첫 실행에서 일정이 통째로 비어 보인다.
    """
    olds = [os.path.basename(d) for d in paths.OLD_DATA_DIRS]
    for name in ("lazy scheduler", "To-Do Manager"):
        assert name in olds, "예전 데이터 폴더를 잊어버렸다(%s): %s" % (name, olds)
    assert os.path.basename(paths.DATA_DIR) not in olds


def test_migration_brings_the_backups_and_state_too(tmp_path, monkeypatch):
    """일정만 옮기면 되살릴 백업이 예전 폴더에 남아 안전망이 끊긴다."""
    old = tmp_path / "예전이름"
    (old / "backups").mkdir(parents=True)
    (old / "data.json").write_text('{"version":2,"tasks":[]}', encoding="utf-8")
    (old / "state.json").write_text('{"fired":["x"]}', encoding="utf-8")
    (old / "backups" / "data-2026-09-16.json").write_text("{}", encoding="utf-8")
    new = tmp_path / "새이름"

    monkeypatch.setattr(paths, "DATA_DIR", str(new))
    monkeypatch.setattr(paths, "DATA_FILE", str(new / "data.json"))
    monkeypatch.setattr(paths, "STATE_FILE", str(new / "state.json"))
    monkeypatch.setattr(paths, "BACKUP_DIR", str(new / "backups"))
    monkeypatch.setattr(paths, "OLD_DATA_DIRS", [str(old)])

    paths.migrate_legacy()
    assert (new / "data.json").exists()
    assert (new / "state.json").exists(), "띄운 알림 기록이 빠져 오늘 알림이 다시 뜬다"
    assert (new / "backups" / "data-2026-09-16.json").exists(), "백업이 따라오지 않았다"
    assert (old / "data.json").exists(), "예전 폴더는 한 벌 더로 남겨 둬야 한다"


def test_the_window_is_named_and_looked_up_by_the_same_value():
    """ui.py 가 창을 제목으로 찾는다. 짓는 쪽과 찾는 쪽이 어긋나면 창을 못 찾는다."""
    src = io.open(os.path.join(ROOT, "ui.py"), encoding="utf-8").read()
    assert src.count("paths.APP_NAME") >= 2
    assert '"To-Do Manager"' not in src


def test_autostart_cleans_up_the_entry_made_under_the_old_name():
    """예전 이름의 값이 남으면 로그인할 때 두 번 실행된다."""
    import autostart
    assert autostart.NAME not in autostart.OLD_NAMES
    src = io.open(os.path.join(ROOT, "autostart.py"), encoding="utf-8").read()
    assert "_drop_old(k)" in src, "예전 등록을 치우지 않는다"
