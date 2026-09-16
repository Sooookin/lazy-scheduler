# -*- coding: utf-8 -*-
"""디자인 값이 한 곳에서만 나오는지 지킨다.

색을 손으로 두 군데 적어 두면 언젠가 반드시 어긋난다. 실제로 그랬다 -
바탕을 한 단계 밝혔을 때 창은 밝아지고 알림 카드만 예전 색으로 남았다.
나란히 뜨면 종이 두 장의 색이 다르다.

여기서 막는다.
"""
import io
import os
import re
import subprocess
import sys

import pytest

import toast
import tokens

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, "web", "style.css")


def css_text():
    return io.open(CSS, encoding="utf-8").read()


def test_stylesheet_matches_tokens():
    """style.css 의 :root 가 tokens.py 와 같아야 한다.

    다르면 tools/gen_tokens.py 를 실행하지 않고 style.css 를 직접 고쳤다는 뜻이다.
    """
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "gen_tokens.py"), "--check"],
                       capture_output=True, text=True, cwd=ROOT)
    assert r.returncode == 0, (
        "style.css 가 tokens.py 와 다르다. python tools/gen_tokens.py 를 실행해라.\n"
        + r.stdout + r.stderr)


def test_toast_colours_come_from_tokens():
    """알림 카드가 자기 색을 따로 들고 있지 않아야 한다."""
    pairs = [
        (toast.CARD, "card"), (toast.DARK, "dark"), (toast.LIGHT, "light"),
        (toast.PALE, "pale"), (toast.INK2, "ink2"), (toast.BODY, "body"),
        (toast.MUTED, "muted"), (toast.FAINT, "faint"), (toast.MID, "mid"),
        (toast.MID_INK, "mid-ink"), (toast.MINT, "mint"), (toast.DEEP, "deep"),
        (toast.ONMID, "onmid"), (toast.WASH_HI, "wash-hi"), (toast.WASH_LO, "wash-lo"),
    ]
    for got, key in pairs:
        assert got == tokens.COLOR[key], "toast.%s 가 tokens 와 다르다" % key


def test_no_stray_hex_colours_in_python():
    """파이썬 쪽에 #rrggbb 를 다시 적어 두지 않았는지.

    새 색이 필요하면 tokens.py 에 이름을 붙여 넣는다. 그래야 창 · 알림 카드 ·
    나중에 붙을 앱이 같은 값을 본다.
    """
    allowed = {v.lower() for v in tokens.COLOR.values()}
    for name in ("toast.py", "tray.py", "app.py"):
        src = io.open(os.path.join(ROOT, name), encoding="utf-8").read()
        src = re.sub(r"#.*", "", src)                     # 주석 안의 설명은 센다고 치고
        found = {m.lower() for m in re.findall(r"[\"'](#[0-9a-fA-F]{6})[\"']", src)}
        stray = found - allowed
        assert not stray, "%s 에 tokens 에 없는 색이 있다: %s" % (name, sorted(stray))


def test_weights_are_only_the_three_we_ship():
    """Paperlogy 는 300 · 500 · 700 뿐이다. 없는 굵기를 부르면 가짜 볼드가 된다."""
    assert sorted(tokens.WEIGHT.values()) == [300, 500, 700]
    used = set(int(w) for w in re.findall(r"font-weight:(\d{3})", css_text()))
    assert used <= {300, 500, 700}, "쓸 수 없는 굵기: %s" % sorted(used - {300, 500, 700})
