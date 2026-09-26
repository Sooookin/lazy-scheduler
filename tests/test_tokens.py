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
    """알림 카드가 자기 색을 따로 들고 있지 않아야 한다 - 창 화면의 밤 한 벌(tokens.NIGHT)을 입는다."""
    pairs = [
        (toast.SURFACE, "surface"), (toast.WASH_HI, "wash-hi"), (toast.WASH_LO, "wash-lo"),
        (toast.TEXT, "text"), (toast.TEXT2, "text2"), (toast.FAINT, "faint"),
        (toast.TEAL, "teal"), (toast.TEAL_SOFT, "teal-soft"), (toast.LATE, "late"),
        (toast.ON_PILL, "bg"),
    ]
    for got, key in pairs:
        assert got == tokens.NIGHT[key], "toast.%s 가 tokens.NIGHT 와 다르다" % key


def test_the_night_set_is_what_the_window_shows_at_midnight():
    """NIGHT 는 새 색이 아니라 applyLight 가 한밤에 섞는 값이다 (web/sky.js 와 같은 식)."""
    L = tokens.LIGHT
    assert tokens.NIGHT["surface"] == tokens._mix(L["panel"], L["night"], .80)
    assert tokens.NIGHT["text"] == L["pale"] and tokens.NIGHT["teal"] == L["teal-lit"]
    src = io.open(os.path.join(ROOT, "web", "sky.js"), encoding="utf-8").read()
    assert "mixc(LIT.panel, LIT.warm, warm*.85), LIT.night, (1-day)*.80" in src, "면을 섞는 식이 바뀌었다 - NIGHT 도 고친다"


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


def test_weights_match_the_fonts_we_actually_ship():
    """없는 굵기를 부르면 브라우저가 가짜 볼드를 만들어 한글 획이 뭉개진다.

    실제로 내보내는 글꼴 목록(tools/build_fonts.py)에서 값을 가져온다.
    글꼴을 더하거나 뺄 때 이 목록만 고치면 되고, 손으로 적어 둔 숫자가
    남아 어긋나는 일이 없다.
    """
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    import build_fonts

    shipped = {w for _, _, w in build_fonts.FACES}
    assert set(tokens.WEIGHT.values()) <= shipped, (
        "tokens 가 내보내지 않는 굵기를 쓴다: %s" % sorted(set(tokens.WEIGHT.values()) - shipped))

    # @font-face 선언도 실제 파일과 맞아야 한다
    declared = set(int(w) for w in re.findall(r"@font-face\{[^}]*?font-weight:(\d{3})", css_text()))
    assert declared == shipped, "선언 %s · 실제 %s" % (sorted(declared), sorted(shipped))
    for _, name, _ in build_fonts.FACES:
        assert os.path.exists(os.path.join(ROOT, "web", "fonts", name)), "%s 가 없다" % name

    used = set(int(w) for w in re.findall(r"font-weight:(\d{3})", css_text()))
    assert used <= shipped, "쓸 수 없는 굵기: %s" % sorted(used - shipped)
