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
    for name in ("index.html", "app.js", "style.css"):
        text += io.open(os.path.join(web, name), encoding="utf-8").read()
    for name in ("tray.py", "main.py"):
        text += io.open(os.path.join(ROOT, name), encoding="utf-8").read()
    unused = [n for n in os.listdir(web)
              if n.endswith(".png") and n not in text]
    assert not unused, "아무도 부르지 않는 그림: %s" % unused
